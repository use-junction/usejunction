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

// resolveUsageWindow turns the flags into the first and last day to show.
// Days are UTC, the same days the scanners file usage under.
func resolveUsageWindow(now time.Time, opts usageReportOptions) (usageReport, error) {
	report := usageReport{Period: opts.Period, AllEstimated: true}
	if report.Period != usagePeriodMonthly {
		report.Period = usagePeriodDaily
	}
	today := now.UTC()
	report.HistoryStart = scan.UsageLookbackStart(now).Format(usageDateLayout)
	report.DefaultWindow = strings.TrimSpace(opts.Since) == "" && strings.TrimSpace(opts.Until) == ""

	report.Until = today.Format(usageDateLayout)
	if strings.TrimSpace(opts.Until) != "" {
		until, err := parseUsageDate(opts.Until)
		if err != nil {
			return report, fmt.Errorf("--until: %w", err)
		}
		report.Until = until
	}

	switch {
	case strings.TrimSpace(opts.Since) != "":
		since, err := parseUsageDate(opts.Since)
		if err != nil {
			return report, fmt.Errorf("--since: %w", err)
		}
		report.Since = since
		report.BeforeHistory = since < report.HistoryStart
	case report.Period == usagePeriodMonthly:
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
	if order := strings.ToLower(strings.TrimSpace(opts.Order)); order != "" && order != "asc" && order != "desc" {
		return report, fmt.Errorf("--order must be asc or desc, not %q", opts.Order)
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

// monthCoverage says which days of a month the window holds, or "" when it
// holds the whole month.
func monthCoverage(month, from, to string) string {
	first, err := time.Parse("2006-01", month)
	if err != nil {
		return ""
	}
	monthStart := first.Format(usageDateLayout)
	monthEnd := first.AddDate(0, 1, -1).Format(usageDateLayout)
	startsLate := from > monthStart
	endsEarly := to < monthEnd
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
		period := row.Date
		if report.Period == usagePeriodMonthly && len(row.Date) >= 7 {
			period = row.Date[:7]
		}
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

	// A month row is only as complete as the days the scanner reads.
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
		if report.Period == usagePeriodMonthly {
			b.row.Covers = monthCoverage(b.row.Period, coveredFrom, coveredTo)
		}
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
	if r.Period == usagePeriodMonthly {
		what = "AI coding usage by month"
	}
	window := fmt.Sprintf("%s to %s", r.Since, r.Until)
	if r.DefaultWindow {
		if r.Period == usagePeriodMonthly {
			window = "since " + r.Since
		} else {
			window = fmt.Sprintf("last %d days", usageDailyDefaultDays)
		}
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

	periodHeader := "Date"
	if report.Period == usagePeriodMonthly {
		periodHeader = "Month"
	}
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
// ("daily" or "monthly"), next to the totals and the window they cover.
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
func usageTip(connected bool, dashboardURL string, terminal, jsonOut bool, noTips string) string {
	if jsonOut || !terminal || strings.TrimSpace(noTips) != "" {
		return ""
	}
	if connected {
		if dashboardURL = strings.TrimSpace(dashboardURL); dashboardURL != "" {
			return "→ Your dashboard: " + dashboardURL
		}
		return ""
	}
	return "→ Charts, cost by repo, and your whole team: usejunction login"
}
