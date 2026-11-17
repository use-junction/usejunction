package cmd

import (
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/types"
	"github.com/usejunction/agent/internal/ui"
)

// Usage tables for the terminal, built from the logs on this machine. These
// work with no account, and building one never uploads anything.

const (
	usagePeriodDaily   = "daily"
	usagePeriodWeekly  = "weekly"
	usagePeriodMonthly = "monthly"

	// Days shown by the daily table when no --since is given.
	usageDailyDefaultDays = 30
	// The models column is cut here so the table fits a normal terminal.
	usageModelsColumnMax = 26

	usageDateLayout = "2006-01-02"
)

type usageReportOptions struct {
	Period    string
	Since     string
	Until     string
	Tool      string
	Breakdown bool
	Order     string
	// Last is the number of most recent periods to show, the current one
	// included: 1 is today, this week or this month. 0 means no --last.
	Last int
}

// usageTokens holds the four token buckets a row or a total is made of.
// Input is uncached input, so the buckets never count a token twice.
type usageTokens struct {
	InputTokens      int     `json:"inputTokens"`
	OutputTokens     int     `json:"outputTokens"`
	CacheReadTokens  int     `json:"cacheReadTokens"`
	CacheWriteTokens int     `json:"cacheWriteTokens"`
	TotalTokens      int     `json:"totalTokens"`
	EstimatedCost    float64 `json:"estimatedCost"`
}

func (t *usageTokens) add(input, output, cacheRead, cacheWrite int, cost float64) {
	t.InputTokens += input
	t.OutputTokens += output
	t.CacheReadTokens += cacheRead
	t.CacheWriteTokens += cacheWrite
	t.TotalTokens += input + output + cacheRead + cacheWrite
	t.EstimatedCost += cost
}

type usageModelLine struct {
	Model string `json:"model"`
	usageTokens
}

type usageReportRow struct {
	// Period is a day (2026-11-14) or a month (2026-11).
	Period string `json:"period"`
	// Covers says which days a month row really holds when it is not the
	// whole month, for example "from 2026-09-17".
	Covers   string   `json:"covers,omitempty"`
	Tool     string   `json:"tool"`
	ToolName string   `json:"toolName"`
	Models   []string `json:"models"`
	usageTokens
	ModelBreakdown []usageModelLine `json:"modelBreakdown,omitempty"`
}

type usageReport struct {
	Period string
	Since  string
	Until  string
	// DefaultWindow is true when the person gave no dates of their own.
	DefaultWindow bool
	// Last is the --last count the window came from, or 0.
	Last int
	// HistoryStart is the oldest day the scanner reads. Asking for earlier
	// days gets a note rather than a silent gap.
	HistoryStart  string
	BeforeHistory bool
	Rows          []usageReportRow
	Totals        usageTokens
	// AllEstimated is true when every dollar is an API list-price estimate.
	AllEstimated bool
}

var compactDatePattern = regexp.MustCompile(`^\d{8}$`)

// parseUsageDate accepts 20261114 and 2026-11-14 and returns the second form.
func parseUsageDate(value string) (string, error) {
	value = strings.TrimSpace(value)
	layout := usageDateLayout
	if compactDatePattern.MatchString(value) {
		layout = "20060102"
	}
	day, err := time.Parse(layout, value)
	if err != nil {
		return "", fmt.Errorf("%q is not a date; use YYYYMMDD or YYYY-MM-DD", value)
	}
	return day.Format(usageDateLayout), nil
}

// weekStart returns the Monday that starts the week holding day. Weeks run
// Monday to Sunday, on the same UTC days as the daily table.
func weekStart(day time.Time) time.Time {
	day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
}

