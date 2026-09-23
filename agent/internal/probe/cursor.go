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

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/sqlitedb"
	"github.com/usejunction/agent/internal/types"
)

type cursorUsageSummary struct {
	BillingCycleEnd string                 `json:"billingCycleEnd"`
	MembershipType  string                 `json:"membershipType"`
	IndividualUsage *cursorIndividualUsage `json:"individualUsage"`
}

type cursorStripeProfile struct {
	MembershipType           string `json:"membershipType"`
	IndividualMembershipType string `json:"individualMembershipType"`
	TeamMembershipType       string `json:"teamMembershipType"`
	SubscriptionStatus       string `json:"subscriptionStatus"`
}

type cursorIndividualUsage struct {
	Plan     *cursorPlanUsage     `json:"plan"`
	OnDemand *cursorOnDemandUsage `json:"onDemand"`
}

type cursorPlanUsage struct {
	TotalPercentUsed float64 `json:"totalPercentUsed"`
	AutoPercentUsed  float64 `json:"autoPercentUsed"`
	ApiPercentUsed   float64 `json:"apiPercentUsed"`
	Used             int     `json:"used"`
	Limit            int     `json:"limit"`
	Remaining        int     `json:"remaining"`
	Breakdown        *struct {
		Included int `json:"included"`
		Bonus    int `json:"bonus"`
		Total    int `json:"total"`
	} `json:"breakdown"`
}

type cursorOnDemandUsage struct {
	Used      int  `json:"used"`
	Limit     *int `json:"limit"`
	Remaining *int `json:"remaining"`
}

type cursorUserInfo struct {
	Email          string `json:"email"`
	Name           string `json:"name"`
	MembershipType string `json:"membershipType"`
	Sub            string `json:"sub"`
}

// cursorStateDBPathOverride is set by tests to point at a fixture state.vscdb.
var cursorStateDBPathOverride string

func cursorStateDBPath() string {
	if cursorStateDBPathOverride != "" {
		return cursorStateDBPathOverride
	}
	return filepath.Join(platformdirs.CursorUserDir(), "globalStorage", "state.vscdb")
}

func cursorStateDBValue(key string) (string, error) {
	return cursorStateDBValueAt(cursorStateDBPath(), key)
}

func cursorStateDBValueAt(dbPath, key string) (string, error) {
	if _, err := os.Stat(dbPath); err != nil {
		return "", err
	}
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return "", err
	}
	defer db.Close()

	var value string
	err = db.QueryRow(`SELECT value FROM ItemTable WHERE key = ? LIMIT 1`, key).Scan(&value)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func cursorAccessToken() (string, error) {
	value, err := cursorStateDBValue("cursorAuth/accessToken")
	if err != nil {
		return "", err
	}
	if value == "" {
		return "", fmt.Errorf("cursor access token empty")
	}
	return value, nil
}

func cursorSessionCookie(accessToken string) (string, error) {
	parts := strings.Split(accessToken, ".")
	if len(parts) < 2 {
		return "", fmt.Errorf("invalid cursor token")
	}
	claims := jwtPayload(accessToken)
	userID := claimString(claims, "sub")
	if userID == "" {
		return "", fmt.Errorf("cursor token missing sub")
	}
	return fmt.Sprintf("WorkosCursorSessionToken=%s%%3A%%3A%s", userID, accessToken), nil
}

func cursorLocalMembershipType() string {
	if v, err := cursorStateDBValue("cursorAuth/stripeMembershipType"); err == nil && v != "" {
		return v
	}
	return ""
}

func cursorLocalEmail(token string) string {
	if v, err := cursorStateDBValue("cursorAuth/cachedEmail"); err == nil && v != "" {
		return v
	}
	claims := jwtPayload(token)
	return claimString(claims, "email")
}

func fetchCursorStripeProfile(ctx context.Context, cookie string) *cursorStripeProfile {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://cursor.com/api/auth/stripe", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cookie", cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp == nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var profile cursorStripeProfile
	if json.NewDecoder(resp.Body).Decode(&profile) != nil {
		return nil
	}
	return &profile
}

