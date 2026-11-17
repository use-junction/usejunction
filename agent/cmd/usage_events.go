package cmd

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/ui"
)

// Session and 5-hour block reports for Claude Code. They are built from single
// model responses rather than per-day totals, so they can use local time.

const (
	usageSessionDefaultDays = 30
	usageBlockDefaultDays   = 7
	// Claude counts usage limits in 5-hour windows from the first message.
	usageBlockLength = 5 * time.Hour
	// Block edges depend on the activity before them, so the scan starts this
	// far ahead of the first day shown.
	usageBlockLeadIn = 48 * time.Hour
	// A pace measured over less than this says nothing about the next hours.
	usageBlockMinPaceWindow = 10 * time.Minute

	usageProjectColumnMax = 22
	usageMinuteLayout     = "2006-01-02 15:04"
)

// usageEventWindow is the span of local days a session or block report shows.
type usageEventWindow struct {
	From, To      time.Time
	Since, Until  string
	DefaultWindow bool
	Days          int
}

func resolveEventWindow(now time.Time, since, until string, defaultDays int) (usageEventWindow, error) {
	window := usageEventWindow{Days: defaultDays}
	since, until = strings.TrimSpace(since), strings.TrimSpace(until)
	window.DefaultWindow = since == "" && until == ""
	location := now.Location()
	startOfDay := func(t time.Time) time.Time {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, location)
	}

	last := startOfDay(now)
	if until != "" {
		day, err := parseUsageDate(until)
		if err != nil {
			return window, fmt.Errorf("--until: %w", err)
		}
		last, _ = time.ParseInLocation(usageDateLayout, day, location)
	}
	first := last.AddDate(0, 0, -(defaultDays - 1))
	if since != "" {
		day, err := parseUsageDate(since)
		if err != nil {
			return window, fmt.Errorf("--since: %w", err)
		}
		first, _ = time.ParseInLocation(usageDateLayout, day, location)
	}
	if first.After(last) {
		return window, fmt.Errorf("--since %s is after --until %s", first.Format(usageDateLayout), last.Format(usageDateLayout))
	}
	window.From = first
	window.To = last.AddDate(0, 0, 1)
	window.Since = first.Format(usageDateLayout)
	window.Until = last.Format(usageDateLayout)
	return window, nil
}

func (w usageEventWindow) label() string {
	if w.DefaultWindow {
		return fmt.Sprintf("last %d days", w.Days)
	}
	return fmt.Sprintf("%s to %s", w.Since, w.Until)
}

func (w usageEventWindow) holds(at time.Time) bool {
	return !at.Before(w.From) && at.Before(w.To)
}

func checkUsageOrder(order string) (descending bool, err error) {
	switch strings.ToLower(strings.TrimSpace(order)) {
	case "", "asc":
		return false, nil
	case "desc":
		return true, nil
	}
	return false, fmt.Errorf("--order must be asc or desc, not %q", order)
}

// modelTally collects tokens per model for one session or block.
type modelTally map[string]*usageModelLine

func (m modelTally) add(event scan.UsageEvent) {
	model := shortModelName(event.Model)
	line := m[model]
	if line == nil {
		line = &usageModelLine{Model: model}
		m[model] = line
	}
	line.add(event.Input, event.Output, event.CacheRead, event.CacheWrite, event.Cost)
}

// lines returns the models, most expensive first.
func (m modelTally) lines() []usageModelLine {
	lines := make([]usageModelLine, 0, len(m))
	for _, line := range m {
		lines = append(lines, *line)
	}
	sort.Slice(lines, func(i, j int) bool {
		if lines[i].EstimatedCost != lines[j].EstimatedCost {
			return lines[i].EstimatedCost > lines[j].EstimatedCost
		}
		if lines[i].TotalTokens != lines[j].TotalTokens {
			return lines[i].TotalTokens > lines[j].TotalTokens
		}
		return lines[i].Model < lines[j].Model
	})
	return lines
}

func modelNames(lines []usageModelLine) []string {
	names := make([]string, len(lines))
	for i, line := range lines {
		names[i] = line.Model
	}
	return names
}

type usageSessionRow struct {
	SessionID     string    `json:"sessionId"`
	Project       string    `json:"project"`
	FirstActivity time.Time `json:"firstActivity"`
	LastActivity  time.Time `json:"lastActivity"`
	Models        []string  `json:"models"`
	usageTokens
	ModelBreakdown []usageModelLine `json:"modelBreakdown,omitempty"`
}

