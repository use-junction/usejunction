package probe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/types"
)

func TestCodexPlanFromClaims(t *testing.T) {
	claims := map[string]any{
		"https://api.openai.com/auth": map[string]any{
			"chatgpt_plan_type": "plus",
		},
	}
	if got := codexPlanFromClaims(claims); got != "plus" {
		t.Fatalf("plan = %q", got)
	}
}

func TestSaveCodexAuthOnlyTouchesAuthJSON(t *testing.T) {
	dir := t.TempDir()
	authPath := filepath.Join(dir, "auth.json")
	configPath := filepath.Join(dir, "config.toml")
	docsPath := filepath.Join(dir, "Documents", "secret.txt")
	if err := os.MkdirAll(filepath.Dir(docsPath), 0o700); err != nil {
		t.Fatal(err)
	}
	originalAuth := `{
	  "auth_mode": "chatgpt",
	  "last_refresh": "2026-07-07T11:53:16Z",
	  "tokens": {
	    "access_token": "old-access",
	    "refresh_token": "old-refresh",
	    "id_token": "old-id",
	    "account_id": "acct-1"
	  }
	}`
	originalConfig := "model = \"gpt-test\"\n"
	originalDocs := "leave me alone\n"
	if err := os.WriteFile(authPath, []byte(originalAuth), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, []byte(originalConfig), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(docsPath, []byte(originalDocs), 0600); err != nil {
		t.Fatal(err)
	}

	auth, err := LoadCodexAuth(dir)
	if err != nil {
		t.Fatal(err)
	}
	auth.AccessToken = "new-access"
	auth.RefreshToken = "new-refresh"
	auth.LastRefresh = time.Now().UTC().Format(time.RFC3339)
	if err := SaveCodexAuth(dir, auth); err != nil {
		t.Fatal(err)
	}

	gotAuth, err := os.ReadFile(authPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(gotAuth), "new-access") || !strings.Contains(string(gotAuth), "new-refresh") {
		t.Fatalf("auth.json was not updated: %s", gotAuth)
	}
	gotConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotConfig) != originalConfig {
		t.Fatalf("config.toml must stay untouched: %s", gotConfig)
	}
	gotDocs, err := os.ReadFile(docsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotDocs) != originalDocs {
		t.Fatalf("Documents must stay untouched: %s", gotDocs)
	}
}

func TestLoadCodexAuthNestedTokens(t *testing.T) {
	dir := t.TempDir()
	authJSON := `{
	  "auth_mode": "chatgpt",
	  "last_refresh": "2026-07-07T11:53:16Z",
	  "tokens": {
	    "access_token": "access-token",
	    "refresh_token": "refresh-token",
	    "id_token": "aaa.eyJlbWFpbCI6ImRldkBleGFtcGxlLmNvbSJ9.bbb",
	    "account_id": "acct-1"
	  }
	}`
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(authJSON), 0600); err != nil {
		t.Fatal(err)
	}
	auth, err := LoadCodexAuth(dir)
	if err != nil {
		t.Fatalf("LoadCodexAuth: %v", err)
	}
	if auth.AccessToken != "access-token" {
		t.Fatalf("access token = %q", auth.AccessToken)
	}
	if !auth.nestedTokens {
		t.Fatal("expected nested token format")
	}
	account, err := CodexAccountFromAuth(dir)
	if err != nil {
		t.Fatalf("CodexAccountFromAuth: %v", err)
	}
	if account.Email != "dev@example.com" {
		t.Fatalf("email = %q", account.Email)
	}
}