// periodStart returns the first day of the period holding day.
func periodStart(period string, day time.Time) time.Time {
	day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	switch period {
	case usagePeriodWeekly:
		return weekStart(day)
	case usagePeriodMonthly:
		return time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	return day
}

// periodKey files a YYYY-MM-DD day under its period: the day itself, the
// Monday its week starts on, or its month.
func periodKey(period, date string) string {
	switch period {
	case usagePeriodMonthly:
		if len(date) >= 7 {
			return date[:7]
		}
	case usagePeriodWeekly:
		if day, err := time.Parse(usageDateLayout, date); err == nil {
			return weekStart(day).Format(usageDateLayout)
		}
	}
	return date
}

// resolveUsageWindow turns the flags into the first and last day to show.
// Days are UTC, the same days the scanners file usage under.
func resolveUsageWindow(now time.Time, opts usageReportOptions) (usageReport, error) {
	report := usageReport{Period: opts.Period, AllEstimated: true}
	if report.Period != usagePeriodMonthly && report.Period != usagePeriodWeekly {
		report.Period = usagePeriodDaily
	}
	today := now.UTC()
	report.HistoryStart = scan.UsageLookbackStart(now).Format(usageDateLayout)
	hasSince, hasUntil := strings.TrimSpace(opts.Since) != "", strings.TrimSpace(opts.Until) != ""
	report.DefaultWindow = !hasSince && !hasUntil && opts.Last == 0

	if order := strings.ToLower(strings.TrimSpace(opts.Order)); order != "" && order != "asc" && order != "desc" {
		return report, fmt.Errorf("--order must be asc or desc, not %q", opts.Order)
	}

	switch {
	case opts.Last < 0:
		return report, fmt.Errorf("--last must be 1 or more, not %d", opts.Last)
	case opts.Last > 0 && (hasSince || hasUntil):
		return report, fmt.Errorf("--last counts back from today, so it cannot be used with --since or --until")
	case opts.Last > 0:
		// The current period and the ones before it, up to today.
		first := periodStart(report.Period, today)
		switch report.Period {
		case usagePeriodWeekly:
			first = first.AddDate(0, 0, -7*(opts.Last-1))
		case usagePeriodMonthly:
			first = first.AddDate(0, -(opts.Last - 1), 0)
		default:
			first = first.AddDate(0, 0, -(opts.Last - 1))
		}
		report.Last = opts.Last
		report.Since = first.Format(usageDateLayout)
		report.Until = today.Format(usageDateLayout)
		report.BeforeHistory = report.Since < report.HistoryStart
		return report, nil
	}

	report.Until = today.Format(usageDateLayout)
	if hasUntil {
		until, err := parseUsageDate(opts.Until)
		if err != nil {
			return report, fmt.Errorf("--until: %w", err)
		}
		report.Until = until
	}

	switch {
	case hasSince:
		since, err := parseUsageDate(opts.Since)
		if err != nil {
			return report, fmt.Errorf("--since: %w", err)
		}
		report.Since = since
		report.BeforeHistory = since < report.HistoryStart
	case report.Period == usagePeriodMonthly || report.Period == usagePeriodWeekly:
		report.Since = report.HistoryStart
	default:
		report.Since = today.AddDate(0, 0, -(usageDailyDefaultDays - 1)).Format(usageDateLayout)
		// An --until in the past with no --since still shows 30 days.
		if until, err := time.Parse(usageDateLayout, report.Until); err == nil && report.Until < today.Format(usageDateLayout) {
			report.Since = until.AddDate(0, 0, -(usageDailyDefaultDays - 1)).Format(usageDateLayout)
		}
	}

	if report.Since > report.Until {
		return report, fmt.Errorf("--since %s is after --until %s", report.Since, report.Until)
	}
	return report, nil
}

func normalizeToolFilter(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer(" ", "", "-", "", "_", "").Replace(value)
	if value == "all" {
		return ""
	}
	return value
}

// toolMatches accepts the tool's id ("claude") or its name ("Claude Code",
// "claude-code").
func toolMatches(filter, toolID string) bool {
	if filter == "" {
		return true
	}
	return normalizeToolFilter(toolID) == filter || normalizeToolFilter(toolDisplayName(toolID)) == filter
}

// uncachedInput returns input tokens that were not served from the cache. Some
// tools report cached tokens inside their input count and some beside it.
func uncachedInput(row types.DailyUsage) int {
	switch row.TokenSemantics {
	case types.TokenSemanticsAnthropic, types.TokenSemanticsVendor:
		return row.InputTokens
	case types.TokenSemanticsOpenAI:
		if row.InputTokens > row.CacheReadTokens {
			return row.InputTokens - row.CacheReadTokens
		}
		return 0
	}
	return scan.BillableInputTokens(row.ToolName, row.InputTokens, row.CacheReadTokens)
}

var modelDateSuffix = regexp.MustCompile(`-\d{8}$`)

// shortModelName drops the parts of a model id that only add width.
func shortModelName(model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return "unknown"
	}
	model = strings.TrimPrefix(model, "claude-")
	return modelDateSuffix.ReplaceAllString(model, "")
}