type usageSessionReport struct {
	Window usageEventWindow
	Rows   []usageSessionRow
	Totals usageTokens
}

// buildSessionReport folds events into one row per session. A session that
// runs past the window counts only the part inside it.
func buildSessionReport(events []scan.UsageEvent, window usageEventWindow, breakdown, descending bool) usageSessionReport {
	report := usageSessionReport{Window: window}
	type bucket struct {
		row    usageSessionRow
		models modelTally
	}
	sessions := map[string]*bucket{}
	for _, event := range events {
		if !window.holds(event.Time) {
			continue
		}
		b := sessions[event.SessionID]
		if b == nil {
			b = &bucket{row: usageSessionRow{SessionID: event.SessionID, FirstActivity: event.Time}, models: modelTally{}}
			sessions[event.SessionID] = b
		}
		// The folder the session started in names it, wherever it moved later.
		if b.row.Project == "" {
			b.row.Project = event.Project
		}
		if event.Time.Before(b.row.FirstActivity) {
			b.row.FirstActivity = event.Time
		}
		if event.Time.After(b.row.LastActivity) {
			b.row.LastActivity = event.Time
		}
		b.models.add(event)
		b.row.add(event.Input, event.Output, event.CacheRead, event.CacheWrite, event.Cost)
		report.Totals.add(event.Input, event.Output, event.CacheRead, event.CacheWrite, event.Cost)
	}
	for _, b := range sessions {
		lines := b.models.lines()
		b.row.Models = modelNames(lines)
		if breakdown {
			b.row.ModelBreakdown = lines
		}
		report.Rows = append(report.Rows, b.row)
	}
	sort.Slice(report.Rows, func(i, j int) bool {
		left, right := report.Rows[i], report.Rows[j]
		if !left.LastActivity.Equal(right.LastActivity) {
			if descending {
				return left.LastActivity.After(right.LastActivity)
			}
			return left.LastActivity.Before(right.LastActivity)
		}
		return left.SessionID < right.SessionID
	})
	return report
}

type usageBlock struct {
	// Start is the hour the block's first message fell in; End is 5 hours on.
	Start         time.Time `json:"start"`
	End           time.Time `json:"end"`
	FirstActivity time.Time `json:"firstActivity"`
	LastActivity  time.Time `json:"lastActivity"`
	Active        bool      `json:"active"`
	Models        []string  `json:"models"`
	usageTokens
	// Set on the active block only, once there is enough of it to measure.
	MinutesLeft   int     `json:"minutesLeft,omitempty"`
	CostPerHour   float64 `json:"costPerHour,omitempty"`
	ProjectedCost float64 `json:"projectedCost,omitempty"`
}

// buildUsageBlocks groups events into 5-hour blocks. A block opens on the hour
// of its first message. The next message after the block's 5 hours, or after 5
// quiet hours, opens a new one. The last block is active while now is inside
// its 5 hours.
func buildUsageBlocks(events []scan.UsageEvent, now time.Time) []usageBlock {
	var blocks []usageBlock
	var models modelTally
	closeBlock := func() {
		if len(blocks) == 0 {
			return
		}
		blocks[len(blocks)-1].Models = modelNames(models.lines())
	}
	for _, event := range events {
		opensBlock := len(blocks) == 0
		if !opensBlock {
			current := blocks[len(blocks)-1]
			opensBlock = !event.Time.Before(current.End) || event.Time.Sub(current.LastActivity) >= usageBlockLength
		}
		if opensBlock {
			closeBlock()
			start := event.Time.UTC().Truncate(time.Hour)
			blocks = append(blocks, usageBlock{Start: start, End: start.Add(usageBlockLength), FirstActivity: event.Time})
			models = modelTally{}
		}
		block := &blocks[len(blocks)-1]
		block.LastActivity = event.Time
		block.add(event.Input, event.Output, event.CacheRead, event.CacheWrite, event.Cost)
		models.add(event)
	}
	closeBlock()

	if len(blocks) > 0 {
		last := &blocks[len(blocks)-1]
		if now.Before(last.End) && !now.Before(last.Start) {
			last.Active = true
			left := last.End.Sub(now)
			last.MinutesLeft = int(left.Minutes())
			if elapsed := now.Sub(last.FirstActivity); elapsed >= usageBlockMinPaceWindow && last.EstimatedCost > 0 {
				last.CostPerHour = last.EstimatedCost / elapsed.Hours()
				last.ProjectedCost = last.EstimatedCost + last.CostPerHour*left.Hours()
			}
		}
	}
	return blocks
}

