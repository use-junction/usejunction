package probe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/types"
)

const (
	codexOAuthClientID = "app_EMoamEEZ73f0CkXaXp7hrann"
	codexUsageURL      = "https://chatgpt.com/backend-api/wham/usage"
	codexTokenURL      = "https://auth.openai.com/oauth/token"
)

type codexAuthTokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	AccountID    string `json:"account_id"`
}

type codexAuthFile struct {
	AccessToken  string           `json:"access_token"`
	RefreshToken string           `json:"refresh_token"`
	IDToken      string           `json:"id_token"`
	AccountID    string           `json:"account_id"`
	LastRefresh  string           `json:"last_refresh"`
	Email        string           `json:"email"`
	PlanType     string           `json:"plan_type"`
	Tokens       *codexAuthTokens `json:"tokens"`
	nestedTokens bool
}

func (auth *codexAuthFile) normalize() {
	if auth.Tokens == nil {
		return
	}
	auth.nestedTokens = true
	if auth.AccessToken == "" {
		auth.AccessToken = auth.Tokens.AccessToken
	}
	if auth.RefreshToken == "" {
		auth.RefreshToken = auth.Tokens.RefreshToken
	}
	if auth.IDToken == "" {
		auth.IDToken = auth.Tokens.IDToken
	}
	if auth.AccountID == "" {
		auth.AccountID = auth.Tokens.AccountID
	}
}

func codexPlanFromClaims(claims map[string]any) string {
	if plan := claimString(claims, "plan_type", "https://api.openai.com/plan_type"); plan != "" {
		return plan
	}
	if auth, ok := claims["https://api.openai.com/auth"].(map[string]any); ok {
		if plan := strings.TrimSpace(stringValue(auth["chatgpt_plan_type"])); plan != "" {
			return plan
		}
	}
	return ""
}

