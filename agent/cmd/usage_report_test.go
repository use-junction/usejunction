package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/types"
)

// 2026-11-16 UTC. The scanner reads 60 days back, so history starts 2026-09-17.
var usageTestNow = time.Date(2026, 11, 16, 15, 0, 0, 0, time.UTC)

func usageTestRows() []types.DailyUsage {
	return []types.DailyUsage{
		// Two models on one day fold into one Claude Code row.
		{Date: "2026-11-14", ToolName: "claude", Model: "claude-opus-4-5-20251101", InputTokens: 1_000, OutputTokens: 2_000, CacheReadTokens: 40_000, CacheWriteTokens: 5_000, EstimatedCost: 30, CostKind: types.CostKindEstimatedAPI},
		{Date: "2026-11-14", ToolName: "claude", Model: "claude-sonnet-4-5", InputTokens: 500, OutputTokens: 500, EstimatedCost: 8.2, CostKind: types.CostKindEstimatedAPI},
		// Codex counts cached tokens inside its input; the table must not count them twice.
		{Date: "2026-11-14", ToolName: "codex", Model: "gpt-5", InputTokens: 10_000, OutputTokens: 900, CacheReadTokens: 6_000, EstimatedCost: 9.75, TokenSemantics: types.TokenSemanticsOpenAI},
		{Date: "2026-11-13", ToolName: "claude", Model: "claude-opus-4-5-20251101", InputTokens: 900, OutputTokens: 240, EstimatedCost: 29.1},
		// Lines of code, not tokens: never part of a cost table.
		{Date: "2026-11-14", ToolName: "copilot", MetricKind: types.MetricKindProductivity, AcceptedLines: 40},
		// Older than the default 30 days, inside the 60 the scanner reads.
		{Date: "2026-10-02", ToolName: "claude", Model: "claude-opus-4-5-20251101", InputTokens: 100, OutputTokens: 100, EstimatedCost: 4},
		{Date: "2026-09-20", ToolName: "claude", Model: "claude-opus-4-5-20251101", InputTokens: 100, OutputTokens: 100, EstimatedCost: 2},
	}
}

func TestDailyReportGroupsByDayAndTool(t *testing.T) {
	report, err := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Period: usagePeriodDaily})
	if err != nil {
		t.Fatal(err)
	}
	if report.Since != "2026-10-18" || report.Until != "2026-11-16" {
		t.Fatalf("window = %s..%s, want the last 30 days", report.Since, report.Until)
	}
	if len(report.Rows) != 3 {
		t.Fatalf("rows = %d, want 3 (the 13th, then Claude Code and Codex on the 14th): %+v", len(report.Rows), report.Rows)
	}

	first, claude, codex := report.Rows[0], report.Rows[1], report.Rows[2]
	if first.Period != "2026-11-13" {
		t.Errorf("first row = %s, want oldest first", first.Period)
	}
	if claude.ToolName != "Claude Code" || codex.ToolName != "Codex" {
		t.Errorf("14th = %s then %s, want the more expensive tool first", claude.ToolName, codex.ToolName)
	}
	if got := strings.Join(claude.Models, ","); got != "opus-4-5,sonnet-4-5" {
		t.Errorf("models = %s, want short names, most expensive first", got)
	}
	if claude.InputTokens != 1_500 || claude.OutputTokens != 2_500 || claude.CacheReadTokens != 40_000 || claude.CacheWriteTokens != 5_000 {
		t.Errorf("claude tokens = %+v", claude.usageTokens)
	}
	if codex.InputTokens != 4_000 || codex.TotalTokens != 4_000+900+6_000 {
		t.Errorf("codex input = %d, total = %d; cached tokens were counted twice", codex.InputTokens, codex.TotalTokens)
	}
	if want := 30 + 8.2 + 9.75 + 29.1; report.Totals.EstimatedCost < want-0.001 || report.Totals.EstimatedCost > want+0.001 {
		t.Errorf("total cost = %v, want %v", report.Totals.EstimatedCost, want)
	}
	if claude.ModelBreakdown != nil {
		t.Errorf("model lines shown without --breakdown")
	}
}

