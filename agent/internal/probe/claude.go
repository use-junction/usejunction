package probe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/types"
)

const (
	claudeOAuthClientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
	claudeUsageURL      = "https://api.anthropic.com/api/oauth/usage"

	claudeCredsSourceFile           = "file"
	claudeCredsSourceKeychainHashed = "keychain_hashed"
	claudeCredsSourceKeychainLegacy = "keychain_legacy"
)

// claudeTokenEndpoint is a var so tests can point at httptest servers.
var claudeTokenEndpoint = "https://platform.claude.com/v1/oauth/token"

type claudeCredentials struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	Email            string `json:"email"`
	AccountUUID      string `json:"account_uuid"`
	SubscriptionType string `json:"subscription_type"`
	RateLimitTier    string `json:"rate_limit_tiers"`
	ExpiresAtMs      int64  `json:"expires_at_ms"`
}

// ClaudeCredentialBundle tracks where OAuth tokens were loaded so refresh can
// persist back to the same store (file vs hashed vs legacy keychain).
type ClaudeCredentialBundle struct {
	Creds           *claudeCredentials
	ConfigDir       string
	Source          string
	KeychainService string
}

type claudeUsageWindow struct {
	Utilization    *float64        `json:"utilization"`
	UsedPercentage *float64        `json:"used_percentage"`
	ResetsAt       json.RawMessage `json:"resets_at"`
}

func (w claudeUsageWindow) usedPercent() (float64, bool) {
	if w.Utilization != nil {
		return *w.Utilization, true
	}
	if w.UsedPercentage != nil {
		return *w.UsedPercentage, true
	}
	return 0, false
}

func (w claudeUsageWindow) resetsAtRFC3339() string {
	if len(w.ResetsAt) == 0 || string(w.ResetsAt) == "null" {
		return ""
	}
	var asString string
	if json.Unmarshal(w.ResetsAt, &asString) == nil {
		t := parseUnixOrRFC3339(asString)
		if t.IsZero() {
			return ""
		}
		return t.UTC().Format(time.RFC3339)
	}
	var asNumber float64
	if json.Unmarshal(w.ResetsAt, &asNumber) == nil {
		sec := int64(asNumber)
		if sec > 1_000_000_000_000 {
			return time.UnixMilli(sec).UTC().Format(time.RFC3339)
		}
		return time.Unix(sec, 0).UTC().Format(time.RFC3339)
	}
	return ""
}

type claudeKeychainOAuth struct {
	AccessToken      string   `json:"accessToken"`
	RefreshToken     string   `json:"refreshToken"`
	ExpiresAt        int64    `json:"expiresAt"`
	Scopes           []string `json:"scopes"`
	SubscriptionType string   `json:"subscriptionType"`
	RateLimitTier    string   `json:"rateLimitTier"`
}

type claudeKeychainBlob struct {
	ClaudeAiOauth *claudeKeychainOAuth `json:"claudeAiOauth"`
}

type claudeJSONOAuthAccount struct {
	EmailAddress     string `json:"emailAddress"`
	AccountUUID      string `json:"accountUuid"`
	OrganizationType string `json:"organizationType"`
	BillingType      string `json:"billingType"`
	SubscriptionType string `json:"subscriptionType"`
	SeatTier         string `json:"seatTier"`
}

// ClaudeKeychainHashedService returns the modern Claude Code keychain service name
// for a config directory (sha256(path)[:8]).
func ClaudeKeychainHashedService(configDir string) string {
	expanded := configDir
	if abs, err := filepath.Abs(configDir); err == nil {
		expanded = abs
	}
	sum := sha256.Sum256([]byte(expanded))
	return "Claude Code-credentials-" + hex.EncodeToString(sum[:])[:8]
}

func claudeKeychainLegacyService() string {
	return "Claude Code-credentials"
}

