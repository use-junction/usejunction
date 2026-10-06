package scan

import (
	"testing"

	"github.com/usejunction/agent/internal/types"
)

func TestRememberFileKeepsFirstSeenAccount(t *testing.T) {
	files := map[string]string{}
	got := RememberFile(files, "/tmp/a.jsonl", "", "personal")
	if got != "personal" {
		t.Fatalf("first observation should stamp signed-in account, got %q", got)
	}
	got = RememberFile(files, "/tmp/a.jsonl", "", "work")
	if got != "personal" {
		t.Fatalf("later signed-in account must not rewrite first seen, got %q", got)
	}
	got = RememberFile(files, "/tmp/a.jsonl", "acct-meta", "work")
	if got != "acct-meta" {
		t.Fatalf("id inside the file should win, got %q", got)
	}
}

func TestStampObservedActivityLeavesFirstSeenUnscoped(t *testing.T) {
	current := []types.DailyUsage{{
		Date: "2026-09-21", ToolName: "cursor", Model: "auto", Source: "cursor_local", Requests: 3,
	}}
	out := StampObservedActivity(nil, current, "work")
	if len(out) != 1 || out[0].AccountKey != "" {
		t.Fatalf("first sqlite history must stay unscoped, got %#v", out)
	}
}

func TestStampObservedActivityTagsIncreasedTotals(t *testing.T) {
	prev := []types.DailyUsage{{
		Date: "2026-09-21", ToolName: "cursor", Model: "auto", Source: "cursor_local", Requests: 3,
	}}
	current := []types.DailyUsage{{
		Date: "2026-09-21", ToolName: "cursor", Model: "auto", Source: "cursor_local", Requests: 5,
	}}
	out := StampObservedActivity(prev, current, "work")
	if len(out) != 1 || out[0].AccountKey != "work" {
		t.Fatalf("new sqlite activity should stamp signed-in account, got %#v", out)
	}
}

func TestStampObservedActivityKeepsUnchangedAttribution(t *testing.T) {
	prev := []types.DailyUsage{{
		Date: "2026-09-21", ToolName: "cursor", Model: "auto", Source: "cursor_local",
		AccountKey: "personal", Requests: 3,
	}}
	current := []types.DailyUsage{{
		Date: "2026-09-21", ToolName: "cursor", Model: "auto", Source: "cursor_local", Requests: 3,
	}}
	out := StampObservedActivity(prev, current, "work")
	if len(out) != 1 || out[0].AccountKey != "personal" {
		t.Fatalf("unchanged totals should keep prior account, got %#v", out)
	}
}

func TestAccountFromRecordPrefersStableId(t *testing.T) {
	got := AccountFromRecord(map[string]any{
		"payload": map[string]any{"account_id": "acct-9", "email": "a@x.com"},
	})
	if got != "acct-9" {
		t.Fatalf("expected account id, got %q", got)
	}
}

func TestReplaceAccountSourceAggregatesKeepsOtherLogins(t *testing.T) {
	existing := []types.DailyUsage{
		{ToolName: "cursor", Source: "cursor_usage_events", AccountKey: "personal", Date: "2026-09-21", Model: "auto"},
		{ToolName: "cursor", Source: "cursor_usage_events", AccountKey: "work", Date: "2026-09-21", Model: "auto"},
	}
	next := []types.DailyUsage{
		{ToolName: "cursor", Source: "cursor_usage_events", AccountKey: "work", Date: "2026-09-22", Model: "auto"},
	}
	out := ReplaceAccountSourceAggregates(existing, "cursor", "cursor_usage_events", "work", next)
	if len(out) != 2 {
		t.Fatalf("expected personal history plus new work row, got %#v", out)
	}
	if out[0].AccountKey != "personal" || out[1].Date != "2026-09-22" {
		t.Fatalf("unexpected replace result %#v", out)
	}
}