func TestParseCodexUsageResponse(t *testing.T) {
	raw := `{
	  "plan_type": "pro",
	  "rate_limit": {
	    "primary_window": {"used_percent": 42.5, "reset_at": 1784526148, "limit_window_seconds": 18000},
	    "secondary_window": {"used_percent": 10, "reset_at": "2026-07-20T00:00:00Z", "limit_window_seconds": 604800}
	  },
	  "credits": {"has_credits": true, "balance": 12.5},
	  "rate_limit_reset_credits": {"available_count": 2, "applicable_available_count": 1},
	  "promo": null
	}`
	var usage codexUsageResponse
	if err := json.Unmarshal([]byte(raw), &usage); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if usage.PlanType != "pro" {
		t.Fatalf("plan_type = %q", usage.PlanType)
	}
	if usage.RateLimit.PrimaryWindow.UsedPercent != 42.5 {
		t.Fatalf("primary used = %v", usage.RateLimit.PrimaryWindow.UsedPercent)
	}
	snapshots := codexQuotaSnapshots(usage, "oauth_api")
	if len(snapshots) != 4 {
		t.Fatalf("snapshots = %d, want 5-hour, weekly, credits, and resets", len(snapshots))
	}
	if snapshots[0].WindowType != "session_5h" || snapshots[1].WindowType != "weekly" {
		t.Fatalf("window types = %q, %q", snapshots[0].WindowType, snapshots[1].WindowType)
	}
	if snapshots[3].WindowType != "rate_limit_resets" || snapshots[3].CreditsRemaining == nil || *snapshots[3].CreditsRemaining != 1 {
		t.Fatalf("reset credits snapshot = %+v", snapshots[3])
	}
	primaryReset := time.Unix(1784526148, 0).UTC().Format(time.RFC3339)
	if snapshots[0].ResetAt == nil || *snapshots[0].ResetAt != primaryReset {
		t.Fatalf("primary reset = %v, want %s", snapshots[0].ResetAt, primaryReset)
	}
	if snapshots[1].ResetAt == nil || *snapshots[1].ResetAt != "2026-07-20T00:00:00Z" {
		t.Fatalf("weekly reset = %v", snapshots[1].ResetAt)
	}
}

func TestCodexWindowTypeFromLimitSeconds(t *testing.T) {
	if got := codexWindowType(codexUsageWindow{LimitWindowSeconds: 604800}, "session_5h"); got != "weekly" {
		t.Fatalf("7d window = %q", got)
	}
	if got := codexWindowType(codexUsageWindow{LimitWindowSeconds: 18000}, "weekly"); got != "session_5h" {
		t.Fatalf("5h window = %q", got)
	}
}

func TestCodexResetCreditSnapshots(t *testing.T) {
	credits := &codexResetCreditsResponse{
		AvailableCount: 2,
		Credits: []codexResetCredit{
			{Status: "available", ExpiresAt: "2026-07-25T07:05:10.976330Z"},
			{Status: "redeemed", ExpiresAt: "2026-07-20T00:00:00Z"},
			{Status: "available", ExpiresAt: "2026-08-12T18:08:12.052268Z"},
		},
	}
	snaps := codexResetCreditSnapshots(credits, "oauth_api")
	if len(snaps) != 1 || snaps[0].CreditsRemaining == nil || *snaps[0].CreditsRemaining != 2 {
		t.Fatalf("snaps = %+v", snaps)
	}
	if snaps[0].ResetAt == nil || !strings.HasPrefix(*snaps[0].ResetAt, "2026-07-25") {
		t.Fatalf("nearest expiry = %v", snaps[0].ResetAt)
	}
}

func TestCodexResetAtRejectsMissingOrInvalidValues(t *testing.T) {
	if got := codexResetAt(nil); got != nil {
		t.Fatalf("nil reset = %v", got)
	}
	if got := codexResetAt("not-a-date"); got != nil {
		t.Fatalf("invalid reset = %v", got)
	}
}

func TestParseClaudeUsageResponse(t *testing.T) {
	raw := `{
	  "five_hour": {"utilization": 55, "resets_at": "2026-07-14T18:00:00Z"},
	  "seven_day": {"utilization": 20, "resets_at": "2026-07-20T00:00:00Z"}
	}`
	var windows map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &windows); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var session claudeUsageWindow
	if err := json.Unmarshal(windows["five_hour"], &session); err != nil {
		t.Fatalf("session: %v", err)
	}
	used, ok := session.usedPercent()
	if !ok || used != 55 {
		t.Fatalf("utilization = %v ok=%v", used, ok)
	}
}

func TestParseClaudeUsageResponseUsedPercentageAlias(t *testing.T) {
	raw := `{
	  "five_hour": {"used_percentage": 12.5, "resets_at": 1775325600},
	  "seven_day": {"used_percentage": 3, "resets_at": 1775808000}
	}`
	var body map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatal(err)
	}
	snaps := claudeUsageSnapshots(body)
	if len(snaps) != 2 {
		t.Fatalf("got %d snaps", len(snaps))
	}
	if snaps[0].UsedPercent == nil || *snaps[0].UsedPercent != 12.5 {
		t.Fatalf("five_hour = %+v", snaps[0])
	}
	if snaps[0].ResetAt == nil || *snaps[0].ResetAt == "" {
		t.Fatalf("expected unix resets_at parsed, got %+v", snaps[0])
	}
}

