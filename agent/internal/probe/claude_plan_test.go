package probe

import "testing"

func TestClaudePlanWithTier(t *testing.T) {
	cases := []struct {
		plan, tier, want string
	}{
		{"max", "default_claude_max_20x", "max-20x"},
		{"max", "default_claude_max_5x", "max-5x"},
		{"max", "", "max"},
		{"max", "something_odd", "max"},
		{"pro", "default_claude_ai", "pro"},
		{"team-standard", "default_claude_max_20x", "team-standard"},
		{"", "default_claude_max_20x", ""},
	}
	for _, c := range cases {
		if got := claudePlanWithTier(c.plan, c.tier); got != c.want {
			t.Errorf("claudePlanWithTier(%q,%q)=%q want %q", c.plan, c.tier, got, c.want)
		}
	}
}

func TestClaudePlanFromOAuthAccountTier(t *testing.T) {
	// organizationType max + a 20x org rate tier should resolve to max-20x.
	got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{
		OrganizationType:          "claude_max",
		OrganizationRateLimitTier: "default_claude_max_20x",
	})
	if got != "max-20x" {
		t.Fatalf("claude_max + 20x tier = %q, want max-20x", got)
	}

	// Pro org with the default tier stays pro.
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{
		OrganizationType:          "claude_pro",
		OrganizationRateLimitTier: "default_claude_ai",
	}); got != "pro" {
		t.Fatalf("claude_pro = %q, want pro", got)
	}
}
