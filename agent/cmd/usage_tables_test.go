package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/usejunction/agent/internal/types"
)

func init() {
	// Tables fit $COLUMNS when it is set; tests draw them at full width.
	os.Unsetenv("COLUMNS")
}

// tableRows splits a bordered table into its rows of trimmed cells.
func tableRows(text string) [][]string {
	var rows [][]string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "│") {
			continue
		}
		parts := strings.Split(strings.Trim(line, "│"), "│")
		cells := make([]string, len(parts))
		for i, part := range parts {
			cells[i] = strings.TrimSpace(part)
		}
		rows = append(rows, cells)
	}
	return rows
}

func hasRow(rows [][]string, want ...string) bool {
	for _, row := range rows {
		if len(row) < len(want) {
			continue
		}
		match := true
		for i, cell := range want {
			if row[i] != cell {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func renderForTest(t *testing.T, rows []types.DailyUsage, opts usageReportOptions, width int) string {
	t.Helper()
	previous := usageTerminalWidth
	usageTerminalWidth = func() int { return width }
	t.Cleanup(func() { usageTerminalWidth = previous })
	report, err := buildUsageReport(rows, usageTestNow, opts)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	renderUsageReport(&out, report, false)
	return out.String()
}

func TestUsageTableHasBordersAndATotalForPeriodsWithSeveralTools(t *testing.T) {
	text := renderForTest(t, usageTestRows(), usageReportOptions{}, 0)
	rows := tableRows(text)

	for _, border := range []string{" ┌", " ├", " └", "│ Date "} {
		if !strings.Contains(text, border) {
			t.Errorf("table has no %q:\n%s", border, text)
		}
	}
	// The 14th had Claude Code and Codex, so it gets a total; the 13th had one tool and does not.
	if !hasRow(rows, "", "All tools", "", "5.5K", "3.4K", "51K", "$47.95") {
		t.Errorf("no total for the 14th:\n%s", text)
	}
	if n := strings.Count(text, "All tools"); n != 1 {
		t.Errorf("All tools appears %d times, want once (only the 14th had two tools):\n%s", n, text)
	}
	// Each period starts under a rule: header rule, two periods, the total.
	if n := strings.Count(text, " ├"); n < 4 {
		t.Errorf("%d rules, want one under the header, one per period and one above the total:\n%s", n, text)
	}
}

func TestCostByToolAndByModelAreShownWithoutBreakdown(t *testing.T) {
	text := renderForTest(t, usageTestRows(), usageReportOptions{}, 0)
	rows := tableRows(text)

	if !strings.Contains(text, "Cost by tool") || !strings.Contains(text, "Cost by model") {
		t.Fatalf("no cost summary:\n%s", text)
	}
	for _, want := range [][]string{
		{"Claude Code", "$67.30", "87%"},
		{"Codex", "$9.75", "13%"},
		{"opus-4-5", "Claude Code", "$59.10", "77%"},
		{"gpt-5", "Codex", "$9.75", "13%"},
		{"sonnet-4-5", "Claude Code", "$8.20", "11%"},
	} {
		if !hasRow(rows, want...) {
			t.Errorf("cost summary has no row %v:\n%s", want, text)
		}
	}
	if !strings.Contains(text, "███████████████▍") { // opus-4-5's 77% of a 20-cell bar
		t.Errorf("no share bar:\n%s", text)
	}

	// One tool and one model: nothing to split, so no summary.
	single := renderForTest(t, usageTestRows(), usageReportOptions{Tool: "codex"}, 0)
	if strings.Contains(single, "Cost by tool") || strings.Contains(single, "Cost by model") {
		t.Errorf("a single tool and model got a summary:\n%s", single)
	}
}

func TestCostByModelGroupsTheTail(t *testing.T) {
	var rows []types.DailyUsage
	for i := 1; i <= 8; i++ {
		rows = append(rows, types.DailyUsage{Date: "2026-11-14", ToolName: "claude", Model: fmt.Sprintf("claude-opus-4-%d", i), InputTokens: 10, OutputTokens: 10, EstimatedCost: float64(i), CostKind: types.CostKindEstimatedAPI})
	}
	text := renderForTest(t, rows, usageReportOptions{}, 0)
	// Six models, then the two cheapest together: $1 + $2.
	if !hasRow(tableRows(text), "2 more", "", "$3.00", "8%") {
		t.Errorf("the tail is not grouped:\n%s", text)
	}
}

func TestUsageTableFitsTheTerminal(t *testing.T) {
	full := renderForTest(t, usageTestRows(), usageReportOptions{Breakdown: true}, 0)
	fullWidth := 0
	for _, line := range strings.Split(full, "\n") {
		if strings.HasPrefix(line, " ┌") && runeWidth(line) > fullWidth {
			fullWidth = runeWidth(line)
		}
	}

	narrow := renderForTest(t, usageTestRows(), usageReportOptions{Breakdown: true}, fullWidth-8)
	for _, line := range strings.Split(narrow, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "│") && runeWidth(line) > fullWidth-8 {
			t.Errorf("line wider than the terminal (%d): %q", fullWidth-8, line)
		}
	}
	if !strings.Contains(narrow, "│ Models") || !strings.Contains(narrow, "…") {
		t.Errorf("at %d columns the Models column should narrow, not go:\n%s", fullWidth-8, narrow)
	}

	tiny := renderForTest(t, usageTestRows(), usageReportOptions{Breakdown: true}, 66)
	if strings.Contains(tiny, "│ Models") {
		t.Errorf("at 66 columns the Models column should go:\n%s", tiny)
	}
	// A model row keeps its name, moved into the empty Tool cell.
	if !hasRow(tableRows(tiny), "", "└ sonnet-4-5") {
		t.Errorf("model rows lost their names:\n%s", tiny)
	}
}

func TestNotesNameIdleToolsAndUnpricedModels(t *testing.T) {
	rows := []types.DailyUsage{
		{Date: "2026-11-14", ToolName: "claude", Model: "big-pickle", InputTokens: 1_000, OutputTokens: 1_000, EstimatedCost: 0.5, CostKind: types.CostKindEstimatedAPI},
		{Date: "2026-11-14", ToolName: "claude", Model: "claude-opus-4-5", InputTokens: 1_000, OutputTokens: 1_000, EstimatedCost: 3, CostKind: types.CostKindEstimatedAPI},
		// Used in the logs read, but before the 30 days shown.
		{Date: "2026-10-02", ToolName: "codex", Model: "gpt-5", InputTokens: 1_000, OutputTokens: 100, EstimatedCost: 1, TokenSemantics: types.TokenSemanticsOpenAI},
		// A cost the vendor reported is not a guess, whatever the model.
		{Date: "2026-11-14", ToolName: "cursor", Model: "mystery-model", InputTokens: 10, OutputTokens: 10, EstimatedCost: 2, CostKind: types.CostKindVerifiedUsage},
	}
	text := renderForTest(t, rows, usageReportOptions{}, 0)
	for _, want := range []string{
		"No list price for big-pickle, so it is estimated at a default rate.",
		"Also found, not used in this period: Codex (last used 2026-10-02).",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("notes are missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "mystery-model, ") || strings.Contains(text, "No list price for big-pickle, mystery-model") {
		t.Errorf("a vendor-reported cost was called a guess:\n%s", text)
	}
}

func TestProgressLineNamesTheTools(t *testing.T) {
	report, _ := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{})
	if got := foundToolsLine(report.toolNames()); got != "Claude Code, Codex" {
		t.Errorf("progress line = %q, want the tools, most expensive first", got)
	}
	if got := foundToolsLine(nil); got != "nothing in this period" {
		t.Errorf("empty progress line = %q", got)
	}
}

func TestUsageJSONCarriesTheCostSplit(t *testing.T) {
	report, _ := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{})
	raw, err := json.Marshal(usageReportJSON(report))
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		ByTool  []usageShare `json:"byTool"`
		ByModel []usageShare `json:"byModel"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.ByTool) != 2 || decoded.ByTool[0].Name != "Claude Code" || decoded.ByTool[1].Name != "Codex" {
		t.Errorf("byTool = %+v", decoded.ByTool)
	}
	if len(decoded.ByModel) != 3 || decoded.ByModel[0].Name != "opus-4-5" || decoded.ByModel[0].Tool != "Claude Code" {
		t.Errorf("byModel = %+v", decoded.ByModel)
	}
	var shares float64
	for _, share := range decoded.ByTool {
		shares += share.Share
	}
	if shares < 0.999 || shares > 1.001 {
		t.Errorf("tool shares add up to %v, want 1", shares)
	}
}

func TestShareBarsAndPercents(t *testing.T) {
	cases := []struct {
		share float64
		bar   string
		text  string
	}{
		{1, strings.Repeat("█", 20), "100%"},
		{0.5, strings.Repeat("█", 10), "50%"},
		{0.0001, "▏", "<1%"},
		{0, "", "0%"},
	}
	for _, c := range cases {
		if got := shareBar(c.share, 20); got != c.bar {
			t.Errorf("shareBar(%v) = %q, want %q", c.share, got, c.bar)
		}
		if got := formatShare(c.share); got != c.text {
			t.Errorf("formatShare(%v) = %q, want %q", c.share, got, c.text)
		}
	}
}