func cursorMeProfile(ctx context.Context, cookie string) *cursorUserInfo {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://cursor.com/api/auth/me", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cookie", cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp == nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var user cursorUserInfo
	if json.NewDecoder(resp.Body).Decode(&user) != nil {
		return nil
	}
	return &user
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func resolveCursorPlan(ctx context.Context, cookie string, summary *cursorUsageSummary) string {
	local := cursorLocalMembershipType()
	// Prefer live API responses over cursorAuth/stripeMembershipType in state.vscdb.
	// Local cache is often stale after upgrades (e.g. pro → pro_plus).
	if summary != nil && summary.MembershipType != "" {
		return summary.MembershipType
	}
	if profile := fetchCursorStripeProfile(ctx, cookie); profile != nil {
		if plan := firstNonEmpty(
			profile.IndividualMembershipType,
			profile.MembershipType,
			profile.TeamMembershipType,
		); plan != "" {
			return plan
		}
	}
	if user := cursorMeProfile(ctx, cookie); user != nil && user.MembershipType != "" {
		return user.MembershipType
	}
	return local
}

func cursorAccountKey(token string) string {
	claims := jwtPayload(token)
	if sub := strings.TrimSpace(claimString(claims, "sub")); sub != "" {
		return sub
	}
	return strings.ToLower(strings.TrimSpace(cursorLocalEmail(token)))
}

func CursorAccountFromLocal() (*types.ToolAccount, error) {
	token, err := cursorAccessToken()
	if err != nil {
		return nil, err
	}
	email := cursorLocalEmail(token)
	plan := cursorLocalMembershipType()
	return &types.ToolAccount{
		ToolName:    "cursor",
		AccountKey:  cursorAccountKey(token),
		Email:       email,
		Plan:        plan,
		LoginMethod: "local_app",
		AuthPresent: true,
	}, nil
}

// CursorAccountIdentity returns the best available Cursor account including plan tier.
func CursorAccountIdentity(ctx context.Context) (*types.ToolAccount, error) {
	token, err := cursorAccessToken()
	if err != nil {
		return nil, err
	}
	cookie, err := cursorSessionCookie(token)
	if err != nil {
		return &types.ToolAccount{
			ToolName: "cursor", AccountKey: cursorAccountKey(token), Email: cursorLocalEmail(token),
			Plan: cursorLocalMembershipType(), LoginMethod: "local_app", AuthPresent: true,
		}, nil
	}

	email := cursorLocalEmail(token)
	plan := cursorLocalMembershipType()

	summaryReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://cursor.com/api/usage-summary", nil)
	summaryReq.Header.Set("Accept", "application/json")
	summaryReq.Header.Set("Cookie", cookie)
	var summary cursorUsageSummary
	if resp, err := http.DefaultClient.Do(summaryReq); err == nil && resp != nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			_ = json.Unmarshal(body, &summary)
			plan = resolveCursorPlan(ctx, cookie, &summary)
		}
	}
	if plan == "" {
		plan = resolveCursorPlan(ctx, cookie, nil)
	}
	if user := cursorMeProfile(ctx, cookie); user != nil {
		if email == "" {
			email = user.Email
		}
		if plan == "" {
			plan = user.MembershipType
		}
	}

	return &types.ToolAccount{
		ToolName:    "cursor",
		AccountKey:  cursorAccountKey(token),
		Email:       email,
		Plan:        plan,
		LoginMethod: "local_app",
		AuthPresent: true,
	}, nil
}

func ProbeCursorQuota(ctx context.Context) ([]types.QuotaSnapshot, *types.ToolAccount, error) {
	token, err := cursorAccessToken()
	if err != nil {
		return nil, nil, err
	}
	cookie, err := cursorSessionCookie(token)
	if err != nil {
		return nil, nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	summaryReq, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://cursor.com/api/usage-summary", nil)
	if err != nil {
		return nil, nil, err
	}
	summaryReq.Header.Set("Accept", "application/json")
	summaryReq.Header.Set("Cookie", cookie)

	summaryResp, err := client.Do(summaryReq)
	if err != nil {
		return nil, nil, err
	}
	defer summaryResp.Body.Close()
	summaryBody, _ := io.ReadAll(summaryResp.Body)
	if summaryResp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("cursor usage-summary http %d", summaryResp.StatusCode)
	}

	var summary cursorUsageSummary
	if err := json.Unmarshal(summaryBody, &summary); err != nil {
		return nil, nil, err
	}

	account, _ := CursorAccountIdentity(ctx)
	if account == nil {
		account = &types.ToolAccount{ToolName: "cursor", AccountKey: cursorAccountKey(token), LoginMethod: "local_app", AuthPresent: true}
	}
	if account.Plan == "" {
		account.Plan = resolveCursorPlan(ctx, cookie, &summary)
	}

	snapshots := cursorUsageSummarySnapshots(summary, "local_app")
	if grants := fetchCursorActiveGrants(ctx, token); len(grants) > 0 {
		snapshots = append(snapshots, grants...)
	}

	return snapshots, account, nil
}