func LoadCodexAuth(home string) (*codexAuthFile, error) {
	path := filepath.Join(home, "auth.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var auth codexAuthFile
	if err := json.Unmarshal(data, &auth); err != nil {
		return nil, err
	}
	auth.normalize()
	if strings.TrimSpace(auth.AccessToken) == "" {
		return nil, fmt.Errorf("codex auth missing access_token")
	}
	return &auth, nil
}

// SaveCodexAuth writes refreshed OAuth tokens back to ~/.codex/auth.json only.
// This never touches config.toml or TCC-gated folders (Documents/Downloads/…).
func SaveCodexAuth(home string, auth *codexAuthFile) error {
	path := filepath.Join(home, "auth.json")
	if auth.nestedTokens {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var doc map[string]any
		if err := json.Unmarshal(data, &doc); err != nil {
			return err
		}
		tokens, _ := doc["tokens"].(map[string]any)
		if tokens == nil {
			tokens = map[string]any{}
			doc["tokens"] = tokens
		}
		tokens["access_token"] = auth.AccessToken
		if auth.RefreshToken != "" {
			tokens["refresh_token"] = auth.RefreshToken
		}
		if auth.IDToken != "" {
			tokens["id_token"] = auth.IDToken
		}
		if auth.AccountID != "" {
			tokens["account_id"] = auth.AccountID
		}
		if auth.LastRefresh != "" {
			doc["last_refresh"] = auth.LastRefresh
		}
		out, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(path, out, 0600)
	}
	data, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

type codexUsageWindow struct {
	UsedPercent        float64 `json:"used_percent"`
	ResetAt            any     `json:"reset_at"`
	LimitWindowSeconds int     `json:"limit_window_seconds"`
	ResetAfterSeconds  int     `json:"reset_after_seconds"`
}

type codexResetCreditsSummary struct {
	AvailableCount           int `json:"available_count"`
	ApplicableAvailableCount int `json:"applicable_available_count"`
}

type codexPromo struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	ID          string `json:"id"`
}

func codexResetAtString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return fmt.Sprintf("%.0f", t)
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

func codexResetAt(v any) *string {
	raw := strings.TrimSpace(codexResetAtString(v))
	if raw == "" {
		return nil
	}
	parsed := parseUnixOrRFC3339(raw)
	if parsed.IsZero() {
		return nil
	}
	return strPtr(parsed.UTC().Format(time.RFC3339))
}

type codexUsageResponse struct {
	PlanType  string `json:"plan_type"`
	Email     string `json:"email"`
	RateLimit struct {
		PrimaryWindow   codexUsageWindow  `json:"primary_window"`
		SecondaryWindow *codexUsageWindow `json:"secondary_window"`
	} `json:"rate_limit"`
	Credits struct {
		HasCredits bool `json:"has_credits"`
		Balance    any  `json:"balance"`
	} `json:"credits"`
	Promo                 *codexPromo               `json:"promo"`
	RateLimitResetCredits *codexResetCreditsSummary `json:"rate_limit_reset_credits"`
}

type codexResetCreditsResponse struct {
	Credits          []codexResetCredit `json:"credits"`
	AvailableCount   int                `json:"available_count"`
	TotalEarnedCount int                `json:"total_earned_count"`
}

type codexResetCredit struct {
	ID          string `json:"id"`
	ResetType   string `json:"reset_type"`
	Status      string `json:"status"`
	GrantedAt   string `json:"granted_at"`
	ExpiresAt   string `json:"expires_at"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

const codexResetCreditsURL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"

// codexWindowType maps provider window length onto Junction window labels.
func codexWindowType(window codexUsageWindow, fallback string) string {
	sec := window.LimitWindowSeconds
	if sec <= 0 {
		return fallback
	}
	switch {
	case sec <= 6*3600:
		return "session_5h"
	case sec <= 10*24*3600:
		return "weekly"
	default:
		return "monthly"
	}
}

func codexCreditsBalance(v any) float64 {
	return numberValue(v)
}

func codexResetCreditsAvailableCount(summary *codexResetCreditsSummary) int {
	if summary == nil {
		return 0
	}
	if summary.ApplicableAvailableCount > 0 {
		return summary.ApplicableAvailableCount
	}
	return summary.AvailableCount
}

func codexResetCreditSnapshot(available int, nearestExpiry *string, source string) types.QuotaSnapshot {
	snap := types.QuotaSnapshot{
		ToolName:         "codex",
		WindowType:       "rate_limit_resets",
		CreditsRemaining: floatPtr(float64(available)),
		Source:           source,
	}
	if nearestExpiry != nil {
		snap.ResetAt = nearestExpiry
	}
	return snap
}

func codexQuotaSnapshots(usage codexUsageResponse, source string) []types.QuotaSnapshot {
	var snapshots []types.QuotaSnapshot
	if primary := usage.RateLimit.PrimaryWindow; primary.UsedPercent > 0 || codexResetAt(primary.ResetAt) != nil {
		snapshots = append(snapshots, types.QuotaSnapshot{
			ToolName:    "codex",
			WindowType:  codexWindowType(primary, "session_5h"),
			UsedPercent: floatPtr(primary.UsedPercent),
			ResetAt:     codexResetAt(primary.ResetAt),
			Source:      source,
		})
	}
	if secondary := usage.RateLimit.SecondaryWindow; secondary != nil {
		if secondary.UsedPercent > 0 || codexResetAt(secondary.ResetAt) != nil {
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName:    "codex",
				WindowType:  codexWindowType(*secondary, "weekly"),
				UsedPercent: floatPtr(secondary.UsedPercent),
				ResetAt:     codexResetAt(secondary.ResetAt),
				Source:      source,
			})
		}
	}
	if usage.Credits.HasCredits {
		snapshots = append(snapshots, types.QuotaSnapshot{
			ToolName:         "codex",
			WindowType:       "credits",
			CreditsRemaining: floatPtr(codexCreditsBalance(usage.Credits.Balance)),
			Source:           source,
		})
	}
	if summary := usage.RateLimitResetCredits; summary != nil {
		snapshots = append(snapshots, codexResetCreditSnapshot(codexResetCreditsAvailableCount(summary), nil, source))
	}
	if usage.Promo != nil && strings.TrimSpace(usage.Promo.Title) != "" {
		snapshots = append(snapshots, types.QuotaSnapshot{
			ToolName:   "codex",
			WindowType: "promo",
			Source:     source,
		})
	}
	return snapshots
}

func fetchCodexResetCredits(ctx context.Context, auth *codexAuthFile) (*codexResetCreditsResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, codexResetCreditsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+auth.AccessToken)
	req.Header.Set("Accept", "application/json")
	if auth.AccountID != "" {
		req.Header.Set("ChatGPT-Account-Id", auth.AccountID)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("codex reset-credits http %d", resp.StatusCode)
	}
	var out codexResetCreditsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func codexResetCreditSnapshots(credits *codexResetCreditsResponse, source string) []types.QuotaSnapshot {
	if credits == nil {
		return nil
	}
	available := 0
	var nearestExpiry *string
	for _, credit := range credits.Credits {
		if !strings.EqualFold(strings.TrimSpace(credit.Status), "available") {
			continue
		}
		available++
		if exp := strings.TrimSpace(credit.ExpiresAt); exp != "" {
			parsed := parseUnixOrRFC3339(exp)
			if !parsed.IsZero() {
				formatted := parsed.UTC().Format(time.RFC3339)
				if nearestExpiry == nil || formatted < *nearestExpiry {
					nearestExpiry = strPtr(formatted)
				}
			}
		}
	}
	if available == 0 && credits.AvailableCount > 0 {
		available = credits.AvailableCount
	}
	return []types.QuotaSnapshot{codexResetCreditSnapshot(available, nearestExpiry, source)}
}

func CodexAccountFromAuth(home string) (*types.ToolAccount, error) {
	auth, err := LoadCodexAuth(home)
	if err != nil {
		return nil, err
	}
	email := strings.TrimSpace(auth.Email)
	plan := strings.TrimSpace(auth.PlanType)
	if auth.IDToken != "" {
		claims := jwtPayload(auth.IDToken)
		if email == "" {
			email = claimString(claims, "email")
		}
		if plan == "" {
			plan = codexPlanFromClaims(claims)
		}
	}
	accountKey := strings.TrimSpace(auth.AccountID)
	if accountKey == "" {
		accountKey = strings.ToLower(strings.TrimSpace(email))
	}
	return &types.ToolAccount{
		ToolName:    "codex",
		AccountKey:  accountKey,
		Email:       email,
		Plan:        plan,
		LoginMethod: "oauth",
		AuthPresent: true,
	}, nil
}

func CodexAccountIdentity(ctx context.Context, home string) (*types.ToolAccount, error) {
	account, err := CodexAccountFromAuth(home)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(account.Plan) != "" {
		return account, nil
	}
	_, probeAccount, err := ProbeCodexQuota(ctx, home)
	if err == nil && probeAccount != nil {
		if probeAccount.Plan != "" {
			account.Plan = probeAccount.Plan
		}
		if account.Email == "" {
			account.Email = probeAccount.Email
		}
	}
	return account, nil
}

func ProbeCodexQuota(ctx context.Context, home string) ([]types.QuotaSnapshot, *types.ToolAccount, error) {
	auth, err := LoadCodexAuth(home)
	if err != nil {
		if quotas, rpcErr := probeCodexRPC(ctx); rpcErr == nil && len(quotas) > 0 {
			return quotas, nil, nil
		}
		return nil, nil, err
	}

	if shouldRefreshCodexToken(auth) {
		if refreshed, refreshErr := refreshCodexToken(ctx, home, auth); refreshErr == nil {
			auth = refreshed
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, codexUsageURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+auth.AccessToken)
	req.Header.Set("Accept", "application/json")
	if auth.AccountID != "" {
		req.Header.Set("ChatGPT-Account-Id", auth.AccountID)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if quotas, rpcErr := probeCodexRPC(ctx); rpcErr == nil && len(quotas) > 0 {
			return quotas, nil, nil
		}
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		if quotas, rpcErr := probeCodexRPC(ctx); rpcErr == nil && len(quotas) > 0 {
			return quotas, nil, nil
		}
		return nil, nil, fmt.Errorf("codex oauth unauthorized")
	}
	if resp.StatusCode >= 300 {
		if quotas, rpcErr := probeCodexRPC(ctx); rpcErr == nil && len(quotas) > 0 {
			return quotas, nil, nil
		}
		return nil, nil, fmt.Errorf("codex usage http %d", resp.StatusCode)
	}

	var usage codexUsageResponse
	if err := json.Unmarshal(body, &usage); err != nil {
		return nil, nil, err
	}

	account, _ := CodexAccountFromAuth(home)
	if account != nil {
		if usage.PlanType != "" {
			account.Plan = usage.PlanType
		}
		if account.Email == "" && usage.Email != "" {
			account.Email = usage.Email
		}
	}

	snapshots := codexQuotaSnapshots(usage, "oauth_api")
	// Prefer the dedicated inventory endpoint when available (includes expiry).
	if resetCredits, err := fetchCodexResetCredits(ctx, auth); err == nil {
		detailed := codexResetCreditSnapshots(resetCredits, "oauth_api")
		snapshots = replaceQuotaWindow(snapshots, "rate_limit_resets", detailed)
	}

	return snapshots, account, nil
}

func replaceQuotaWindow(existing []types.QuotaSnapshot, windowType string, replacement []types.QuotaSnapshot) []types.QuotaSnapshot {
	out := existing[:0]
	for _, snap := range existing {
		if snap.WindowType == windowType {
			continue
		}
		out = append(out, snap)
	}
	return append(out, replacement...)
}

func shouldRefreshCodexToken(auth *codexAuthFile) bool {
	if strings.TrimSpace(auth.RefreshToken) == "" {
		return false
	}
	if auth.LastRefresh == "" {
		return true
	}
	t := parseUnixOrRFC3339(auth.LastRefresh)
	if t.IsZero() {
		return true
	}
	return time.Since(t) > 7*24*time.Hour
}

func refreshCodexToken(ctx context.Context, home string, auth *codexAuthFile) (*codexAuthFile, error) {
	form := "grant_type=refresh_token&refresh_token=" + auth.RefreshToken + "&client_id=" + codexOAuthClientID
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, codexTokenURL, strings.NewReader(form))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("codex token refresh http %d", resp.StatusCode)
	}
	var refreshed map[string]any
	if err := json.Unmarshal(body, &refreshed); err != nil {
		return nil, err
	}
	if v, ok := refreshed["access_token"].(string); ok && v != "" {
		auth.AccessToken = v
	}
	if v, ok := refreshed["refresh_token"].(string); ok && v != "" {
		auth.RefreshToken = v
	}
	if v, ok := refreshed["id_token"].(string); ok && v != "" {
		auth.IDToken = v
	}
	auth.LastRefresh = time.Now().UTC().Format(time.RFC3339)
	if err := SaveCodexAuth(home, auth); err != nil {
		return nil, err
	}
	return auth, nil
}

type rpcWindow struct {
	UsedPercent float64
	ResetAt     *string
}

func numberValue(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return 0
	}
}

func stringValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