type usageBlockReport struct {
	Window usageEventWindow
	Blocks []usageBlock
	Totals usageTokens
}

func buildBlockReport(events []scan.UsageEvent, now time.Time, window usageEventWindow, activeOnly, descending bool) usageBlockReport {
	report := usageBlockReport{Window: window}
	for _, block := range buildUsageBlocks(events, now) {
		if activeOnly && !block.Active {
			continue
		}
		// The active block always shows, even when it opened before the window.
		if !block.Active && !window.holds(block.Start) {
			continue
		}
		report.Blocks = append(report.Blocks, block)
		report.Totals.add(block.InputTokens, block.OutputTokens, block.CacheReadTokens, block.CacheWriteTokens, block.EstimatedCost)
	}
	if descending {
		for i, j := 0, len(report.Blocks)-1; i < j; i, j = i+1, j-1 {
			report.Blocks[i], report.Blocks[j] = report.Blocks[j], report.Blocks[i]
		}
	}
	return report
}

// formatSpan prints a length of time as "2h 14m" or "14m".
func formatSpan(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	minutes := int(d.Minutes())
	if minutes < 60 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%dh %02dm", minutes/60, minutes%60)
}

func eventMethod(connected bool, extra ...string) []string {
	lines := []string{"Estimated at API list prices from local logs, not your bill. Times are local."}
	lines = append(lines, extra...)
	if !connected {
		lines = append(lines, "Nothing left this machine.")
	}
	return lines
}

func writeMethod(w io.Writer, lines []string) {
	for _, line := range lines {
		fmt.Fprintf(w, " %s\n", ui.Muted(line))
	}
}

func tokenCells(t usageTokens) []string {
	return []string{
		formatTokens(t.InputTokens), formatTokens(t.OutputTokens),
		formatTokens(t.CacheReadTokens + t.CacheWriteTokens), formatCost(t.EstimatedCost),
	}
}

func renderSessionReport(w io.Writer, report usageSessionReport, connected bool) {
	fmt.Fprintf(w, "\n %s\n\n", ui.Strong(fmt.Sprintf("Claude Code sessions · %s · this machine", report.Window.label())))
	if len(report.Rows) == 0 {
		fmt.Fprintf(w, " No Claude Code sessions found on this machine between %s and %s.\n\n", report.Window.Since, report.Window.Until)
		return
	}
	location := report.Window.From.Location()
	const textColumns = 3
	table := [][]string{{"Last active", "Project", "Models", "Input", "Output", "Cache", "Cost"}}
	for _, row := range report.Rows {
		project := row.Project
		if project == "" {
			project = "unknown"
		}
		line := []string{
			row.LastActivity.In(location).Format(usageMinuteLayout),
			cutToWidth(project, usageProjectColumnMax),
			cutToWidth(strings.Join(row.Models, ", "), usageModelsColumnMax),
		}
		table = append(table, append(line, tokenCells(row.usageTokens)...))
		for _, model := range row.ModelBreakdown {
			table = append(table, append([]string{"", "", cutToWidth("└ "+model.Model, usageModelsColumnMax)}, tokenCells(model.usageTokens)...))
		}
	}
	total := append([]string{"Total", fmt.Sprintf("%d %s", len(report.Rows), plural(len(report.Rows), "session", "sessions")), ""}, tokenCells(report.Totals)...)
	writeUsageTable(w, table, total, textColumns)
	fmt.Fprintln(w)
	writeMethod(w, eventMethod(connected))
}