type cursorActiveGrant struct {
	GrantID          string   `json:"grantId"`
	TotalCents       int64    `json:"totalCents"`
	RemainingCents   int64    `json:"remainingCents"`
	ExpiresAtMs      int64    `json:"expiresAtMs"`
	AllowedModelIDs  []string `json:"allowedModelIds"`
	AllowedModelTags []string `json:"allowedModelTags"`
	GrantType        string   `json:"grantType"`
	Source           string   `json:"source"`
	CampaignName     string   `json:"campaignName"`
	ShowInClient     bool     `json:"showInClient"`
}

type cursorGrantsResponse struct {
	ActiveGrants []cursorActiveGrant `json:"activeGrants"`
}

func fetchCursorActiveGrants(ctx context.Context, accessToken string) []types.QuotaSnapshot {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://api2.cursor.sh/aiserver.v1.DashboardService/GetUsageLimitStatusAndActiveGrants",
		strings.NewReader("{}"),
	)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp == nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil
	}
	var out cursorGrantsResponse
	if json.Unmarshal(body, &out) != nil || len(out.ActiveGrants) == 0 {
		return nil
	}
	return cursorActiveGrantSnapshots(out.ActiveGrants, time.Now())
}

func cursorActiveGrantSnapshots(grants []cursorActiveGrant, now time.Time) []types.QuotaSnapshot {
	var snapshots []types.QuotaSnapshot
	nowMs := now.UnixMilli()
	for _, grant := range grants {
		if grant.ExpiresAtMs > 0 && grant.ExpiresAtMs <= nowMs {
			continue
		}
		windowType := "credit_grant"
		if strings.EqualFold(grant.Source, "promo_campaign") || grant.ShowInClient {
			windowType = "promo_grant"
		}
		var resetAt *string
		if grant.ExpiresAtMs > 0 {
			resetAt = strPtr(time.UnixMilli(grant.ExpiresAtMs).UTC().Format(time.RFC3339))
		}
		snapshots = append(snapshots, types.QuotaSnapshot{
			ToolName:         "cursor",
			WindowType:       windowType,
			CreditsRemaining: floatPtr(float64(grant.RemainingCents) / 100),
			ResetAt:          resetAt,
			Source:           "local_app",
		})
	}
	return snapshots
}

func cursorUsageSummarySnapshots(summary cursorUsageSummary, source string) []types.QuotaSnapshot {
	var snapshots []types.QuotaSnapshot
	resetAt := strPtr(parseUnixOrRFC3339(summary.BillingCycleEnd).UTC().Format(time.RFC3339))
	if summary.IndividualUsage != nil && summary.IndividualUsage.Plan != nil {
		plan := summary.IndividualUsage.Plan
		if plan.TotalPercentUsed > 0 || plan.Limit > 0 {
			used := plan.TotalPercentUsed
			if used == 0 && plan.Limit > 0 {
				used = (float64(plan.Used) / float64(plan.Limit)) * 100
			}
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName: "cursor", WindowType: "plan",
				UsedPercent: floatPtr(used), ResetAt: resetAt, Source: source,
			})
		}
		if plan.Breakdown != nil && plan.Breakdown.Bonus > 0 {
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName: "cursor", WindowType: "bonus",
				CreditsRemaining: floatPtr(float64(plan.Breakdown.Bonus) / 100),
				ResetAt:          resetAt, Source: source,
			})
		}
		if plan.AutoPercentUsed > 0 {
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName: "cursor", WindowType: "auto",
				UsedPercent: floatPtr(plan.AutoPercentUsed), ResetAt: resetAt, Source: source,
			})
		}
		if plan.ApiPercentUsed > 0 {
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName: "cursor", WindowType: "api",
				UsedPercent: floatPtr(plan.ApiPercentUsed), ResetAt: resetAt, Source: source,
			})
		}
	}
	if summary.IndividualUsage != nil && summary.IndividualUsage.OnDemand != nil {
		od := summary.IndividualUsage.OnDemand
		if od.Used > 0 {
			var remaining float64
			if od.Remaining != nil {
				remaining = float64(*od.Remaining) / 100
			}
			snapshots = append(snapshots, types.QuotaSnapshot{
				ToolName: "cursor", WindowType: "on_demand",
				UsedPercent: floatPtr(float64(od.Used) / 100), ResetAt: resetAt,
				CreditsRemaining: floatPtr(remaining), Source: source,
			})
		}
	}
	return snapshots
}