func LoadClaudeCredentials(dir string) (*claudeCredentials, error) {
	bundle, err := LoadClaudeCredentialBundle(dir)
	if err != nil {
		return nil, err
	}
	return bundle.Creds, nil
}

func LoadClaudeCredentialBundle(dir string) (*ClaudeCredentialBundle, error) {
	if creds, err := loadClaudeCredentialsFile(dir); err == nil {
		return &ClaudeCredentialBundle{
			Creds:     creds,
			ConfigDir: dir,
			Source:    claudeCredsSourceFile,
		}, nil
	}
	if runtime.GOOS == "darwin" {
		if service := ClaudeKeychainHashedService(dir); service != "" {
			if creds, err := loadClaudeCredentialsKeychainService(service); err == nil {
				return &ClaudeCredentialBundle{
					Creds:           creds,
					ConfigDir:       dir,
					Source:          claudeCredsSourceKeychainHashed,
					KeychainService: service,
				}, nil
			}
		}
		if creds, err := loadClaudeCredentialsKeychainService(claudeKeychainLegacyService()); err == nil {
			return &ClaudeCredentialBundle{
				Creds:           creds,
				ConfigDir:       dir,
				Source:          claudeCredsSourceKeychainLegacy,
				KeychainService: claudeKeychainLegacyService(),
			}, nil
		}
	}
	return nil, fmt.Errorf("claude credentials not found")
}

func loadClaudeCredentialsFile(dir string) (*claudeCredentials, error) {
	path := filepath.Join(dir, ".credentials.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var creds claudeCredentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, err
	}
	if strings.TrimSpace(creds.AccessToken) == "" {
		return nil, fmt.Errorf("claude credentials missing access_token")
	}
	return &creds, nil
}

func loadClaudeCredentialsKeychainService(service string) (*claudeCredentials, error) {
	account := keychainAccountName()
	args := []string{"find-generic-password", "-s", service, "-w"}
	if account != "" {
		args = []string{"find-generic-password", "-a", account, "-s", service, "-w"}
	}
	out, err := exec.Command("security", args...).Output()
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(string(out))
	return claudeCredentialsFromKeychainJSON(raw)
}

func keychainAccountName() string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	return ""
}

func claudeCredentialsFromKeychainJSON(raw string) (*claudeCredentials, error) {
	var blob claudeKeychainBlob
	if err := json.Unmarshal([]byte(raw), &blob); err != nil {
		return nil, err
	}
	if blob.ClaudeAiOauth == nil || strings.TrimSpace(blob.ClaudeAiOauth.AccessToken) == "" {
		return nil, fmt.Errorf("claude keychain missing oauth token")
	}
	oauth := blob.ClaudeAiOauth
	return &claudeCredentials{
		AccessToken:      oauth.AccessToken,
		RefreshToken:     oauth.RefreshToken,
		SubscriptionType: oauth.SubscriptionType,
		RateLimitTier:    oauth.RateLimitTier,
		ExpiresAtMs:      oauth.ExpiresAt,
	}, nil
}

func claudeTokenExpired(creds *claudeCredentials, now time.Time) bool {
	if creds == nil || creds.ExpiresAtMs <= 0 {
		return false
	}
	return now.UnixMilli() >= creds.ExpiresAtMs
}

func claudeAccountFromCreds(creds *claudeCredentials, now time.Time) *types.ToolAccount {
	if creds == nil {
		return nil
	}
	// Match Codex: local subscriptionType is authoritative for plan identity even
	// when the access token is expired. Expiry only blocks live quota windows.
	account := &types.ToolAccount{
		ToolName:    "claude",
		Email:       strings.TrimSpace(creds.Email),
		Plan:        normalizeClaudePlan(creds.SubscriptionType),
		LoginMethod: "oauth",
		AuthPresent: true,
	}
	_ = now
	return account
}