func TestParseCursorUsageSummary(t *testing.T) {
	raw := `{
	  "billingCycleEnd": "2026-07-31T00:00:00Z",
	  "membershipType": "pro_plus",
	  "individualUsage": {
	    "plan": {
	      "totalPercentUsed": 33.3,
	      "autoPercentUsed": 12,
	      "apiPercentUsed": 8,
	      "used": 1000,
	      "limit": 3000,
	      "breakdown": {"included": 900, "bonus": 100, "total": 1000}
	    },
	    "onDemand": {"used": 2500, "remaining": 7500}
	  }
	}`
	var summary cursorUsageSummary
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if summary.MembershipType != "pro_plus" {
		t.Fatalf("membershipType = %q", summary.MembershipType)
	}
	if summary.IndividualUsage == nil || summary.IndividualUsage.Plan == nil {
		t.Fatal("missing plan usage")
	}
	if summary.IndividualUsage.Plan.TotalPercentUsed != 33.3 {
		t.Fatalf("totalPercentUsed = %v", summary.IndividualUsage.Plan.TotalPercentUsed)
	}
	if summary.IndividualUsage.Plan.Breakdown == nil || summary.IndividualUsage.Plan.Breakdown.Bonus != 100 {
		t.Fatalf("bonus breakdown = %+v", summary.IndividualUsage.Plan.Breakdown)
	}
}

func TestCopilotResetAtParsesDate(t *testing.T) {
	user := &copilotInternalUser{QuotaResetDateUTC: "2026-08-01T00:00:00.000Z"}
	got := copilotResetAt(user)
	if got == nil || *got != "2026-08-01T00:00:00Z" {
		t.Fatalf("reset = %v", got)
	}
}

func TestResolveCursorPlanPrefersAPIOverStaleLocal(t *testing.T) {
	// usage-summary membershipType must win over a stale cursorAuth/stripeMembershipType.
	summary := &cursorUsageSummary{MembershipType: "pro_plus"}
	got := resolveCursorPlan(context.Background(), "", summary)
	if got != "pro_plus" {
		t.Fatalf("resolveCursorPlan = %q, want pro_plus", got)
	}
}

func TestJWTPayloadEmail(t *testing.T) {
	// eyJ... is {"email":"dev@example.com","sub":"user-1"}
	token := "aaa." + "eyJlbWFpbCI6ImRldkBleGFtcGxlLmNvbSIsInN1YiI6InVzZXItMSJ9" + ".bbb"
	claims := jwtPayload(token)
	if got := claimString(claims, "email"); got != "dev@example.com" {
		t.Fatalf("email = %q", got)
	}
}

func TestCodexPromoSnapshot(t *testing.T) {
	usage := codexUsageResponse{
		Promo: &codexPromo{Title: "Free reset week", ID: "promo-1"},
	}
	snaps := codexQuotaSnapshots(usage, "oauth_api")
	if len(snaps) != 1 || snaps[0].WindowType != "promo" {
		t.Fatalf("snaps = %+v", snaps)
	}
}

func TestCodexResetCreditsZeroProducesExplicitSnapshot(t *testing.T) {
	usage := codexUsageResponse{
		RateLimitResetCredits: &codexResetCreditsSummary{AvailableCount: 0},
	}
	snaps := codexQuotaSnapshots(usage, "oauth_api")
	if len(snaps) != 1 || snaps[0].WindowType != "rate_limit_resets" {
		t.Fatalf("expected zero reset snapshot, got %+v", snaps)
	}
	if snaps[0].CreditsRemaining == nil || *snaps[0].CreditsRemaining != 0 {
		t.Fatalf("credits = %+v", snaps[0].CreditsRemaining)
	}
	detailed := codexResetCreditSnapshots(&codexResetCreditsResponse{AvailableCount: 0}, "oauth_api")
	if len(detailed) != 1 || detailed[0].CreditsRemaining == nil || *detailed[0].CreditsRemaining != 0 {
		t.Fatalf("expected zero detailed snapshot, got %+v", detailed)
	}
}

func TestCodexResetCreditsPreferApplicableCount(t *testing.T) {
	usage := codexUsageResponse{
		RateLimitResetCredits: &codexResetCreditsSummary{AvailableCount: 2, ApplicableAvailableCount: 1},
	}
	snaps := codexQuotaSnapshots(usage, "oauth_api")
	if len(snaps) != 1 || snaps[0].CreditsRemaining == nil || *snaps[0].CreditsRemaining != 1 {
		t.Fatalf("expected applicable count, got %+v", snaps)
	}
}