func TestDailyReportOptions(t *testing.T) {
	newest, err := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Order: "desc"})
	if err != nil {
		t.Fatal(err)
	}
	if newest.Rows[0].Period != "2026-11-14" {
		t.Errorf("--order desc starts at %s", newest.Rows[0].Period)
	}

	for _, name := range []string{"codex", "Codex"} {
		only, err := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Tool: name})
		if err != nil {
			t.Fatal(err)
		}
		if len(only.Rows) != 1 || only.Rows[0].Tool != "codex" {
			t.Errorf("--tool %s rows = %+v", name, only.Rows)
		}
	}
	byName, _ := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Tool: "claude-code"})
	if len(byName.Rows) != 2 {
		t.Errorf("--tool claude-code rows = %d, want 2", len(byName.Rows))
	}

	withModels, _ := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Breakdown: true})
	if lines := withModels.Rows[1].ModelBreakdown; len(lines) != 2 || lines[0].Model != "opus-4-5" || lines[0].EstimatedCost != 30 {
		t.Errorf("--breakdown lines = %+v", lines)
	}

	// ccusage users type dates without dashes.
	ranged, err := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Since: "20261001", Until: "2026-10-31"})
	if err != nil {
		t.Fatal(err)
	}
	if len(ranged.Rows) != 1 || ranged.Rows[0].Period != "2026-10-02" || ranged.DefaultWindow {
		t.Errorf("--since/--until rows = %+v", ranged.Rows)
	}
}

func TestUsageReportRejectsBadFlags(t *testing.T) {
	cases := map[string]usageReportOptions{
		"not a date":           {Since: "last week"},
		"is after --until":     {Since: "2026-11-10", Until: "2026-11-01"},
		"--order must be asc":  {Order: "sideways"},
		"--until: \"2026-13\"": {Until: "2026-13"},
	}
	for want, opts := range cases {
		_, err := buildUsageReport(nil, usageTestNow, opts)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%+v: error = %v, want it to mention %q", opts, err, want)
		}
	}
}

// Only 60 days of logs are read, so a month can be partial at either end. The
// table has to say so instead of passing a part off as the whole month.
func TestMonthlyReportSaysWhichDaysAMonthCovers(t *testing.T) {
	report, err := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Period: usagePeriodMonthly})
	if err != nil {
		t.Fatal(err)
	}
	if report.Since != "2026-09-17" {
		t.Fatalf("monthly starts %s, want the start of local history", report.Since)
	}
	got := map[string]string{}
	for _, row := range report.Rows {
		if row.Tool == "claude" {
			got[row.Period] = row.Covers
		}
	}
	want := map[string]string{"2026-09": "from 2026-09-17", "2026-10": "", "2026-11": "to 2026-11-16"}
	for month, covers := range want {
		if value, ok := got[month]; !ok || value != covers {
			t.Errorf("%s covers %q (present %v), want %q", month, value, ok, covers)
		}
	}
}