func claudePlanFromOAuthAccount(oa claudeJSONOAuthAccount) string {
	if p := strings.TrimSpace(oa.SubscriptionType); p != "" {
		return normalizeClaudePlan(p)
	}
	if st := strings.TrimSpace(oa.SeatTier); st != "" {
		return normalizeClaudePlan(st)
	}
	orgType := strings.ToLower(strings.TrimSpace(oa.OrganizationType))
	switch {
	case strings.Contains(orgType, "team"):
		return "team-standard"
	case strings.Contains(orgType, "enterprise"):
		return "enterprise"
	case orgType == "claude_max":
		return "max"
	case orgType == "claude_pro":
		return "pro"
	}
	return ""
}

func normalizeClaudePlan(plan string) string {
	p := strings.TrimSpace(plan)
	if p == "" {
		return ""
	}
	switch strings.ToLower(p) {
	case "team_standard":
		return "team-standard"
	case "team_premium":
		return "team-premium"
	default:
		return p
	}
}

// claudePlanForCredentialStorage maps normalized plan keys to credential-file shape.
func claudePlanForCredentialStorage(plan string) string {
	p := normalizeClaudePlan(plan)
	switch p {
	case "team-standard":
		return "team_standard"
	case "team-premium":
		return "team_premium"
	default:
		return p
	}
}

func claudePlanFromTokenPayload(payload map[string]any) string {
	if v, ok := payload["subscription_type"].(string); ok && strings.TrimSpace(v) != "" {
		return normalizeClaudePlan(v)
	}
	if v, ok := payload["subscriptionType"].(string); ok && strings.TrimSpace(v) != "" {
		return normalizeClaudePlan(v)
	}
	return ""
}

func claudePlanFromUsageRaw(raw map[string]json.RawMessage) string {
	for _, key := range []string{"subscription_type", "subscriptionType", "plan_type", "planType"} {
		msg, ok := raw[key]
		if !ok {
			continue
		}
		var plan string
		if err := json.Unmarshal(msg, &plan); err == nil && strings.TrimSpace(plan) != "" {
			return normalizeClaudePlan(plan)
		}
	}
	return ""
}

func revitalizeClaudeCredentialPlan(bundle *ClaudeCredentialBundle, mergedPlan string) error {
	if bundle == nil || bundle.Creds == nil {
		return nil
	}
	merged := normalizeClaudePlan(mergedPlan)
	if merged == "" {
		return nil
	}
	credsPlan := normalizeClaudePlan(bundle.Creds.SubscriptionType)
	if merged == credsPlan {
		return nil
	}
	if preferClaudePlan(credsPlan, merged) != merged {
		return nil
	}
	bundle.Creds.SubscriptionType = claudePlanForCredentialStorage(merged)
	return SaveClaudeCredentialBundle(bundle)
}

func enrichClaudeAccountPlan(account *types.ToolAccount, apiPlan string) *types.ToolAccount {
	if account == nil {
		return account
	}
	apiPlan = normalizeClaudePlan(apiPlan)
	if apiPlan == "" {
		return account
	}
	account.Plan = preferClaudePlan(account.Plan, apiPlan)
	return account
}

func isClaudeTeamOrEnterprisePlan(plan string) bool {
	p := strings.ToLower(strings.TrimSpace(plan))
	if p == "" {
		return false
	}
	if p == "team" || p == "team-standard" || p == "team-premium" || p == "enterprise" {
		return true
	}
	return strings.Contains(p, "team")
}

// preferClaudePlan picks the stronger plan signal when OAuth creds and
// ~/.claude.json disagree (e.g. stale subscriptionType "pro" after team upgrade).
func preferClaudePlan(credsPlan, jsonPlan string) string {
	credsPlan = strings.TrimSpace(credsPlan)
	jsonPlan = strings.TrimSpace(jsonPlan)
	if isClaudeTeamOrEnterprisePlan(jsonPlan) {
		return normalizeClaudePlan(jsonPlan)
	}
	if isClaudeTeamOrEnterprisePlan(credsPlan) {
		return normalizeClaudePlan(credsPlan)
	}
	if credsPlan != "" {
		return normalizeClaudePlan(credsPlan)
	}
	return normalizeClaudePlan(jsonPlan)
}