// ScanCursorUsage is deprecated in favor of local + events merge in the provider.
// Kept for backward compatibility: returns plan utilization as a synthetic observation.
func ScanCursorUsage(ctx context.Context) ([]types.DailyUsage, error) {
	quotas, _, err := ProbeCursorQuota(ctx)
	if err != nil {
		return nil, err
	}
	today := time.Now().UTC().Format("2006-01-02")
	var rows []types.DailyUsage
	for _, q := range quotas {
		if q.WindowType != "plan" || q.UsedPercent == nil {
			continue
		}
		credits := int(*q.UsedPercent * 100)
		if credits <= 0 {
			continue
		}
		rows = append(rows, types.DailyUsage{
			Date:          today,
			ToolName:      "cursor",
			Model:         "plan",
			InputTokens:   credits,
			OutputTokens:  0,
			EstimatedCost: 0,
			Source:        "cursor_plan_percent",
		})
	}
	return rows, nil
}

type cursorUsageEventsResponse struct {
	TotalUsageEventsCount int `json:"totalUsageEventsCount"`
	UsageEventsDisplay    []struct {
		Timestamp        string   `json:"timestamp"`
		Model            string   `json:"model"`
		Kind             string   `json:"kind"`
		IsTokenBasedCall bool     `json:"isTokenBasedCall"`
		ChargedCents     *float64 `json:"chargedCents"`
		TokenUsage       *struct {
			InputTokens      int     `json:"inputTokens"`
			OutputTokens     int     `json:"outputTokens"`
			CacheWriteTokens int     `json:"cacheWriteTokens"`
			CacheReadTokens  int     `json:"cacheReadTokens"`
			TotalCents       float64 `json:"totalCents"`
		} `json:"tokenUsage"`
	} `json:"usageEventsDisplay"`
}

type cursorEventsCache struct {
	Version            string             `json:"version"`
	CalculationVersion string             `json:"calculationVersion"`
	PricingVersion     string             `json:"pricingVersion"`
	LastEventTimestamp string             `json:"lastEventTimestamp,omitempty"`
	Rows               []types.DailyUsage `json:"rows"`
}

const cursorEventsSourceKey = "cursor:usage-events"
const cursorEventsSource = "cursor_usage_events"
const cursorEventsCacheVersion = "3"
const cursorEventsCalcVersion = "usage-v2"

func cursorEventsCachePath() string {
	return filepath.Join(config.CacheDir(), "cursor-usage-events.json")
}

func finalizeCursorEventRows(rows []types.DailyUsage) []types.DailyUsage {
	out := make([]types.DailyUsage, 0, len(rows))
	for _, row := range rows {
		cp := row
		finalizeCursorEventCost(&cp)
		out = append(out, cp)
	}
	return out
}

func isPreFixStaleCursorRow(row types.DailyUsage) bool {
	hasTokens := row.InputTokens > 0 || row.OutputTokens > 0 || row.CacheReadTokens > 0 || row.CacheWriteTokens > 0
	if !hasTokens || row.EstimatedCost > 0 {
		return false
	}
	if row.CostKind == types.CostKindEstimatedAPI {
		return false
	}
	return row.CostKind == types.CostKindVerifiedUsage || row.CostKind == ""
}