func TestRenderUsageReport(t *testing.T) {
	report, _ := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Breakdown: true})
	var out bytes.Buffer
	renderUsageReport(&out, report, false)
	text := out.String()

	for _, want := range []string{
		"AI coding usage · last 30 days · this machine",
		"Date        Tool         Models",
		"2026-11-13  Claude Code  opus-4-5",
		"└ sonnet-4-5",
		"$9.75",
		"$77.05",
		"Estimated at API list prices from local logs, not your bill. Days are UTC.",
		"Nothing left this machine.",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("table is missing %q:\n%s", want, text)
		}
	}
	if strings.Count(text, "2026-11-14") != 1 {
		t.Errorf("a day should be named once, on its first row:\n%s", text)
	}
	var total string
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "Total") {
			total = line
		}
	}
	if !strings.HasSuffix(total, "$77.05") {
		t.Errorf("total line = %q", total)
	}

	// A connected device syncs in the background, so the claim is dropped.
	out.Reset()
	renderUsageReport(&out, report, true)
	if strings.Contains(out.String(), "Nothing left this machine") {
		t.Errorf("a connected device must not say nothing left the machine")
	}

	early, _ := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Since: "2026-01-01"})
	out.Reset()
	renderUsageReport(&out, early, false)
	if !strings.Contains(out.String(), "Only the last 60 days are read, so nothing before 2026-09-17 is shown.") {
		t.Errorf("asking for days before local history should say they are missing:\n%s", out.String())
	}

	empty, _ := buildUsageReport(nil, usageTestNow, usageReportOptions{})
	out.Reset()
	renderUsageReport(&out, empty, false)
	if !strings.Contains(out.String(), "No AI coding usage found on this machine between 2026-10-18 and 2026-11-16.") ||
		!strings.Contains(out.String(), "usejunction --help") {
		t.Errorf("empty table = %s", out.String())
	}
}

func TestUsageNumberFormats(t *testing.T) {
	tokens := map[int]string{0: "0", 950: "950", 1_000: "1K", 12_340: "12.3K", 310_000: "310K", 999_960: "1M", 1_200_000: "1.2M", 48_000_000: "48M", 1_600_000_000: "1.6B"}
	for n, want := range tokens {
		if got := formatTokens(n); got != want {
			t.Errorf("formatTokens(%d) = %s, want %s", n, got, want)
		}
	}
	costs := map[float64]string{0: "—", 0.004: "$0.00", 9.75: "$9.75", 412.06: "$412.06", 12345.6: "$12,345.60"}
	for amount, want := range costs {
		if got := formatCost(amount); got != want {
			t.Errorf("formatCost(%v) = %s, want %s", amount, got, want)
		}
	}
}

// The line under the table is for a person at a terminal. A script, a pipe or
// --json must never get it, and it can be switched off.
func TestUsageTip(t *testing.T) {
	signIn := "→ Charts, cost by repo, and your whole team: usejunction login"
	if got := usageTip(false, "", true, false, "", "usejunction login"); got != signIn {
		t.Errorf("tip = %q", got)
	}
	if got := usageTip(true, "https://usejunction.dev", true, false, "", "usejunction login"); got != "→ Your dashboard: https://usejunction.dev" {
		t.Errorf("connected tip = %q", got)
	}
	silent := map[string]string{
		"piped":     usageTip(false, "", false, false, "", "usejunction login"),
		"json":      usageTip(false, "", true, true, "", "usejunction login"),
		"opted out": usageTip(false, "", true, false, "1", "usejunction login"),
		"no url":    usageTip(true, "", true, false, "", "usejunction login"),
	}
	for name, got := range silent {
		if got != "" {
			t.Errorf("%s: tip = %q, want none", name, got)
		}
	}
}

// Through npx the agent is not on PATH, so "usejunction login" would not run.
// The line has to name a command that does.
func TestUsageSignInCommandFitsHowTheAgentWasRun(t *testing.T) {
	cases := []struct{ runner, goos, want string }{
		{"", "darwin", "usejunction login"},
		{"brew", "linux", "usejunction login"},
		{"npx", "darwin", "curl -fsSL https://usejunction.dev/install.sh | bash"},
		{"npx", "linux", "curl -fsSL https://usejunction.dev/install.sh | bash"},
		{"NPX", "windows", "irm https://usejunction.dev/install.ps1 | iex"},
	}
	for _, c := range cases {
		if got := usageSignInCommand(c.runner, c.goos, "https://usejunction.dev/"); got != c.want {
			t.Errorf("runner %q on %s: %q, want %q", c.runner, c.goos, got, c.want)
		}
	}
}

