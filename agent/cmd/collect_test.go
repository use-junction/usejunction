package cmd

import (
	"context"
	"testing"

	"github.com/usejunction/agent/internal/accountpolicy"
	"github.com/usejunction/agent/internal/types"
)

type stubProvider struct {
	id       string
	account  *types.ToolAccount
	usage    []types.DailyUsage
	scanned  bool
	quotaHit bool
}

func (p *stubProvider) ID() string { return p.id }
func (p *stubProvider) Detect(context.Context) (*types.ToolStatus, error) {
	return &types.ToolStatus{ToolName: p.id, Detected: true, Configured: true}, nil
}
func (p *stubProvider) AccountIdentity(context.Context) (*types.ToolAccount, error) {
	return p.account, nil
}
func (p *stubProvider) ProbeQuota(context.Context) ([]types.QuotaSnapshot, error) {
	p.quotaHit = true
	return []types.QuotaSnapshot{{ToolName: p.id, WindowType: "plan", Source: "test"}}, nil
}
func (p *stubProvider) ScanLocalUsage(context.Context, bool) ([]types.DailyUsage, error) {
	p.scanned = true
	return p.usage, nil
}

func TestCollectProviderSkipsGatedUsageUntilOptIn(t *testing.T) {
	p := &stubProvider{
		id: "codex",
		account: &types.ToolAccount{
			ToolName: "codex", AccountKey: "acct-1", Email: "a@x.com",
			LoginMethod: "oauth", AuthPresent: true, Plan: "plus",
		},
		usage: []types.DailyUsage{{Date: "2026-09-21", ToolName: "codex", Model: "gpt", Requests: 3}},
	}
	result := collectProvider(context.Background(), p, true, &accountpolicy.Policy{})
	if !p.scanned {
		t.Fatal("scan still runs so other opted-in accounts in the same store can upload")
	}
	if p.quotaHit {
		t.Fatal("disallowed ChatGPT account must not probe quota")
	}
	if len(result.usageReports) != 0 || len(result.quotaReports) != 0 {
		t.Fatalf("expected identity only, got usage=%d quotas=%d", len(result.usageReports), len(result.quotaReports))
	}
	if len(result.accountReports) != 1 || result.accountReports[0].AccountKey != "acct-1" {
		t.Fatalf("expected identity sidecar, got %#v", result.accountReports)
	}
}

func TestCollectProviderUploadsWhenAccountIsOn(t *testing.T) {
	p := &stubProvider{
		id: "cursor",
		account: &types.ToolAccount{
			ToolName: "cursor", AccountKey: "user-1", Email: "a@x.com",
			LoginMethod: "local_app", AuthPresent: true, Plan: "pro",
		},
		usage: []types.DailyUsage{{Date: "2026-09-21", ToolName: "cursor", Model: "auto", Requests: 2}},
	}
	result := collectProvider(context.Background(), p, true, &accountpolicy.Policy{
		Accounts: []accountpolicy.Account{{
			ToolName: "cursor", AccountKey: "user-1", UsageEnabled: true, UsageAllowed: true,
		}},
	})
	if !p.scanned {
		t.Fatal("opted-in Cursor account should scan usage")
	}
	if len(result.usageReports) != 1 {
		t.Fatalf("expected usage payload, got %d", len(result.usageReports))
	}
}

func TestCollectProviderSkipsEveryToolUntilOptIn(t *testing.T) {
	p := &stubProvider{
		id: "claude",
		account: &types.ToolAccount{
			ToolName: "claude", Email: "a@x.com", LoginMethod: "oauth", AuthPresent: true,
		},
		usage: []types.DailyUsage{{Date: "2026-09-21", ToolName: "claude", Requests: 1}},
	}
	result := collectProvider(context.Background(), p, true, nil)
	if !p.scanned {
		t.Fatal("scan still runs so other opted-in accounts in the same store can upload")
	}
	if len(result.usageReports) != 0 {
		t.Fatal("claude stays off until that account is opted in")
	}
	if len(result.accountReports) != 1 {
		t.Fatal("identity is still reported while usage is off")
	}
}

func TestCollectProviderUploadsOnlyOptedInAccountRows(t *testing.T) {
	p := &stubProvider{
		id: "codex",
		account: &types.ToolAccount{
			ToolName: "codex", AccountKey: "work", Email: "work@x.com",
			LoginMethod: "oauth", AuthPresent: true, Plan: "plus",
		},
		usage: []types.DailyUsage{
			{Date: "2026-09-21", ToolName: "codex", AccountKey: "personal", Model: "gpt", Requests: 2},
			{Date: "2026-09-21", ToolName: "codex", AccountKey: "work", Model: "gpt", Requests: 4},
			{Date: "2026-09-21", ToolName: "codex", AccountKey: "contractor", Model: "gpt", Requests: 1},
		},
	}
	result := collectProvider(context.Background(), p, true, &accountpolicy.Policy{
		Accounts: []accountpolicy.Account{
			{ToolName: "codex", AccountKey: "personal", UsageEnabled: true, UsageAllowed: true},
			{ToolName: "codex", AccountKey: "contractor", UsageEnabled: true, UsageAllowed: true},
		},
	})
	if !p.scanned {
		t.Fatal("scan should run even when the signed-in account is off")
	}
	if len(result.usageReports) != 2 {
		t.Fatalf("expected personal and contractor usage, got %#v", result.usageReports)
	}
	got := map[string]bool{}
	for _, row := range result.usageReports {
		got[row.AccountKey] = true
	}
	if !got["personal"] || !got["contractor"] || got["work"] {
		t.Fatalf("expected only opted-in accounts, got %#v", result.usageReports)
	}
	if len(result.quotaReports) != 0 {
		t.Fatal("signed-in work account should not upload quota")
	}
}