// periodCoverage says which days of a week or month the window holds, or ""
// when it holds the whole period. key is the period's key: a week's Monday
// (2026-11-16) or a month (2026-11).
func periodCoverage(period, key, from, to string) string {
	var first, last time.Time
	switch period {
	case usagePeriodMonthly:
		month, err := time.Parse("2006-01", key)
		if err != nil {
			return ""
		}
		first, last = month, month.AddDate(0, 1, -1)
	case usagePeriodWeekly:
		monday, err := time.Parse(usageDateLayout, key)
		if err != nil {
			return ""
		}
		first, last = monday, monday.AddDate(0, 0, 6)
	default:
		return ""
	}
	startsLate := from > first.Format(usageDateLayout)
	endsEarly := to < last.Format(usageDateLayout)
	switch {
	case startsLate && endsEarly:
		return fmt.Sprintf("%s to %s", from, to)
	case startsLate:
		return "from " + from
	case endsEarly:
		return "to " + to
	}
	return ""
}

// buildUsageReport groups local usage by period and tool. Productivity-only
// rows carry no tokens to price and are left out.
func buildUsageReport(rows []types.DailyUsage, now time.Time, opts usageReportOptions) (usageReport, error) {
	report, err := resolveUsageWindow(now, opts)
	if err != nil {
		return report, err
	}
	filter := normalizeToolFilter(opts.Tool)

	type bucket struct {
		row    usageReportRow
		models map[string]*usageModelLine
	}
	buckets := map[string]*bucket{}
	for _, row := range rows {
		if row.MetricKind == types.MetricKindProductivity {
			continue
		}
		if row.Date < report.Since || row.Date > report.Until {
			continue
		}
		if !toolMatches(filter, row.ToolName) {
			continue
		}
		input := uncachedInput(row)
		if input+row.OutputTokens+row.CacheReadTokens+row.CacheWriteTokens == 0 && row.EstimatedCost <= 0 {
			continue
		}
		period := periodKey(report.Period, row.Date)
		toolID := strings.ToLower(strings.TrimSpace(row.ToolName))
		key := period + "|" + toolID
		b := buckets[key]
		if b == nil {
			b = &bucket{
				row:    usageReportRow{Period: period, Tool: toolID, ToolName: toolDisplayName(row.ToolName)},
				models: map[string]*usageModelLine{},
			}
			buckets[key] = b
		}
		model := shortModelName(row.Model)
		line := b.models[model]
		if line == nil {
			line = &usageModelLine{Model: model}
			b.models[model] = line
		}
		cost := row.EstimatedCost
		if cost < 0 {
			cost = 0
		}
		line.add(input, row.OutputTokens, row.CacheReadTokens, row.CacheWriteTokens, cost)
		b.row.add(input, row.OutputTokens, row.CacheReadTokens, row.CacheWriteTokens, cost)
		report.Totals.add(input, row.OutputTokens, row.CacheReadTokens, row.CacheWriteTokens, cost)
		if cost > 0 && row.CostKind != "" && row.CostKind != types.CostKindEstimatedAPI {
			report.AllEstimated = false
		}
	}

	// A week or month row is only as complete as the days the scanner reads.
	coveredFrom, coveredTo := report.Since, report.Until
	if coveredFrom < report.HistoryStart {
		coveredFrom = report.HistoryStart
	}
	if today := now.UTC().Format(usageDateLayout); coveredTo > today {
		coveredTo = today
	}

	for _, b := range buckets {
		for _, line := range b.models {
			b.row.ModelBreakdown = append(b.row.ModelBreakdown, *line)
		}
		sort.Slice(b.row.ModelBreakdown, func(i, j int) bool {
			left, right := b.row.ModelBreakdown[i], b.row.ModelBreakdown[j]
			if left.EstimatedCost != right.EstimatedCost {
				return left.EstimatedCost > right.EstimatedCost
			}
			if left.TotalTokens != right.TotalTokens {
				return left.TotalTokens > right.TotalTokens
			}
			return left.Model < right.Model
		})
		for _, line := range b.row.ModelBreakdown {
			b.row.Models = append(b.row.Models, line.Model)
		}
		b.row.Covers = periodCoverage(report.Period, b.row.Period, coveredFrom, coveredTo)
		if !opts.Breakdown {
			b.row.ModelBreakdown = nil
		}
		report.Rows = append(report.Rows, b.row)
	}

	descending := strings.EqualFold(strings.TrimSpace(opts.Order), "desc")
	sort.Slice(report.Rows, func(i, j int) bool {
		left, right := report.Rows[i], report.Rows[j]
		if left.Period != right.Period {
			if descending {
				return left.Period > right.Period
			}
			return left.Period < right.Period
		}
		if left.EstimatedCost != right.EstimatedCost {
			return left.EstimatedCost > right.EstimatedCost
		}
		return left.ToolName < right.ToolName
	})
	return report, nil
}