func mergeClaudeAccounts(credsAccount, jsonAccount *types.ToolAccount) *types.ToolAccount {
	if credsAccount == nil && jsonAccount == nil {
		return nil
	}
	if credsAccount == nil {
		return jsonAccount
	}
	if jsonAccount == nil {
		return credsAccount
	}
	email := strings.TrimSpace(credsAccount.Email)
	if email == "" {
		email = strings.TrimSpace(jsonAccount.Email)
	}
	return &types.ToolAccount{
		ToolName:    "claude",
		Email:       email,
		Plan:        preferClaudePlan(credsAccount.Plan, jsonAccount.Plan),
		LoginMethod: "oauth",
		AuthPresent: credsAccount.AuthPresent || jsonAccount.AuthPresent,
	}
}

func claudeJSONAccount(home string) *types.ToolAccount {
	account, err := ClaudeAccountFromClaudeJSON(home)
	if err != nil {
		return nil
	}
	return account
}

// ClaudeAccountFromClaudeJSON reads ~/.claude.json oauthAccount when OAuth tokens
// are unavailable (e.g. Claude Desktop Safe Storage only).
func ClaudeAccountFromClaudeJSON(home string) (*types.ToolAccount, error) {
	path := filepath.Join(home, ".claude.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		OAuthAccount *claudeJSONOAuthAccount `json:"oauthAccount"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	if doc.OAuthAccount == nil {
		return nil, fmt.Errorf("claude.json missing oauthAccount")
	}
	email := strings.TrimSpace(doc.OAuthAccount.EmailAddress)
	if email == "" {
		return nil, fmt.Errorf("claude.json missing oauthAccount.emailAddress")
	}
	return &types.ToolAccount{
		ToolName:    "claude",
		Email:       email,
		Plan:        claudePlanFromOAuthAccount(*doc.OAuthAccount),
		// Plan metadata only — live quota windows still need Code OAuth tokens.
		LoginMethod: "desktop",
		AuthPresent: false,
	}, nil
}

// ClaudeAccountIdentity returns the best available Claude account by merging OAuth
// creds with ~/.claude.json org signals (team upgrades can lag in creds).
func ClaudeAccountIdentity(configDir string) (*types.ToolAccount, error) {
	var credsAccount *types.ToolAccount
	if bundle, err := LoadClaudeCredentialBundle(configDir); err == nil && bundle.Creds != nil {
		credsAccount = claudeAccountFromCreds(bundle.Creds, time.Now())
	}
	var jsonAccount *types.ToolAccount
	var jsonErr error
	if home, err := os.UserHomeDir(); err == nil {
		jsonAccount, jsonErr = ClaudeAccountFromClaudeJSON(home)
	} else {
		jsonErr = err
	}
	if merged := mergeClaudeAccounts(credsAccount, jsonAccount); merged != nil {
		return merged, nil
	}
	if jsonErr != nil {
		return nil, jsonErr
	}
	return nil, fmt.Errorf("claude account not found")
}

func shouldRefreshClaudeToken(creds *claudeCredentials, now time.Time) bool {
	if creds == nil || strings.TrimSpace(creds.RefreshToken) == "" {
		return false
	}
	if creds.ExpiresAtMs <= 0 {
		return true
	}
	return now.UnixMilli() >= creds.ExpiresAtMs-5*60*1000
}

func SaveClaudeCredentialBundle(bundle *ClaudeCredentialBundle) error {
	if bundle == nil || bundle.Creds == nil {
		return fmt.Errorf("missing credential bundle")
	}
	switch bundle.Source {
	case claudeCredsSourceKeychainHashed, claudeCredsSourceKeychainLegacy:
		if bundle.KeychainService == "" {
			return fmt.Errorf("missing keychain service")
		}
		return saveClaudeCredentialsKeychain(bundle.KeychainService, bundle.Creds)
	default:
		return saveClaudeCredentialsFile(bundle.ConfigDir, bundle.Creds)
	}
}