func TestReplaceQuotaWindowPrefersDetailed(t *testing.T) {
	existing := []types.QuotaSnapshot{
		{ToolName: "codex", WindowType: "weekly", UsedPercent: floatPtr(10), Source: "oauth_api"},
		{ToolName: "codex", WindowType: "rate_limit_resets", CreditsRemaining: floatPtr(4), Source: "oauth_api"},
	}
	detailed := []types.QuotaSnapshot{{
		ToolName: "codex", WindowType: "rate_limit_resets",
		CreditsRemaining: floatPtr(4), ResetAt: strPtr("2026-07-25T07:05:10Z"), Source: "oauth_api",
	}}
	got := replaceQuotaWindow(existing, "rate_limit_resets", detailed)
	if len(got) != 2 {
		t.Fatalf("len = %d", len(got))
	}
	if got[1].ResetAt == nil || *got[1].ResetAt != "2026-07-25T07:05:10Z" {
		t.Fatalf("detailed reset missing: %+v", got[1])
	}
}

func TestCursorActiveGrantSnapshots(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	grants := []cursorActiveGrant{
		{GrantID: "g1", RemainingCents: 1500, ExpiresAtMs: now.Add(48 * time.Hour).UnixMilli(), Source: "promo_campaign", ShowInClient: true},
		{GrantID: "g2", RemainingCents: 500, ExpiresAtMs: now.Add(24 * time.Hour).UnixMilli(), Source: "support", ShowInClient: false},
		{GrantID: "expired", RemainingCents: 100, ExpiresAtMs: now.Add(-time.Hour).UnixMilli(), Source: "promo_campaign", ShowInClient: true},
	}
	snaps := cursorActiveGrantSnapshots(grants, now)
	if len(snaps) != 2 {
		t.Fatalf("len = %d, snaps=%+v", len(snaps), snaps)
	}
	if snaps[0].WindowType != "promo_grant" || snaps[0].CreditsRemaining == nil || *snaps[0].CreditsRemaining != 15 {
		t.Fatalf("promo grant = %+v", snaps[0])
	}
	if snaps[1].WindowType != "credit_grant" || snaps[1].CreditsRemaining == nil || *snaps[1].CreditsRemaining != 5 {
		t.Fatalf("credit grant = %+v", snaps[1])
	}
}

func TestCursorUsageSummarySnapshots(t *testing.T) {
	raw := `{
	  "billingCycleEnd": "2026-07-31T00:00:00Z",
	  "membershipType": "pro_plus",
	  "individualUsage": {
	    "plan": {
	      "totalPercentUsed": 33.3,
	      "autoPercentUsed": 12,
	      "apiPercentUsed": 8,
	      "used": 1000,
	      "limit": 3000,
	      "breakdown": {"included": 900, "bonus": 100, "total": 1000}
	    },
	    "onDemand": {"used": 2500, "remaining": 7500}
	  }
	}`
	var summary cursorUsageSummary
	if err := json.Unmarshal([]byte(raw), &summary); err != nil {
		t.Fatal(err)
	}
	snaps := cursorUsageSummarySnapshots(summary, "local_app")
	byType := map[string]types.QuotaSnapshot{}
	for _, s := range snaps {
		byType[s.WindowType] = s
	}
	for _, want := range []string{"plan", "bonus", "auto", "api", "on_demand"} {
		if _, ok := byType[want]; !ok {
			t.Fatalf("missing window %s in %+v", want, snaps)
		}
	}
	if byType["bonus"].CreditsRemaining == nil || *byType["bonus"].CreditsRemaining != 1 {
		t.Fatalf("bonus = %+v", byType["bonus"])
	}
}

func TestCopilotQuotaSnapshots(t *testing.T) {
	user := &copilotInternalUser{
		Login:         "Dinuda",
		CopilotPlan:   "individual",
		AccessTypeSKU: "free_educational_quota",
		QuotaSnapshots: map[string]copilotQuotaBucket{
			"chat": {
				HasQuota: true, Unlimited: true, PercentRemaining: 100,
			},
			"premium_interactions": {
				HasQuota: true, Remaining: 200, Entitlement: 200, CreditsUsed: 0, PercentRemaining: 100,
			},
			"empty": {},
		},
	}
	account := copilotAccountFromUser(user)
	if account.Plan != "individual/free_educational_quota" {
		t.Fatalf("plan = %q", account.Plan)
	}
	reset := strPtr("2026-08-01T00:00:00Z")
	snaps := copilotQuotaSnapshots(user, reset)
	byType := map[string]types.QuotaSnapshot{}
	for _, s := range snaps {
		byType[s.WindowType] = s
	}
	if _, ok := byType["copilot_empty"]; ok {
		t.Fatal("empty bucket should be skipped")
	}
	if byType["copilot_chat"].UsedPercent == nil || *byType["copilot_chat"].UsedPercent != 0 {
		t.Fatalf("chat = %+v", byType["copilot_chat"])
	}
	prem := byType["copilot_premium_interactions"]
	if prem.CreditsRemaining == nil || *prem.CreditsRemaining != 200 {
		t.Fatalf("premium = %+v", prem)
	}
}

