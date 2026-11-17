package cmd

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/scan"
)

func eventAt(day, clock, session, project, model string, cost float64) scan.UsageEvent {
	at, err := time.Parse("2006-01-02 15:04", day+" "+clock)
	if err != nil {
		panic(err)
	}
	return scan.UsageEvent{
		Time: at, SessionID: session, Project: project, Model: model,
		Input: 100, Output: 200, CacheRead: 1_000, CacheWrite: 50, Cost: cost,
	}
}

// Claude Code events around usageTestNow (2026-11-16 15:00 UTC).
func usageTestEvents() []scan.UsageEvent {
	return []scan.UsageEvent{
		// 14 Nov: one block from 09:00, then a second from 14:00.
		eventAt("2026-11-14", "09:10", "sess-a", "billing", "claude-opus-4-5-20251101", 2),
		eventAt("2026-11-14", "09:40", "sess-a", "billing", "claude-sonnet-4-5", 0.5),
		eventAt("2026-11-14", "13:20", "sess-b", "website", "claude-opus-4-5-20251101", 1),
		eventAt("2026-11-14", "14:05", "sess-b", "website", "claude-opus-4-5-20251101", 4),
		// 16 Nov: the block in progress, opened 40 minutes before "now".
		eventAt("2026-11-16", "14:20", "sess-c", "billing", "claude-opus-4-5-20251101", 3),
		eventAt("2026-11-16", "14:50", "sess-c", "billing", "claude-opus-4-5-20251101", 1),
	}
}

func TestBlocksOpenOnTheHourAndRunFiveHours(t *testing.T) {
	blocks := buildUsageBlocks(usageTestEvents(), usageTestNow)
	if len(blocks) != 3 {
		t.Fatalf("blocks = %d, want 3: %+v", len(blocks), blocks)
	}
	first, second, active := blocks[0], blocks[1], blocks[2]

	if got := first.Start.Format("15:04") + "-" + first.End.Format("15:04"); got != "09:00-14:00" {
		t.Errorf("first block = %s, want 09:00-14:00", got)
	}
	if first.EstimatedCost != 3.5 || strings.Join(first.Models, ",") != "opus-4-5,sonnet-4-5" || first.Active {
		t.Errorf("first block = %+v", first)
	}
	// 14:05 is past the first block's 5 hours, so it opens the next one.
	if second.Start.Format("15:04") != "14:00" || second.EstimatedCost != 4 {
		t.Errorf("second block = %+v", second)
	}

	if !active.Active || active.Start.Format("15:04") != "14:00" || active.MinutesLeft != 240 {
		t.Fatalf("active block = %+v, want 14:00 with 4h left", active)
	}
	// $4 in the 40 minutes since its first message is $6 an hour; 4 more hours add $24.
	if active.CostPerHour < 5.99 || active.CostPerHour > 6.01 || active.ProjectedCost < 27.99 || active.ProjectedCost > 28.01 {
		t.Errorf("pace = %v/hr, projected %v; want 6 and 28", active.CostPerHour, active.ProjectedCost)
	}

	// Once its 5 hours are over, nothing is active.
	later := buildUsageBlocks(usageTestEvents(), usageTestNow.Add(6*time.Hour))
	if later[len(later)-1].Active {
		t.Errorf("a block is still active an hour after it ended")
	}
	// Two minutes in, a pace would be noise.
	early := buildUsageBlocks(usageTestEvents()[:5], time.Date(2026, 11, 16, 14, 22, 0, 0, time.UTC))
	if last := early[len(early)-1]; !last.Active || last.CostPerHour != 0 || last.ProjectedCost != 0 {
		t.Errorf("a 2-minute-old block has a pace: %+v", last)
	}
}

func TestBlockReportWindowAndActiveOnly(t *testing.T) {
	window, err := resolveEventWindow(usageTestNow, "2026-11-16", "", usageBlockDefaultDays)
	if err != nil {
		t.Fatal(err)
	}
	report := buildBlockReport(usageTestEvents(), usageTestNow, window, false, false)
	if len(report.Blocks) != 1 || !report.Blocks[0].Active || report.Totals.EstimatedCost != 4 {
		t.Errorf("--since today = %+v", report.Blocks)
	}

	all, _ := resolveEventWindow(usageTestNow, "", "", usageBlockDefaultDays)
	if got := buildBlockReport(usageTestEvents(), usageTestNow, all, true, false); len(got.Blocks) != 1 || !got.Blocks[0].Active {
		t.Errorf("--active = %+v", got.Blocks)
	}
	newest := buildBlockReport(usageTestEvents(), usageTestNow, all, false, true)
	if len(newest.Blocks) != 3 || !newest.Blocks[0].Active {
		t.Errorf("--order desc = %+v", newest.Blocks)
	}
}