func saveClaudeCredentialsFile(dir string, creds *claudeCredentials) error {
	path := filepath.Join(dir, ".credentials.json")
	var doc map[string]any
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &doc); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if doc == nil {
		doc = map[string]any{}
	}
	doc["access_token"] = creds.AccessToken
	if creds.RefreshToken != "" {
		doc["refresh_token"] = creds.RefreshToken
	}
	if creds.Email != "" {
		doc["email"] = creds.Email
	}
	if creds.AccountUUID != "" {
		doc["account_uuid"] = creds.AccountUUID
	}
	if creds.SubscriptionType != "" {
		doc["subscription_type"] = creds.SubscriptionType
	}
	if creds.RateLimitTier != "" {
		doc["rate_limit_tiers"] = creds.RateLimitTier
	}
	if creds.ExpiresAtMs > 0 {
		doc["expires_at_ms"] = creds.ExpiresAtMs
	}
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0600)
}

func saveClaudeCredentialsKeychain(service string, creds *claudeCredentials) error {
	blob := claudeKeychainBlob{
		ClaudeAiOauth: &claudeKeychainOAuth{
			AccessToken:      creds.AccessToken,
			RefreshToken:     creds.RefreshToken,
			SubscriptionType: creds.SubscriptionType,
			RateLimitTier:    creds.RateLimitTier,
			ExpiresAt:        creds.ExpiresAtMs,
		},
	}
	data, err := json.Marshal(blob)
	if err != nil {
		return err
	}
	account := keychainAccountName()
	args := []string{"add-generic-password", "-U", "-s", service, "-w", string(data)}
	if account != "" {
		args = []string{"add-generic-password", "-U", "-a", account, "-s", service, "-w", string(data)}
	}
	return exec.Command("security", args...).Run()
}

func refreshClaudeToken(ctx context.Context, bundle *ClaudeCredentialBundle) (*ClaudeCredentialBundle, error) {
	if bundle == nil || bundle.Creds == nil {
		return nil, fmt.Errorf("missing credential bundle")
	}
	creds := bundle.Creds
	payload, err := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": creds.RefreshToken,
		"client_id":     claudeOAuthClientID,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, claudeTokenEndpoint, strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "claude-code/2.1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("claude token refresh http %d", resp.StatusCode)
	}
	var refreshed map[string]any
	if err := json.Unmarshal(body, &refreshed); err != nil {
		return nil, err
	}
	if v, ok := refreshed["access_token"].(string); ok && v != "" {
		creds.AccessToken = v
	}
	if v, ok := refreshed["refresh_token"].(string); ok && v != "" {
		creds.RefreshToken = v
	}
	if expiresIn := numberValue(refreshed["expires_in"]); expiresIn > 0 {
		creds.ExpiresAtMs = time.Now().Add(time.Duration(expiresIn) * time.Second).UnixMilli()
	}
	if apiPlan := claudePlanFromTokenPayload(refreshed); apiPlan != "" {
		creds.SubscriptionType = claudePlanForCredentialStorage(
			preferClaudePlan(creds.SubscriptionType, apiPlan),
		)
	}
	if err := SaveClaudeCredentialBundle(bundle); err != nil {
		return nil, err
	}
	return bundle, nil
}

func ensureClaudeAccessToken(ctx context.Context, bundle *ClaudeCredentialBundle) *ClaudeCredentialBundle {
	if bundle == nil || bundle.Creds == nil || !shouldRefreshClaudeToken(bundle.Creds, time.Now()) {
		return bundle
	}
	refreshed, err := refreshClaudeToken(ctx, bundle)
	if err != nil {
		return bundle
	}
	return refreshed
}