func needsCursorEventsRebuild(snap scan.ScanSnapshot) bool {
	for _, row := range scan.AggregatesForSource(snap, "cursor", cursorEventsSource) {
		if isPreFixStaleCursorRow(row) {
			return true
		}
	}
	return false
}

func buildCursorEventsCache(lastEventTS string, rows []types.DailyUsage) cursorEventsCache {
	return cursorEventsCache{
		Version:            cursorEventsCacheVersion,
		CalculationVersion: cursorEventsCalcVersion,
		PricingVersion:     scan.PricingVersion,
		LastEventTimestamp: lastEventTS,
		Rows:               rows,
	}
}

// ScanCursorUsageEvents fetches billed usage events using the local Cursor
// session cookie. Incremental mode reuses the scan snapshot when the newest
// event timestamp matches the stored watermark, and otherwise merges only newer
// events into prior aggregates.
func ScanCursorUsageEvents(ctx context.Context, forceFull bool) ([]types.DailyUsage, error) {
	cachePath := cursorEventsCachePath()

	snap, _ := scan.LoadScanSnapshot()
	prevWM := snap.Sources[cursorEventsSourceKey]
	if !forceFull && needsCursorEventsRebuild(snap) {
		forceFull = true
	}
	if !forceFull {
		if cached, err := loadCursorEventsCache(cachePath); err == nil {
			return finalizeCursorEventRows(cached), nil
		}
	}

	token, err := cursorAccessToken()
	if err != nil {
		return nil, err
	}
	cookie, err := cursorSessionCookie(token)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 30 * time.Second}
	buckets := map[string]*types.DailyUsage{}
	page := 1
	pageSize := 200
	var newestEventTS string
	lookbackStart := time.Now().UTC().AddDate(0, 0, -scan.UsageLookbackDays).Format("2006-01-02")
	watermarkTime := parseUnixOrRFC3339(prevWM.Extra)
	// Only merge onto prior aggregates when the watermark is parseable; otherwise
	// a full event recompute avoids double-counting.
	incrementalMerge := !forceFull && !watermarkTime.IsZero()
	if incrementalMerge {
		for _, row := range scan.AggregatesForSource(snap, "cursor", cursorEventsSource) {
			key := row.Date + "|" + row.Model
			cp := row
			buckets[key] = &cp
		}
	}
	reachedPriorWatermark := false

	for {
		body := map[string]any{
			"page":     page,
			"pageSize": pageSize,
		}
		payload, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://cursor.com/api/dashboard/get-filtered-usage-events", strings.NewReader(string(payload)))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Cookie", cookie)
		req.Header.Set("Origin", "https://cursor.com")

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			return nil, fmt.Errorf("cursor usage-events http %d", resp.StatusCode)
		}

		var out cursorUsageEventsResponse
		if err := json.Unmarshal(respBody, &out); err != nil {
			return nil, err
		}
		if len(out.UsageEventsDisplay) == 0 {
			break
		}

		reachedLookbackFloor := false
		for _, ev := range out.UsageEventsDisplay {
			if page == 1 && newestEventTS == "" && ev.Timestamp != "" {
				newestEventTS = ev.Timestamp
			}
			evTime := parseUnixOrRFC3339(ev.Timestamp)
			if incrementalMerge && !evTime.IsZero() && !evTime.After(watermarkTime) {
				reachedPriorWatermark = true
				continue
			}
			date := cursorEventDate(ev.Timestamp)
			if date < lookbackStart {
				reachedLookbackFloor = true
				continue
			}
			model := strings.TrimSpace(ev.Model)
			if model == "" {
				model = "unknown"
			}
			key := date + "|" + model
			if buckets[key] == nil {
				buckets[key] = &types.DailyUsage{
					Date: date, ToolName: "cursor", Model: model,
					Source:         cursorEventsSource,
					MetricKind:     types.MetricKindUsage,
					TokenSemantics: types.TokenSemanticsVendor, CalculationVersion: cursorEventsCalcVersion,
				}
			}
			b := buckets[key]
			b.Requests++
			if ev.TokenUsage != nil {
				b.InputTokens += ev.TokenUsage.InputTokens
				b.OutputTokens += ev.TokenUsage.OutputTokens
				b.CacheReadTokens += ev.TokenUsage.CacheReadTokens
				b.CacheWriteTokens += ev.TokenUsage.CacheWriteTokens
			}
			// chargedCents is authoritative when present, including zero.
			if ev.ChargedCents != nil {
				b.EstimatedCost += *ev.ChargedCents / 100
			}
		}

		if reachedPriorWatermark || reachedLookbackFloor || len(out.UsageEventsDisplay) < pageSize {
			break
		}
		if out.TotalUsageEventsCount > 0 && page*pageSize >= out.TotalUsageEventsCount {
			break
		}
		page++
		if page > 1000 {
			break
		}
	}

	if newestEventTS == "" {
		newestEventTS = prevWM.Extra
	}
	// Warm path: first page newest timestamp matches prior watermark and we
	// already had aggregates — nothing new arrived.
	if !forceFull && prevWM.Extra != "" && newestEventTS == prevWM.Extra && reachedPriorWatermark {
		if rows := scan.AggregatesForSource(snap, "cursor", cursorEventsSource); len(rows) > 0 {
			finalized := finalizeCursorEventRows(rows)
			_ = saveCursorEventsCache(cachePath, buildCursorEventsCache(newestEventTS, finalized))
			snap.Aggregates = scan.ReplaceSourceAggregates(snap.Aggregates, "cursor", cursorEventsSource, finalized)
			if snap.Sources == nil {
				snap.Sources = map[string]scan.SourceWatermark{}
			}
			snap.Sources[cursorEventsSourceKey] = scan.SourceWatermark{
				Path:  cursorEventsSourceKey,
				Extra: newestEventTS,
			}
			_ = scan.SaveScanSnapshot(snap)
			return finalized, nil
		}
	}

	result := make([]types.DailyUsage, 0, len(buckets))
	for _, b := range buckets {
		finalizeCursorEventCost(b)
		result = append(result, *b)
	}
	result = scan.PruneAggregatesLookback(result, time.Now().UTC())
	_ = saveCursorEventsCache(cachePath, buildCursorEventsCache(newestEventTS, result))

	snap.Aggregates = scan.ReplaceSourceAggregates(snap.Aggregates, "cursor", cursorEventsSource, result)
	if snap.Sources == nil {
		snap.Sources = map[string]scan.SourceWatermark{}
	}
	snap.Sources[cursorEventsSourceKey] = scan.SourceWatermark{
		Path:  cursorEventsSourceKey,
		Extra: newestEventTS,
	}
	_ = scan.SaveScanSnapshot(snap)
	return result, nil
}