func TestCopilotResetAtDateOnly(t *testing.T) {
	user := &copilotInternalUser{QuotaResetDate: "2026-08-01"}
	got := copilotResetAt(user)
	if got == nil || *got != "2026-08-01T00:00:00Z" {
		t.Fatalf("reset = %v", got)
	}
}

func TestClaudeKeychainHashedService(t *testing.T) {
	dir := "/Users/example/.claude"
	got := ClaudeKeychainHashedService(dir)
	if !strings.HasPrefix(got, "Claude Code-credentials-") {
		t.Fatalf("service = %q", got)
	}
	suffix := strings.TrimPrefix(got, "Claude Code-credentials-")
	if len(suffix) != 8 {
		t.Fatalf("suffix len = %d (%q)", len(suffix), suffix)
	}
	if ClaudeKeychainHashedService(dir) != got {
		t.Fatal("hash should be stable")
	}
}

func TestClaudePlanFromOAuthAccount(t *testing.T) {
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{SubscriptionType: "pro"}); got != "pro" {
		t.Fatalf("subscriptionType = %q", got)
	}
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{OrganizationType: "claude_team"}); got != "team-standard" {
		t.Fatalf("team = %q", got)
	}
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{SeatTier: "team_standard"}); got != "team-standard" {
		t.Fatalf("seatTier team_standard = %q", got)
	}
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{SeatTier: "team_premium"}); got != "team-premium" {
		t.Fatalf("seatTier team_premium = %q", got)
	}
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{OrganizationType: "claude_pro", BillingType: "stripe_subscription"}); got != "pro" {
		t.Fatalf("claude_pro org = %q, want pro", got)
	}
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{OrganizationType: "claude_max"}); got != "max" {
		t.Fatalf("claude_max org = %q, want max", got)
	}
	if got := claudePlanFromOAuthAccount(claudeJSONOAuthAccount{BillingType: "stripe_subscription"}); got != "" {
		t.Fatalf("consumer stripe = %q", got)
	}
}

func TestPreferClaudePlan(t *testing.T) {
	cases := []struct {
		creds, json, want string
	}{
		{"pro", "team-standard", "team-standard"},
		{"pro", "team_standard", "team-standard"},
		{"pro", "", "pro"},
		{"", "team-standard", "team-standard"},
		{"max", "pro", "max"},
		{"team-premium", "pro", "team-premium"},
		{"pro", "enterprise", "enterprise"},
		{"", "", ""},
	}
	for _, tc := range cases {
		if got := preferClaudePlan(tc.creds, tc.json); got != tc.want {
			t.Fatalf("preferClaudePlan(%q, %q) = %q, want %q", tc.creds, tc.json, got, tc.want)
		}
	}
}

func setTestUserHome(t *testing.T, home string) {
	t.Helper()
	// os.UserHomeDir reads HOME on Unix and USERPROFILE on Windows. Set both so
	// Claude's sibling ~/.claude.json fixture never leaks into the runner profile.
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

func TestClaudeAccountIdentityMergesCredsWithJSON(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	claudeDir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	creds := `{
	  "access_token": "access-token",
	  "refresh_token": "refresh-token",
	  "email": "creds@example.com",
	  "subscription_type": "pro",
	  "expires_at_ms": 1999999999999
	}`
	if err := os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(creds), 0o600); err != nil {
		t.Fatal(err)
	}
	jsonPayload := `{
	  "oauthAccount": {
	    "emailAddress": "json@example.com",
	    "organizationType": "claude_team"
	  }
	}`
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte(jsonPayload), 0o600); err != nil {
		t.Fatal(err)
	}
	setTestUserHome(t, home)

	account, err := ClaudeAccountIdentity(claudeDir)
	if err != nil {
		t.Fatal(err)
	}
	if account.Email != "creds@example.com" {
		t.Fatalf("email = %q", account.Email)
	}
	if account.Plan != "team-standard" {
		t.Fatalf("plan = %q, want team-standard", account.Plan)
	}
	if !account.AuthPresent {
		t.Fatal("expected auth present")
	}
}