func TestSessionReportGroupsBySession(t *testing.T) {
	window, err := resolveEventWindow(usageTestNow, "", "", usageSessionDefaultDays)
	if err != nil {
		t.Fatal(err)
	}
	events := append(usageTestEvents(),
		// The session moved into a subfolder later; it keeps its first name.
		eventAt("2026-11-16", "14:55", "sess-c", "agent", "claude-opus-4-5-20251101", 0.25),
		// Outside the 30 days.
		eventAt("2026-09-30", "10:00", "sess-old", "billing", "claude-opus-4-5-20251101", 9),
	)
	report := buildSessionReport(events, window, true, false)
	if len(report.Rows) != 3 {
		t.Fatalf("sessions = %d, want 3: %+v", len(report.Rows), report.Rows)
	}
	a, b, c := report.Rows[0], report.Rows[1], report.Rows[2]
	if a.SessionID != "sess-a" || b.SessionID != "sess-b" || c.SessionID != "sess-c" {
		t.Errorf("order = %s, %s, %s; want least recently active first", a.SessionID, b.SessionID, c.SessionID)
	}
	if a.EstimatedCost != 2.5 || a.InputTokens != 200 || a.TotalTokens != 2*(100+200+1_000+50) {
		t.Errorf("sess-a = %+v", a.usageTokens)
	}
	if len(a.ModelBreakdown) != 2 || a.ModelBreakdown[0].Model != "opus-4-5" {
		t.Errorf("sess-a models = %+v", a.ModelBreakdown)
	}
	if c.Project != "billing" || c.EstimatedCost != 4.25 || c.LastActivity.Format("15:04") != "14:55" {
		t.Errorf("sess-c = %+v", c)
	}
	if report.Totals.EstimatedCost != 2.5+5+4.25 {
		t.Errorf("total = %v", report.Totals.EstimatedCost)
	}

	if newest := buildSessionReport(events, window, false, true); newest.Rows[0].SessionID != "sess-c" || newest.Rows[0].ModelBreakdown != nil {
		t.Errorf("--order desc without --breakdown = %+v", newest.Rows[0])
	}
}

// Sessions and blocks are shown in local time, so their days are local days.
func TestEventWindowUsesLocalDays(t *testing.T) {
	india := time.FixedZone("IST", 5*3600+30*60)
	now := time.Date(2026, 11, 16, 1, 0, 0, 0, india) // still 15 Nov in UTC
	window, err := resolveEventWindow(now, "", "", 7)
	if err != nil {
		t.Fatal(err)
	}
	if window.Since != "2026-11-10" || window.Until != "2026-11-16" || window.label() != "last 7 days" {
		t.Errorf("window = %s..%s (%s)", window.Since, window.Until, window.label())
	}
	if !window.holds(now) || window.holds(time.Date(2026, 11, 9, 23, 59, 0, 0, india)) {
		t.Errorf("window should hold today and not the day before it starts")
	}

	ranged, err := resolveEventWindow(now, "20261101", "2026-11-03", 7)
	if err != nil || ranged.label() != "2026-11-01 to 2026-11-03" || !ranged.holds(time.Date(2026, 11, 3, 23, 0, 0, 0, india)) {
		t.Errorf("ranged = %+v, %v", ranged, err)
	}
	if _, err := resolveEventWindow(now, "2026-11-10", "2026-11-01", 7); err == nil || !strings.Contains(err.Error(), "is after --until") {
		t.Errorf("reversed dates: %v", err)
	}
	if _, err := checkUsageOrder("sideways"); err == nil {
		t.Errorf("--order sideways was accepted")
	}
}