// formatTokens shortens a token count to at most five characters.
func formatTokens(n int) string {
	switch {
	case n <= 0:
		return "0"
	case n < 1_000:
		return fmt.Sprintf("%d", n)
	case n < 999_950:
		return trimTokenUnit(float64(n)/1e3, "K")
	case n < 999_950_000:
		return trimTokenUnit(float64(n)/1e6, "M")
	}
	return trimTokenUnit(float64(n)/1e9, "B")
}

func trimTokenUnit(value float64, unit string) string {
	if value >= 100 {
		return fmt.Sprintf("%.0f%s", value, unit)
	}
	return strings.TrimSuffix(fmt.Sprintf("%.1f", value), ".0") + unit
}

// formatCost always shows cents, so a column of costs lines up.
func formatCost(amount float64) string {
	if amount <= 0 {
		return "—"
	}
	cents := fmt.Sprintf("%.2f", amount)
	whole, fraction, _ := strings.Cut(cents, ".")
	var b strings.Builder
	for i, digit := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(digit)
	}
	return "$" + b.String() + "." + fraction
}

func cutToWidth(s string, width int) string {
	if utf8.RuneCountInString(s) <= width {
		return s
	}
	runes := []rune(s)
	return string(runes[:width-1]) + "…"
}

func (r usageReport) title() string {
	what := "AI coding usage"
	switch r.Period {
	case usagePeriodWeekly:
		what = "AI coding usage by week"
	case usagePeriodMonthly:
		what = "AI coding usage by month"
	}
	window := fmt.Sprintf("%s to %s", r.Since, r.Until)
	switch {
	case r.Last == 1:
		// One period needs no "by week": "today", "this week", "this month".
		what = "AI coding usage"
		window = map[string]string{
			usagePeriodDaily:   "today",
			usagePeriodWeekly:  "this week, from Monday " + r.Since,
			usagePeriodMonthly: "this month",
		}[r.Period]
	case r.Last > 1:
		unit := map[string]string{usagePeriodDaily: "days", usagePeriodWeekly: "weeks", usagePeriodMonthly: "months"}[r.Period]
		window = fmt.Sprintf("last %d %s", r.Last, unit)
	case r.DefaultWindow && r.Period == usagePeriodDaily:
		window = fmt.Sprintf("last %d days", usageDailyDefaultDays)
	case r.DefaultWindow:
		window = "since " + r.Since
	}
	return fmt.Sprintf("%s · %s · this machine", what, window)
}

// method says how the numbers were measured, so nobody takes them for a bill.
// A connected device also syncs in the background, so only an unconnected one
// can say that nothing left the machine.
func (r usageReport) method(connected bool) []string {
	var first string
	switch {
	case r.Totals.EstimatedCost <= 0:
		first = "Read from local logs. Days are UTC."
	case r.AllEstimated:
		first = "Estimated at API list prices from local logs, not your bill. Days are UTC."
	default:
		first = "From local logs; part is estimated at API list prices. Days are UTC."
	}
	lines := []string{first}
	if r.BeforeHistory {
		lines = append(lines, fmt.Sprintf("Only the last %d days are read, so nothing before %s is shown.", scan.UsageLookbackDays, r.HistoryStart))
	}
	if !connected {
		lines = append(lines, "Nothing left this machine.")
	}
	return lines
}