func TestProbeClaudeQuotaMergesPlanWhenUsageFails(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	claudeDir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	creds := `{
	  "access_token": "invalid-token",
	  "subscription_type": "pro",
	  "expires_at_ms": 1999999999999
	}`
	if err := os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(creds), 0o600); err != nil {
		t.Fatal(err)
	}
	jsonPayload := `{
	  "oauthAccount": {
	    "emailAddress": "user@example.com",
	    "organizationType": "claude_team"
	  }
	}`
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte(jsonPayload), 0o600); err != nil {
		t.Fatal(err)
	}
	setTestUserHome(t, home)

	_, account, err := ProbeClaudeQuota(context.Background(), claudeDir)
	if account == nil {
		t.Fatalf("account nil, err=%v", err)
	}
	if account.Plan != "team-standard" {
		t.Fatalf("plan = %q, want team-standard", account.Plan)
	}
}

// TestPasinduMachineStateJSONOnlyNoQuotas mirrors Desktop-only login on a real
// machine: claude_team org + team_standard seat in ~/.claude.json, no Code OAuth.
func TestPasinduMachineStateJSONOnlyNoQuotas(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	claudeDir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	payload := `{
	  "oauthAccount": {
	    "emailAddress": "pasindu.ratnayake@axio360ventures.io",
	    "organizationType": "claude_team",
	    "seatTier": "team_standard",
	    "billingType": "stripe_subscription"
	  }
	}`
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	setTestUserHome(t, home)

	identity, err := ClaudeAccountIdentity(claudeDir)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Plan != "team-standard" {
		t.Fatalf("identity plan = %q, want team-standard from seatTier", identity.Plan)
	}

	snaps, probeAcc, probeErr := ProbeClaudeQuota(context.Background(), claudeDir)
	if probeAcc == nil || probeAcc.Plan != "team-standard" {
		t.Fatalf("probe account = %+v", probeAcc)
	}
	if len(snaps) != 0 {
		t.Fatalf("expected no quota windows without Code OAuth, got %d", len(snaps))
	}
	if probeErr == nil {
		t.Fatal("expected credentials-not-found error when usage API cannot run")
	}
}

// TestPasinduMachineStateStaleProCredsMergedToTeam is the upgrade case: Code OAuth
// still says pro while Desktop JSON already shows team.
func TestPasinduMachineStateStaleProCredsMergedToTeam(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	claudeDir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	creds := `{
	  "access_token": "stale-access",
	  "refresh_token": "stale-refresh",
	  "email": "pasindu.ratnayake@axio360ventures.io",
	  "subscription_type": "pro",
	  "expires_at_ms": 1999999999999
	}`
	if err := os.WriteFile(filepath.Join(claudeDir, ".credentials.json"), []byte(creds), 0o600); err != nil {
		t.Fatal(err)
	}
	jsonPayload := `{
	  "oauthAccount": {
	    "emailAddress": "pasindu.ratnayake@axio360ventures.io",
	    "organizationType": "claude_team",
	    "seatTier": "team_standard"
	  }
	}`
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte(jsonPayload), 0o600); err != nil {
		t.Fatal(err)
	}
	setTestUserHome(t, home)

	identity, err := ClaudeAccountIdentity(claudeDir)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Plan != "team-standard" {
		t.Fatalf("merged plan = %q, want team-standard (json team beats stale pro creds)", identity.Plan)
	}
}

func TestClaudeAccountFromClaudeJSON(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	payload := `{
	  "oauthAccount": {
	    "emailAddress": "user@example.com",
	    "organizationType": "claude_team",
	    "billingType": "stripe_subscription"
	  }
	}`
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	account, err := ClaudeAccountFromClaudeJSON(home)
	if err != nil {
		t.Fatal(err)
	}
	if account.Email != "user@example.com" || account.Plan != "team-standard" || account.AuthPresent || account.LoginMethod != "desktop" {
		t.Fatalf("account = %+v", account)
	}
}