func fetchClaudeUsage(ctx context.Context, accessToken string) (map[string]json.RawMessage, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, claudeUsageURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	req.Header.Set("User-Agent", "claude-code/2.1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, resp.StatusCode, fmt.Errorf("claude oauth usage http %d", resp.StatusCode)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, resp.StatusCode, err
	}
	return raw, resp.StatusCode, nil
}

func ClaudeAccountFromCredentials(dir string) (*types.ToolAccount, error) {
	return ClaudeAccountIdentity(dir)
}

func ProbeClaudeQuota(ctx context.Context, dir string) ([]types.QuotaSnapshot, *types.ToolAccount, error) {
	bundle, err := LoadClaudeCredentialBundle(dir)
	if err != nil {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return nil, nil, err
		}
		account, jsonErr := ClaudeAccountFromClaudeJSON(home)
		if jsonErr != nil {
			return nil, nil, err
		}
		return nil, account, fmt.Errorf("claude credentials not found")
	}

	bundle = ensureClaudeAccessToken(ctx, bundle)
	credsAccount := claudeAccountFromCreds(bundle.Creds, time.Now())
	var jsonAccount *types.ToolAccount
	if home, homeErr := os.UserHomeDir(); homeErr == nil {
		jsonAccount = claudeJSONAccount(home)
	}
	account := mergeClaudeAccounts(credsAccount, jsonAccount)

	raw, status, usageErr := fetchClaudeUsage(ctx, bundle.Creds.AccessToken)
	if usageErr != nil && (status == http.StatusUnauthorized || status == http.StatusForbidden) {
		if refreshed, refreshErr := refreshClaudeToken(ctx, bundle); refreshErr == nil {
			bundle = refreshed
			credsAccount = claudeAccountFromCreds(bundle.Creds, time.Now())
			account = mergeClaudeAccounts(credsAccount, jsonAccount)
			raw, status, usageErr = fetchClaudeUsage(ctx, bundle.Creds.AccessToken)
		}
	}
	if usageErr != nil {
		_ = revitalizeClaudeCredentialPlan(bundle, account.Plan)
		return nil, account, usageErr
	}

	account = enrichClaudeAccountPlan(account, claudePlanFromUsageRaw(raw))
	_ = revitalizeClaudeCredentialPlan(bundle, account.Plan)

	return claudeUsageSnapshots(raw), account, nil
}

func claudeUsageSnapshots(raw map[string]json.RawMessage) []types.QuotaSnapshot {
	var snapshots []types.QuotaSnapshot

	appendWindow := func(windowType, key string) {
		msg, ok := raw[key]
		if !ok {
			return
		}
		var window claudeUsageWindow
		if json.Unmarshal(msg, &window) != nil {
			return
		}
		used, ok := window.usedPercent()
		if !ok {
			return
		}
		snap := types.QuotaSnapshot{
			ToolName:    "claude",
			WindowType:  windowType,
			UsedPercent: floatPtr(used),
			Source:      "oauth_api",
		}
		if reset := window.resetsAtRFC3339(); reset != "" {
			snap.ResetAt = strPtr(reset)
		}
		snapshots = append(snapshots, snap)
	}

	appendWindow("session_5h", "five_hour")
	appendWindow("weekly", "seven_day")
	appendWindow("weekly_opus", "seven_day_opus")
	appendWindow("weekly_sonnet", "seven_day_sonnet")

	if extra, ok := raw["extra_usage"]; ok {
		var spend struct {
			MonthlyLimit float64 `json:"monthly_limit"`
			UsedCredits  float64 `json:"used_credits"`
		}
		if json.Unmarshal(extra, &spend) == nil && spend.MonthlyLimit > 0 {
			usedPct := (spend.UsedCredits / spend.MonthlyLimit) * 100
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName:    "claude",
				WindowType:  "extra_usage",
				UsedPercent: floatPtr(usedPct),
				Source:      "oauth_api",
			})
		}
	}

	return snapshots
}