func TestRenderBlockAndSessionReports(t *testing.T) {
	window, _ := resolveEventWindow(usageTestNow, "", "", usageBlockDefaultDays)
	var out bytes.Buffer
	renderBlockReport(&out, buildBlockReport(usageTestEvents(), usageTestNow, window, false, false), usageTestNow, false)
	text := out.String()
	for _, want := range []string{
		"Claude Code 5-hour blocks · last 7 days · this machine",
		"│ 2026-11-14 09:00 │ 4h 10m",
		"│ 2026-11-16 14:00 │ active, 4h 00m left",
		"│ Total            │ 3 blocks",
		"Active block: $4.00 so far · $6.00/hr · about $28.00 by 19:00 at this pace",
		"A block is 5 hours from the hour of its first message",
		"Times are local.",
		"Nothing left this machine.",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("blocks table is missing %q:\n%s", want, text)
		}
	}

	sessions, _ := resolveEventWindow(usageTestNow, "", "", usageSessionDefaultDays)
	out.Reset()
	renderSessionReport(&out, buildSessionReport(usageTestEvents(), sessions, false, false), true)
	text = out.String()
	for _, want := range []string{
		"Claude Code sessions · last 30 days · this machine",
		"│ 2026-11-14 09:40 │ billing    │ opus-4-5, sonnet-4-5",
		"│ Total            │ 3 sessions │",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("sessions table is missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "Nothing left this machine") {
		t.Errorf("a connected device must not say nothing left the machine")
	}

	out.Reset()
	renderSessionReport(&out, buildSessionReport(nil, sessions, false, false), false)
	if !strings.Contains(out.String(), "No Claude Code sessions found on this machine between 2026-10-18 and 2026-11-16.") {
		t.Errorf("empty sessions = %s", out.String())
	}
}

func TestStatusline(t *testing.T) {
	var input statuslineInput
	if err := json.Unmarshal([]byte(`{"session_id":"sess-c","model":{"id":"claude-opus-4-5-20251101","display_name":"Opus 4.5"}}`), &input); err != nil {
		t.Fatal(err)
	}
	got := buildStatusline(usageTestEvents(), usageTestNow, input)
	if want := "Opus 4.5 · $4.00 session · $4.00 today · $4.00 block, 4h 00m left · $6.00/hr"; got != want {
		t.Errorf("status line = %q\nwant        %q", got, want)
	}

	// Run by hand, with no block in progress and nothing from Claude Code.
	quiet := buildStatusline(usageTestEvents(), usageTestNow.Add(24*time.Hour), statuslineInput{})
	if quiet != "$0.00 today" {
		t.Errorf("quiet status line = %q", quiet)
	}

	input.Model.DisplayName = ""
	if got := buildStatusline(nil, usageTestNow, input); got != "opus-4-5 · $0.00 today" {
		t.Errorf("status line with no usage = %q", got)
	}
}

func TestSessionAndBlockCommands(t *testing.T) {
	var sessions struct {
		Sessions []struct {
			SessionID string  `json:"sessionId"`
			Project   string  `json:"project"`
			Cost      float64 `json:"estimatedCost"`
		} `json:"sessions"`
		Tool string `json:"tool"`
	}
	if err := json.Unmarshal([]byte(runUsageCommand(t, "session", "--json", "--order", "desc")), &sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions.Sessions) != 3 || sessions.Sessions[0].SessionID != "sess-c" || sessions.Tool != "claude" {
		t.Errorf("session --json = %+v", sessions)
	}

	text := runUsageCommand(t, "blocks", "--active")
	if !strings.Contains(text, "active, 4h 00m left") || strings.Contains(text, "2026-11-14") {
		t.Errorf("blocks --active:\n%s", text)
	}
	// Not a terminal, so no sign-in line.
	if strings.Contains(text, "usejunction login") {
		t.Errorf("the sign-in line reached output that is not a terminal:\n%s", text)
	}
}

func TestStatuslineCommandReadsClaudeCodeInput(t *testing.T) {
	rootCmd.SetIn(strings.NewReader(`{"session_id":"sess-c","model":{"display_name":"Opus 4.5"},"transcript_path":"/tmp/x.jsonl"}`))
	text := runUsageCommand(t, "statusline")
	if text != "Opus 4.5 · $4.00 session · $4.00 today · $4.00 block, 4h 00m left · $6.00/hr\n" {
		t.Errorf("statusline printed %q; it must be exactly one line", text)
	}
}