func renderBlockReport(w io.Writer, report usageBlockReport, now time.Time, connected bool) {
	fmt.Fprintf(w, "\n %s\n\n", ui.Strong(fmt.Sprintf("Claude Code 5-hour blocks · %s · this machine", report.Window.label())))
	if len(report.Blocks) == 0 {
		fmt.Fprintf(w, " No Claude Code usage found on this machine between %s and %s.\n\n", report.Window.Since, report.Window.Until)
		return
	}
	location := now.Location()
	const textColumns = 3
	table := [][]string{{"Started", "Lasted", "Models", "Input", "Output", "Cache", "Cost"}}
	var active *usageBlock
	for i := range report.Blocks {
		block := report.Blocks[i]
		lasted := formatSpan(block.LastActivity.Sub(block.FirstActivity))
		if block.Active {
			active = &report.Blocks[i]
			lasted = fmt.Sprintf("active, %s left", formatSpan(block.End.Sub(now)))
		}
		line := []string{
			block.Start.In(location).Format(usageMinuteLayout), lasted,
			cutToWidth(strings.Join(block.Models, ", "), usageModelsColumnMax),
		}
		table = append(table, append(line, tokenCells(block.usageTokens)...))
	}
	total := append([]string{"Total", fmt.Sprintf("%d %s", len(report.Blocks), plural(len(report.Blocks), "block", "blocks")), ""}, tokenCells(report.Totals)...)
	writeUsageTable(w, table, total, textColumns)
	fmt.Fprintln(w)
	if active != nil {
		fmt.Fprintf(w, " %s\n", activeBlockLine(*active, location))
	}
	writeMethod(w, eventMethod(connected, "A block is 5 hours from the hour of its first message, the window Claude's usage limits run on."))
}

// activeBlockLine sums up the block in progress: spend so far, pace, and where
// that pace ends up when the block closes.
func activeBlockLine(block usageBlock, location *time.Location) string {
	line := fmt.Sprintf("Active block: %s so far", formatCost(block.EstimatedCost))
	if block.CostPerHour > 0 {
		line += fmt.Sprintf(" · %s/hr · about %s by %s at this pace",
			formatCost(block.CostPerHour), formatCost(block.ProjectedCost), block.End.In(location).Format("15:04"))
	}
	return line
}

func sessionReportJSON(report usageSessionReport) map[string]any {
	rows := report.Rows
	if rows == nil {
		rows = []usageSessionRow{}
	}
	return map[string]any{
		"sessions": rows, "totals": report.Totals,
		"since": report.Window.Since, "until": report.Window.Until,
		"tool": "claude", "costBasis": eventCostBasis(report.Totals),
	}
}

func blockReportJSON(report usageBlockReport) map[string]any {
	blocks := report.Blocks
	if blocks == nil {
		blocks = []usageBlock{}
	}
	return map[string]any{
		"blocks": blocks, "totals": report.Totals,
		"since": report.Window.Since, "until": report.Window.Until,
		"tool": "claude", "costBasis": eventCostBasis(report.Totals),
	}
}

func eventCostBasis(totals usageTokens) string {
	if totals.EstimatedCost <= 0 {
		return "none"
	}
	return "estimated_api_list_price"
}

// statuslineInput is the part of Claude Code's status line payload used here.
type statuslineInput struct {
	SessionID string `json:"session_id"`
	Model     struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	} `json:"model"`
}

// buildStatusline is the single line Claude Code shows under the prompt: the
// model, then what this session, today and the current 5-hour block have cost.
func buildStatusline(events []scan.UsageEvent, now time.Time, input statuslineInput) string {
	var parts []string
	if name := strings.TrimSpace(input.Model.DisplayName); name != "" {
		parts = append(parts, name)
	} else if id := strings.TrimSpace(input.Model.ID); id != "" {
		parts = append(parts, shortModelName(id))
	}

	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var session, today float64
	sessionSeen := false
	for _, event := range events {
		if input.SessionID != "" && event.SessionID == input.SessionID {
			session += event.Cost
			sessionSeen = true
		}
		if !event.Time.Before(midnight) {
			today += event.Cost
		}
	}
	if sessionSeen {
		parts = append(parts, statusCost(session)+" session")
	}
	parts = append(parts, statusCost(today)+" today")

	blocks := buildUsageBlocks(events, now)
	if len(blocks) > 0 && blocks[len(blocks)-1].Active {
		block := blocks[len(blocks)-1]
		parts = append(parts, fmt.Sprintf("%s block, %s left", statusCost(block.EstimatedCost), formatSpan(block.End.Sub(now))))
		if block.CostPerHour > 0 {
			parts = append(parts, statusCost(block.CostPerHour)+"/hr")
		}
	}
	return strings.Join(parts, " · ")
}

// statusCost shows zero as $0.00; the table's dash would read as "unknown".
func statusCost(amount float64) string {
	if amount <= 0 {
		return "$0.00"
	}
	return formatCost(amount)
}
