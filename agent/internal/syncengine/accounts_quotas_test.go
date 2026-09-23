package syncengine

import (
	"testing"

	"github.com/usejunction/agent/internal/client"
)

func TestAccountsContentHashStableUnderReorder(t *testing.T) {
	a := AccountsContentHash([]client.AccountReport{
		{ToolName: "cursor", Email: "a@x.com", Plan: "pro", LoginMethod: "local_app", AuthPresent: true},
		{ToolName: "codex", Email: "", Plan: "plus", LoginMethod: "chatgpt", AuthPresent: true},
	})
	b := AccountsContentHash([]client.AccountReport{
		{ToolName: "codex", Email: "", Plan: "plus", LoginMethod: "chatgpt", AuthPresent: true},
		{ToolName: "cursor", Email: "a@x.com", Plan: "pro", LoginMethod: "local_app", AuthPresent: true},
	})
	if a != b {
		t.Fatalf("hash not stable under reorder: %s vs %s", a, b)
	}
	if len(a) != 32 {
		t.Fatalf("expected 32-char hash, got %d (%s)", len(a), a)
	}
}

func TestAccountsContentHashChangesWhenPlanFlips(t *testing.T) {
	base := AccountsContentHash([]client.AccountReport{
		{ToolName: "cursor", Plan: "pro", AuthPresent: true},
	})
	changed := AccountsContentHash([]client.AccountReport{
		{ToolName: "cursor", Plan: "pro_plus", AuthPresent: true},
	})
	if base == changed {
		t.Fatalf("expected plan flip to change hash")
	}
}

func TestAccountsContentHashFixture(t *testing.T) {
	got := AccountsContentHash([]client.AccountReport{
		{ToolName: "cursor", Email: "a@x.com", Plan: "pro", LoginMethod: "local_app", AuthPresent: true},
		{ToolName: "codex", Email: "", Plan: "plus", LoginMethod: "chatgpt", AuthPresent: true},
	})
	if got != "ffd1b111476f51ed1268d111947636e6" {
		t.Fatalf("accounts fixture hash = %s", got)
	}
}

func TestQuotasContentHashFixture(t *testing.T) {
	used := 42.5
	got := QuotasContentHash([]client.QuotaReport{
		{ToolName: "cursor", WindowType: "plan", UsedPercent: &used, Source: "api"},
		{ToolName: "codex", WindowType: "weekly", Source: "cli_rpc"},
	})
	if got != "a43d9dbece2f35b691801475721f9c92" {
		t.Fatalf("quotas fixture hash = %s", got)
	}
}

func TestQuotasContentHashStableUnderReorder(t *testing.T) {
	used := 42.5
	a := QuotasContentHash([]client.QuotaReport{
		{ToolName: "cursor", WindowType: "plan", UsedPercent: &used, Source: "api"},
		{ToolName: "codex", WindowType: "weekly", Source: "cli_rpc"},
	})
	b := QuotasContentHash([]client.QuotaReport{
		{ToolName: "codex", WindowType: "weekly", Source: "cli_rpc"},
		{ToolName: "cursor", WindowType: "plan", UsedPercent: &used, Source: "api"},
	})
	if a != b {
		t.Fatalf("hash not stable under reorder: %s vs %s", a, b)
	}
}

func TestQuotasContentHashChangesWhenUsedFlips(t *testing.T) {
	u1, u2 := 10.0, 20.0
	base := QuotasContentHash([]client.QuotaReport{
		{ToolName: "cursor", WindowType: "plan", UsedPercent: &u1, Source: "api"},
	})
	changed := QuotasContentHash([]client.QuotaReport{
		{ToolName: "cursor", WindowType: "plan", UsedPercent: &u2, Source: "api"},
	})
	if base == changed {
		t.Fatalf("expected used%% flip to change hash")
	}
}