func finalizeCursorEventCost(b *types.DailyUsage) {
	hasTokens := b.InputTokens > 0 || b.OutputTokens > 0 || b.CacheReadTokens > 0 || b.CacheWriteTokens > 0
	if b.EstimatedCost > 0 {
		b.CostKind = types.CostKindVerifiedUsage
		b.Verified = true
		return
	}
	if !hasTokens {
		return
	}
	b.EstimatedCost = scan.EstimateCostForTool(
		"cursor", b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens,
	)
	if b.EstimatedCost > 0 {
		b.CostKind = types.CostKindEstimatedAPI
		b.Verified = false
	}
}

func cursorEventDate(ts string) string {
	ts = strings.TrimSpace(ts)
	if ts == "" {
		return time.Now().UTC().Format("2006-01-02")
	}
	t := parseUnixOrRFC3339(ts)
	if t.IsZero() {
		return time.Now().UTC().Format("2006-01-02")
	}
	return t.UTC().Format("2006-01-02")
}

func loadCursorEventsCache(path string) ([]types.DailyUsage, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if time.Since(info.ModTime()) > 5*time.Minute {
		return nil, fmt.Errorf("cache stale")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var wrapped cursorEventsCache
	if err := json.Unmarshal(data, &wrapped); err == nil && len(wrapped.Rows) > 0 {
		if wrapped.Version != cursorEventsCacheVersion || wrapped.PricingVersion != scan.PricingVersion {
			return nil, fmt.Errorf("cursor events cache version mismatch")
		}
		return wrapped.Rows, nil
	}
	var out []types.DailyUsage
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func saveCursorEventsCache(path string, cache cursorEventsCache) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(cache)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
