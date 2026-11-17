package cmd

import (
	"strings"
	"testing"
	"time"
)

// usageTestNow is Monday 2026-11-16, so "this week" has only today in it and
// the usage on Friday the 13th and Saturday the 14th belongs to last week.

func TestWeekStartIsTheMondayBefore(t *testing.T) {
	for day, want := range map[string]string{
		"2026-11-16": "2026-11-16", // a Monday is its own week's start
		"2026-11-15": "2026-11-09", // Sunday ends the week before
		"2026-11-14": "2026-11-09",
		"2026-01-01": "2025-12-29", // a week can start in the year before
	} {
		date, _ := time.Parse(usageDateLayout, day)
		if got := weekStart(date).Format(usageDateLayout); got != want {
			t.Errorf("weekStart(%s) = %s, want %s", day, got, want)
		}
	}
}

func TestWeeklyReportGroupsByMondayWeek(t *testing.T) {
	report, err := buildUsageReport(usageTestRows(), usageTestNow, usageReportOptions{Period: usagePeriodWeekly})
	if err != nil {
		t.Fatal(err)
	}
	if report.Since != "2026-09-17" || report.Until != "2026-11-16" {
		t.Fatalf("window = %s..%s, want all the days the scanner reads", report.Since, report.Until)
	}

	type row struct{ week, tool, covers string }
	var got []row
	for _, r := range report.Rows {
		got = append(got, row{r.Period, r.ToolName, r.Covers})
	}
	want := []row{
		// History starts on Thursday the 17th, so that week is partial and says so.
		{"2026-09-14", "Claude Code", "from 2026-09-17"},
		{"2026-09-28", "Claude Code", ""},
		// Friday the 13th and Saturday the 14th are one week, so Claude Code is one row.
		{"2026-11-09", "Claude Code", ""},
		{"2026-11-09", "Codex", ""},
	}
	if len(got) != len(want) {
		t.Fatalf("rows = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if cost := report.Rows[2].EstimatedCost; cost < 67.299 || cost > 67.301 {
		t.Errorf("Claude Code that week = %v, want 30 + 8.20 + 29.10", cost)
	}
	if got := usageReportJSON(report)["weekly"]; got == nil {
		t.Errorf("JSON rows are not under \"weekly\"")
	}
}

func TestLastCountsBackFromToday(t *testing.T) {
	cases := []struct {
		period       string
		last         int
		since, title string
	}{
		{usagePeriodDaily, 1, "2026-11-16", "AI coding usage · today · this machine"},
		{usagePeriodDaily, 3, "2026-11-14", "AI coding usage · last 3 days · this machine"},
		{usagePeriodWeekly, 1, "2026-11-16", "AI coding usage · this week, from Monday 2026-11-16 · this machine"},
		{usagePeriodWeekly, 2, "2026-11-09", "AI coding usage by week · last 2 weeks · this machine"},
		{usagePeriodMonthly, 1, "2026-11-01", "AI coding usage · this month · this machine"},
		{usagePeriodMonthly, 2, "2026-10-01", "AI coding usage by month · last 2 months · this machine"},
	}
	for _, c := range cases {
		report, err := resolveUsageWindow(usageTestNow, usageReportOptions{Period: c.period, Last: c.last})
		if err != nil {
			t.Fatalf("%s --last %d: %v", c.period, c.last, err)
		}
		if report.Since != c.since || report.Until != "2026-11-16" {
			t.Errorf("%s --last %d = %s..%s, want %s..2026-11-16", c.period, c.last, report.Since, report.Until, c.since)
		}
		if got := report.title(); got != c.title {
			t.Errorf("%s --last %d title = %q, want %q", c.period, c.last, got, c.title)
		}
	}

	// Further back than the scanner reads gets the note, not a silent gap.
	report, err := resolveUsageWindow(usageTestNow, usageReportOptions{Period: usagePeriodMonthly, Last: 3})
	if err != nil || !report.BeforeHistory {
		t.Errorf("monthly --last 3 starts %s; want it marked as before the 60 days read (err %v)", report.Since, err)
	}
}

func TestLastRejectsDatesAndNegativeCounts(t *testing.T) {
	for _, opts := range []usageReportOptions{
		{Last: 2, Since: "20261101"},
		{Last: 2, Until: "20261110"},
		{Last: -1},
	} {
		if _, err := resolveUsageWindow(usageTestNow, opts); err == nil {
			t.Errorf("%+v was accepted", opts)
		}
	}
}

func TestTodayWeekAndMonthCommands(t *testing.T) {
	today := runUsageCommand(t, "today")
	if !strings.Contains(today, "AI coding usage · today · this machine") {
		t.Errorf("today:\n%s", today)
	}
	// Nothing was used on Monday the 16th in the test logs.
	if !strings.Contains(today, "No AI coding usage found on this machine between 2026-11-16 and 2026-11-16.") {
		t.Errorf("today should say there is nothing yet:\n%s", today)
	}

	month := runUsageCommand(t, "month", "--tool", "claude")
	for _, want := range []string{"AI coding usage · this month · this machine", "Month", "2026-11 (to 2026-11-16)", "Claude Code", "$67.30"} {
		if !strings.Contains(month, want) {
			t.Errorf("month is missing %q:\n%s", want, month)
		}
	}
	if strings.Contains(month, "Codex") {
		t.Errorf("month --tool claude still shows Codex:\n%s", month)
	}

	weekly := runUsageCommand(t, "weekly", "--last", "2")
	for _, want := range []string{"AI coding usage by week · last 2 weeks · this machine", "Week of", "2026-11-09", "Codex", "$77.05"} {
		if !strings.Contains(weekly, want) {
			t.Errorf("weekly --last 2 is missing %q:\n%s", want, weekly)
		}
	}
	if strings.Contains(weekly, "2026-09-28") {
		t.Errorf("weekly --last 2 reaches back past last week:\n%s", weekly)
	}
}