// A real run parses flags once. Tests run several commands in one process, so
// the values a previous command set have to be cleared.
func resetUsageFlags() {
	usageSince, usageUntil, usageTool, usageOrder = "", "", "all", "asc"
	usageJSON, usageBreakdown, usageActiveOnly = false, false, false
	usageLast = 0
}

func runUsageCommand(t *testing.T, args ...string) string {
	t.Helper()
	resetUsageFlags()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USEJUNCTION_HOME", filepath.Join(home, ".usejunction"))

	// Other tests leave the shared --format flag on "json".
	previousFormat := format
	format = "text"
	previousScan, previousNow, previousEvents := scanUsageForReport, usageReportNow, scanClaudeEventsForReport
	scanUsageForReport = func(context.Context) ([]types.DailyUsage, bool) { return usageTestRows(), true }
	scanClaudeEventsForReport = func(time.Time) []scan.UsageEvent { return usageTestEvents() }
	usageReportNow = func() time.Time { return usageTestNow }
	var out bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetArgs(append([]string{}, args...))
	t.Cleanup(func() {
		format = previousFormat
		scanUsageForReport, usageReportNow, scanClaudeEventsForReport = previousScan, previousNow, previousEvents
		resetUsageFlags()
		rootCmd.SetOut(nil)
		rootCmd.SetIn(nil)
		rootCmd.SetArgs(nil)
	})
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("usejunction %s: %v", strings.Join(args, " "), err)
	}
	return out.String()
}

// Typing just "usejunction" shows the table, with no account and no sign-in.
func TestBareCommandShowsTheDailyTable(t *testing.T) {
	text := runUsageCommand(t)
	if !strings.Contains(text, "AI coding usage · last 30 days · this machine") || !strings.Contains(text, "$77.05") {
		t.Fatalf("bare command output:\n%s", text)
	}
	if !strings.Contains(text, "Nothing left this machine.") {
		t.Errorf("an unconnected machine should be told nothing was uploaded:\n%s", text)
	}
	// Test output is not a terminal, so the sign-in line stays out.
	if strings.Contains(text, "usejunction login") {
		t.Errorf("the sign-in line reached output that is not a terminal:\n%s", text)
	}
}

func TestMonthlyJSON(t *testing.T) {
	text := runUsageCommand(t, "monthly", "--json")
	var parsed struct {
		Monthly []struct {
			Period string  `json:"period"`
			Covers string  `json:"covers"`
			Tool   string  `json:"tool"`
			Cost   float64 `json:"estimatedCost"`
		} `json:"monthly"`
		Totals struct {
			Cost        float64 `json:"estimatedCost"`
			TotalTokens int     `json:"totalTokens"`
		} `json:"totals"`
		Since     string `json:"since"`
		Timezone  string `json:"timezone"`
		CostBasis string `json:"costBasis"`
	}
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		t.Fatalf("--json did not print JSON alone: %v\n%s", err, text)
	}
	if len(parsed.Monthly) != 4 || parsed.Monthly[0].Period != "2026-09" || parsed.Monthly[0].Covers != "from 2026-09-17" {
		t.Errorf("monthly rows = %+v", parsed.Monthly)
	}
	if parsed.Since != "2026-09-17" || parsed.Timezone != "UTC" || parsed.CostBasis != "estimated_api_list_price" {
		t.Errorf("since %q, timezone %q, cost basis %q", parsed.Since, parsed.Timezone, parsed.CostBasis)
	}
	if parsed.Totals.Cost < 83.04 || parsed.Totals.Cost > 83.06 {
		t.Errorf("total cost = %v, want 83.05", parsed.Totals.Cost)
	}
}

func TestEmptyReportJSONHasAnEmptyList(t *testing.T) {
	report, _ := buildUsageReport(nil, usageTestNow, usageReportOptions{})
	encoded, err := json.Marshal(usageReportJSON(report))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"daily":[]`) || !strings.Contains(string(encoded), `"costBasis":"none"`) {
		t.Errorf("empty report JSON = %s", encoded)
	}
}
