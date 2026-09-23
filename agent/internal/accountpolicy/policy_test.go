package accountpolicy

import "testing"

func TestGated(t *testing.T) {
	if !Gated("cursor") || !Gated("codex") || !Gated("claude") || Gated(" ") {
		t.Fatal("every named provider is opt-in")
	}
}

func TestUsageAllowedFailClosed(t *testing.T) {
	if UsageAllowed(nil, "cursor", "acct", "a@x.com") {
		t.Fatal("missing policy must skip usage")
	}
	if UsageAllowed(&Policy{}, "codex", "acct", "") {
		t.Fatal("unknown account must skip usage")
	}
	if UsageAllowed(nil, "claude", "", "") {
		t.Fatal("claude stays off until the account is opted in")
	}
}

func TestUsageAllowedOptInAndAdminLock(t *testing.T) {
	policy := &Policy{Accounts: []Account{{
		ToolName: "cursor", AccountKey: "user-1", Email: "a@x.com",
		UsageEnabled: true, UsageAllowed: true,
	}}}
	if !UsageAllowed(policy, "cursor", "user-1", "a@x.com") {
		t.Fatal("opted-in account should collect usage")
	}
	policy.Accounts[0].UsageAllowed = false
	policy.Accounts[0].UsageEnabled = true
	policy.Accounts[0].UsageAdminLocked = true
	if UsageAllowed(policy, "cursor", "user-1", "a@x.com") {
		t.Fatal("admin lock must stop usage")
	}
}

func TestMatchByEmailWhenKeyUnknown(t *testing.T) {
	policy := &Policy{Accounts: []Account{{
		ToolName: "codex", AccountKey: "acct-9", Email: "b@x.com",
		LoggingEnabled: true, LoggingAllowed: true,
	}}}
	if !LoggingAllowed(policy, "codex", "", "b@x.com") {
		t.Fatal("email should match the stored ChatGPT account")
	}
	if LoggingAllowed(policy, "codex", "other", "c@x.com") {
		t.Fatal("a switched login must stay off")
	}
}
