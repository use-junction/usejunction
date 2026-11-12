package cmd

import (
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/types"
)

func usageRow(date, tool string, cost float64, kind types.CostKind) types.DailyUsage {
	return types.DailyUsage{Date: date, ToolName: tool, EstimatedCost: cost, CostKind: kind}
}

func TestSummarizeLocalUsageTotalsTheLastThirtyDaysByTool(t *testing.T) {
	now := time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC)
	rows := []types.DailyUsage{
		usageRow("2026-11-12", "claude", 300, types.CostKindEstimatedAPI),
		usageRow("2026-11-01", "claude", 18.40, types.CostKindEstimatedAPI),
		usageRow("2026-10-14", "cursor", 81.20, types.CostKindEstimatedAPI), // first day of the window
		usageRow("2026-10-13", "cursor", 999, types.CostKindEstimatedAPI),   // one day too old
		usageRow("2026-11-13", "codex", 999, types.CostKindEstimatedAPI),    // dated tomorrow
		usageRow("2026-11-10", "codex", 12.58, types.CostKindEstimatedAPI),
		usageRow("2026-11-10", "ollama", 0, ""), // used, but free
		{Date: "2026-11-10", ToolName: "claude", EstimatedCost: 50, MetricKind: types.MetricKindProductivity},
	}

	got := summarizeLocalUsage(rows, now, 30)

	if want := 412.18; got.Total < want-0.001 || got.Total > want+0.001 {
		t.Fatalf("total = %v, want %v", got.Total, want)
	}
	if got.ToolsSeen != 4 {
		t.Fatalf("tools seen = %d, want 4 (free tools count as seen)", got.ToolsSeen)
	}
	if len(got.Tools) != 3 || got.Tools[0].Tool != "Claude Code" || got.Tools[1].Tool != "Cursor" || got.Tools[2].Tool != "Codex" {
		t.Fatalf("tools not ordered by cost: %+v", got.Tools)
	}
	if !got.AllEstimated {
		t.Fatal("every row was an API estimate")
	}
	if got.headline() != "≈ $412 of AI coding usage in the last 30 days" {
		t.Fatalf("headline = %q", got.headline())
	}
	if got.breakdown() != "Claude Code $318 · Cursor $81.20 · Codex $12.58" {
		t.Fatalf("breakdown = %q", got.breakdown())
	}
	if !strings.Contains(got.method(), "not your bill") || !strings.Contains(got.method(), "Nothing has left this machine") {
		t.Fatalf("method must say it is an estimate and that nothing was uploaded: %q", got.method())
	}
}

func TestSummarizeLocalUsageSaysWhenPartOfTheNumberIsNotAnEstimate(t *testing.T) {
	now := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	got := summarizeLocalUsage([]types.DailyUsage{
		usageRow("2026-11-11", "claude", 10, types.CostKindEstimatedAPI),
		usageRow("2026-11-11", "opencode", 5, types.CostKindActualSpend),
	}, now, 30)
	if got.AllEstimated {
		t.Fatal("actual spend is not an estimate")
	}
	if strings.Contains(got.method(), "not your bill") {
		t.Fatalf("method should not call actual spend an estimate: %q", got.method())
	}
}

func TestSummarizeLocalUsageWithNothingToShow(t *testing.T) {
	now := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)

	empty := summarizeLocalUsage(nil, now, 30)
	if empty.headline() != "No AI coding usage found on this machine in the last 30 days" {
		t.Fatalf("headline = %q", empty.headline())
	}
	if empty.breakdown() != "" {
		t.Fatalf("breakdown = %q, want none", empty.breakdown())
	}

	free := summarizeLocalUsage([]types.DailyUsage{usageRow("2026-11-11", "ollama", 0, "")}, now, 30)
	if free.headline() != "Usage found from 1 tool in the last 30 days, with no cost to estimate yet" {
		t.Fatalf("headline = %q", free.headline())
	}
}

func TestBreakdownFoldsTheLongTail(t *testing.T) {
	now := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	var rows []types.DailyUsage
	for i, tool := range []string{"claude", "cursor", "codex", "copilot", "opencode", "cline"} {
		rows = append(rows, usageRow("2026-11-11", tool, float64(600-i*100), types.CostKindEstimatedAPI))
	}
	got := summarizeLocalUsage(rows, now, 30).breakdown()
	if got != "Claude Code $600 · Cursor $500 · Codex $400 · Copilot $300 · +2 more" {
		t.Fatalf("breakdown = %q", got)
	}
}

func TestFormatUSD(t *testing.T) {
	cases := map[float64]string{
		0.5:        "$0.50",
		12.58:      "$12.58",
		99.994:     "$99.99",
		100:        "$100",
		412.18:     "$412",
		1234.5:     "$1,234", // %.0f rounds half to even
		18450:      "$18,450",
		1234567.89: "$1,234,568",
	}
	for amount, want := range cases {
		if got := formatUSD(amount); got != want {
			t.Errorf("formatUSD(%v) = %q, want %q", amount, got, want)
		}
	}
}

func TestToolDisplayName(t *testing.T) {
	cases := map[string]string{"claude": "Claude Code", "lmstudio": "LM Studio", "zed": "Zed", "": "Unknown"}
	for id, want := range cases {
		if got := toolDisplayName(id); got != want {
			t.Errorf("toolDisplayName(%q) = %q, want %q", id, got, want)
		}
	}
}