func TestProbeClaudeQuotaJSONFallbackWithoutCredentials(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	claudeDir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	payload := `{"oauthAccount":{"emailAddress":"fallback@example.com","organizationType":"claude_team"}}`
	if err := os.WriteFile(filepath.Join(home, ".claude.json"), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	setTestUserHome(t, home)

	snaps, account, err := ProbeClaudeQuota(context.Background(), claudeDir)
	if account == nil || account.Email != "fallback@example.com" || account.AuthPresent {
		t.Fatalf("account = %+v err=%v (desktop JSON should not claim oauth auth)", account, err)
	}
	if len(snaps) != 0 {
		t.Fatalf("expected no quota snapshots without oauth, got %d", len(snaps))
	}
	if err == nil {
		t.Fatal("expected credentials-not-found error")
	}
}

func TestRefreshClaudeToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/oauth/token" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "new-access",
			"refresh_token": "new-refresh",
			"expires_in":    3600,
		})
	}))
	defer srv.Close()

	prevURL := claudeTokenEndpoint
	claudeTokenEndpoint = srv.URL + "/v1/oauth/token"
	t.Cleanup(func() { claudeTokenEndpoint = prevURL })

	dir := t.TempDir()
	bundle := &ClaudeCredentialBundle{
		Creds: &claudeCredentials{
			AccessToken:  "old-access",
			RefreshToken: "old-refresh",
		},
		ConfigDir: dir,
		Source:    claudeCredsSourceFile,
	}
	refreshed, err := refreshClaudeToken(context.Background(), bundle)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Creds.AccessToken != "new-access" || refreshed.Creds.RefreshToken != "new-refresh" {
		t.Fatalf("creds = %+v", refreshed.Creds)
	}
	data, err := os.ReadFile(filepath.Join(dir, ".credentials.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "new-access") {
		t.Fatalf("file = %s", data)
	}
}

func TestClaudeCredentialsFromKeychainJSON(t *testing.T) {
	raw := `{
	  "claudeAiOauth": {
	    "accessToken": "access-token",
	    "refreshToken": "refresh-token",
	    "subscriptionType": "pro",
	    "rateLimitTier": "default_claude_ai",
	    "expiresAt": 1780954907998
	  }
	}`
	creds, err := claudeCredentialsFromKeychainJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if creds.AccessToken != "access-token" || creds.SubscriptionType != "pro" || creds.ExpiresAtMs != 1780954907998 {
		t.Fatalf("creds = %+v", creds)
	}
}

func TestClaudeAccountKeepsPlanWhenTokenExpired(t *testing.T) {
	now := time.UnixMilli(1_784_266_560_000) // 2026-07-17
	// No refresh token: still report subscriptionType so seat sync can create
	// a Pro seat even when live quota probe cannot run (Codex parity).
	expired := claudeAccountFromCreds(&claudeCredentials{
		AccessToken:      "access-token",
		SubscriptionType: "pro",
		ExpiresAtMs:      1_780_954_907_998,
	}, now)
	if expired == nil || expired.Plan != "pro" || !expired.AuthPresent {
		t.Fatalf("expired account = %+v", expired)
	}

	fresh := claudeAccountFromCreds(&claudeCredentials{
		AccessToken:      "access-token",
		SubscriptionType: "max",
		ExpiresAtMs:      1_790_000_000_000,
	}, now)
	if fresh == nil || fresh.Plan != "max" {
		t.Fatalf("fresh account = %+v", fresh)
	}
}

func TestShouldRefreshClaudeToken(t *testing.T) {
	now := time.UnixMilli(1_784_266_560_000)
	if shouldRefreshClaudeToken(nil, now) {
		t.Fatal("nil creds")
	}
	if shouldRefreshClaudeToken(&claudeCredentials{RefreshToken: "rt", ExpiresAtMs: now.Add(2 * time.Hour).UnixMilli()}, now) {
		t.Fatal("fresh token should not refresh")
	}
	if !shouldRefreshClaudeToken(&claudeCredentials{RefreshToken: "rt", ExpiresAtMs: now.Add(-time.Minute).UnixMilli()}, now) {
		t.Fatal("expired token should refresh")
	}
}