// renderUsageReport prints the table. Numbers are right-aligned and a period
// is named once, on its first row.
func renderUsageReport(w io.Writer, report usageReport, connected bool) {
	fmt.Fprintf(w, "\n %s\n\n", ui.Strong(report.title()))

	if len(report.Rows) == 0 {
		fmt.Fprintf(w, " No AI coding usage found on this machine between %s and %s.\n", report.Since, report.Until)
		for _, line := range report.method(connected) {
			if strings.HasPrefix(line, "Only the last") {
				fmt.Fprintf(w, " %s\n", ui.Muted(line))
			}
		}
		fmt.Fprintf(w, " %s\n\n", ui.Muted("Run usejunction --help for the other commands."))
		return
	}

	periodHeader := map[string]string{usagePeriodDaily: "Date", usagePeriodWeekly: "Week of", usagePeriodMonthly: "Month"}[report.Period]
	// Left-aligned text columns first, then right-aligned numbers.
	const textColumns = 3
	table := [][]string{{periodHeader, "Tool", "Models", "Input", "Output", "Cache", "Cost"}}
	lastPeriod := ""
	for _, row := range report.Rows {
		period := ""
		if row.Period != lastPeriod {
			period = row.Period
			if row.Covers != "" {
				period += " (" + row.Covers + ")"
			}
			lastPeriod = row.Period
		}
		table = append(table, []string{
			period, row.ToolName, cutToWidth(strings.Join(row.Models, ", "), usageModelsColumnMax),
			formatTokens(row.InputTokens), formatTokens(row.OutputTokens),
			formatTokens(row.CacheReadTokens + row.CacheWriteTokens), formatCost(row.EstimatedCost),
		})
		for _, line := range row.ModelBreakdown {
			table = append(table, []string{
				"", "", cutToWidth("└ "+line.Model, usageModelsColumnMax),
				formatTokens(line.InputTokens), formatTokens(line.OutputTokens),
				formatTokens(line.CacheReadTokens + line.CacheWriteTokens), formatCost(line.EstimatedCost),
			})
		}
	}
	total := []string{
		"Total", "", "",
		formatTokens(report.Totals.InputTokens), formatTokens(report.Totals.OutputTokens),
		formatTokens(report.Totals.CacheReadTokens + report.Totals.CacheWriteTokens), formatCost(report.Totals.EstimatedCost),
	}
	writeUsageTable(w, table, total, textColumns)
	fmt.Fprintln(w)
	for _, line := range report.method(connected) {
		fmt.Fprintf(w, " %s\n", ui.Muted(line))
	}
}

// writeUsageTable prints a header line, the rows and a total line. The first
// textColumns columns are left-aligned text; the rest are right-aligned numbers.
func writeUsageTable(w io.Writer, table [][]string, total []string, textColumns int) {
	widths := make([]int, len(table[0]))
	for _, line := range append(append([][]string{}, table...), total) {
		for i, cell := range line {
			if n := utf8.RuneCountInString(cell); n > widths[i] {
				widths[i] = n
			}
		}
	}
	format := func(line []string) string {
		cells := make([]string, len(line))
		for i, cell := range line {
			pad := strings.Repeat(" ", widths[i]-utf8.RuneCountInString(cell))
			if i < textColumns {
				cells[i] = cell + pad
			} else {
				cells[i] = pad + cell
			}
		}
		return strings.TrimRight(strings.Join(cells, "  "), " ")
	}

	fmt.Fprintf(w, " %s\n", ui.Muted(format(table[0])))
	for _, line := range table[1:] {
		fmt.Fprintf(w, " %s\n", format(line))
	}
	fmt.Fprintf(w, " %s\n", ui.Strong(format(total)))
}

// usageReportJSON is the --json form. The rows sit under the period's name
// ("daily", "weekly" or "monthly"), next to the totals and the window they
// cover. A weekly row's period is the Monday its week starts on.
func usageReportJSON(report usageReport) map[string]any {
	rows := report.Rows
	if rows == nil {
		rows = []usageReportRow{}
	}
	costBasis := "estimated_api_list_price"
	switch {
	case report.Totals.EstimatedCost <= 0:
		costBasis = "none"
	case !report.AllEstimated:
		costBasis = "mixed"
	}
	return map[string]any{
		report.Period: rows,
		"totals":      report.Totals,
		"since":       report.Since,
		"until":       report.Until,
		"timezone":    "UTC",
		"costBasis":   costBasis,
	}
}

// usageTip is the one line under a table that points past the terminal. It is
// for a person at a terminal only: scripts, pipes and JSON never get it, and
// USEJUNCTION_NO_TIPS turns it off.
func usageTip(connected bool, dashboardURL string, terminal, jsonOut bool, noTips, signInCommand string) string {
	if jsonOut || !terminal || strings.TrimSpace(noTips) != "" {
		return ""
	}
	if connected {
		if dashboardURL = strings.TrimSpace(dashboardURL); dashboardURL != "" {
			return "→ Your dashboard: " + dashboardURL
		}
		return ""
	}
	return "→ Charts, cost by repo, and your whole team: " + signInCommand
}

// usageSignInCommand is what to type to get past the terminal. Run through
// npx, the agent is not on PATH and nothing keeps it syncing, so the command
// that works is the installer, which installs it and signs in.
func usageSignInCommand(runner, goos, controlPlaneURL string) string {
	if !strings.EqualFold(strings.TrimSpace(runner), "npx") {
		return "usejunction login"
	}
	controlPlaneURL = strings.TrimRight(strings.TrimSpace(controlPlaneURL), "/")
	if goos == "windows" {
		return fmt.Sprintf("irm %s/install.ps1 | iex", controlPlaneURL)
	}
	return fmt.Sprintf("curl -fsSL %s/install.sh | bash", controlPlaneURL)
}