func TestRevitalizeClaudeCredentialPlanWritesTeamPlan(t *testing.T) {
	dir := t.TempDir()
	credsPath := filepath.Join(dir, ".credentials.json")
	initial := `{
	  "access_token": "access-token",
	  "refresh_token": "refresh-token",
	  "email": "user@example.com",
	  "subscription_type": "pro",
	  "expires_at_ms": 1999999999999
	}`
	if err := os.WriteFile(credsPath, []byte(initial), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle := &ClaudeCredentialBundle{
		Creds: &claudeCredentials{
			AccessToken:      "access-token",
			RefreshToken:     "refresh-token",
			Email:            "user@example.com",
			SubscriptionType: "pro",
			ExpiresAtMs:      1999999999999,
		},
		ConfigDir: dir,
		Source:    claudeCredsSourceFile,
	}
	if err := revitalizeClaudeCredentialPlan(bundle, "team-standard"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(credsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "team_standard") {
		t.Fatalf("expected team_standard in creds file, got %s", data)
	}
	if bundle.Creds.SubscriptionType != "team_standard" {
		t.Fatalf("bundle plan = %q", bundle.Creds.SubscriptionType)
	}
}

func TestClaudePlanFromUsageRaw(t *testing.T) {
	rawJSON := `{"subscription_type": "team_standard"}`
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(rawJSON), &raw); err != nil {
		t.Fatal(err)
	}
	if got := claudePlanFromUsageRaw(raw); got != "team-standard" {
		t.Fatalf("plan = %q", got)
	}
}

func TestRefreshClaudeTokenAppliesSubscriptionType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":      "new-access",
			"refresh_token":     "new-refresh",
			"expires_in":        3600,
			"subscription_type": "team_standard",
		})
	}))
	defer srv.Close()

	prevURL := claudeTokenEndpoint
	claudeTokenEndpoint = srv.URL + "/v1/oauth/token"
	t.Cleanup(func() { claudeTokenEndpoint = prevURL })

	dir := t.TempDir()
	bundle := &ClaudeCredentialBundle{
		Creds: &claudeCredentials{
			AccessToken:      "old-access",
			RefreshToken:     "old-refresh",
			SubscriptionType: "pro",
		},
		ConfigDir: dir,
		Source:    claudeCredsSourceFile,
	}
	refreshed, err := refreshClaudeToken(context.Background(), bundle)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Creds.SubscriptionType != "team_standard" {
		t.Fatalf("subscription_type = %q", refreshed.Creds.SubscriptionType)
	}
}

func TestClaudeUsageSnapshots(t *testing.T) {
	rawJSON := `{
	  "five_hour": {"utilization": 55, "resets_at": "2026-07-14T18:00:00Z"},
	  "seven_day": {"utilization": 20, "resets_at": "2026-07-20T00:00:00Z"},
	  "seven_day_opus": {"utilization": 5, "resets_at": "2026-07-20T00:00:00Z"},
	  "extra_usage": {"monthly_limit": 100, "used_credits": 25}
	}`
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(rawJSON), &raw); err != nil {
		t.Fatal(err)
	}
	snaps := claudeUsageSnapshots(raw)
	byType := map[string]types.QuotaSnapshot{}
	for _, s := range snaps {
		byType[s.WindowType] = s
	}
	if byType["session_5h"].UsedPercent == nil || *byType["session_5h"].UsedPercent != 55 {
		t.Fatalf("session = %+v", byType["session_5h"])
	}
	if byType["extra_usage"].UsedPercent == nil || *byType["extra_usage"].UsedPercent != 25 {
		t.Fatalf("extra = %+v", byType["extra_usage"])
	}
}

func TestOpenCodeAccountFromAuthJSON(t *testing.T) {
	zen, err := opencodeAccountFromAuthJSON([]byte(`{"opencode":{"type":"api","key":"sk-x"},"zai":{"type":"api","key":"z"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if zen.Plan != "zen" || !zen.AuthPresent {
		t.Fatalf("zen = %+v", zen)
	}
	multi, err := opencodeAccountFromAuthJSON([]byte(`{"zai":{"type":"api","key":"z"},"xai":{"type":"api","key":"x"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if multi.Plan != "multi_provider" {
		t.Fatalf("multi = %+v", multi)
	}
	empty, err := opencodeAccountFromAuthJSON([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if empty.AuthPresent || empty.Plan != "" {
		t.Fatalf("empty = %+v", empty)
	}
}

func TestOpenCodeServiceIDsFromAccountJSON(t *testing.T) {
	ids := opencodeServiceIDsFromAccountJSON([]byte(`{
		"version": 1,
		"accounts": {
			"a1": {"id":"a1","serviceID":"github-copilot","credential":{"type":"oauth","access":"SECRET"}},
			"a2": {"id":"a2","serviceID":"opencode","credential":{"type":"api","key":"SECRET"}}
		},
		"active": {"github-copilot":"a1","opencode":"a2","zai":"a3"}
	}`))
	want := map[string]bool{"github-copilot": true, "opencode": true, "zai": true}
	if len(ids) != 3 {
		t.Fatalf("ids = %#v", ids)
	}
	for _, id := range ids {
		if !want[id] {
			t.Fatalf("unexpected id %q in %#v", id, ids)
		}
		if id == "SECRET" || id == "a1" {
			t.Fatalf("leaked credential material: %#v", ids)
		}
	}
	account := opencodeAccountFromProviders(map[string]struct{}{
		"github-copilot": {},
		"opencode":       {},
		"zai":            {},
	})
	if account.Plan != "zen" || !account.AuthPresent || account.LoginMethod != "multi" {
		t.Fatalf("account = %+v", account)
	}
}
