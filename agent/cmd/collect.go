package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/usejunction/agent/internal/accountpolicy"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/probe"
	"github.com/usejunction/agent/internal/providers"
	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/syncengine"
	"github.com/usejunction/agent/internal/types"
)

const (
	providerCollectTimeout = 45 * time.Second
	// providerCollectConcurrency caps how many providers scan at once.
	providerCollectConcurrency = 6
)

type collectProgress = func(step, message string)

type providerCollectResult struct {
	toolReports    []client.ToolReport
	accountReports []client.AccountReport
	modelReports   []client.LocalModelReport
	usageReports   []client.UsageAggregate
	quotaReports   []client.QuotaReport
}

func mergeToolAccounts(base, richer *types.ToolAccount) *types.ToolAccount {
	if base == nil && richer == nil {
		return nil
	}
	if base == nil {
		return richer
	}
	if richer == nil {
		return base
	}
	out := *base
	if strings.TrimSpace(out.AccountKey) == "" {
		out.AccountKey = richer.AccountKey
	}
	if strings.TrimSpace(out.Email) == "" {
		out.Email = richer.Email
	}
	if strings.TrimSpace(out.Plan) == "" {
		out.Plan = richer.Plan
	}
	if richer.AuthPresent {
		out.AuthPresent = true
	}
	return &out
}

func codexHomeForProbe() string {
	if h := os.Getenv("CODEX_HOME"); h != "" {
		return h
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".codex")
}

func claudeConfigDirForProbe() string {
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	candidate := filepath.Join(home, ".claude")
	if st, err := os.Stat(candidate); err == nil && st.IsDir() {
		return candidate
	}
	return filepath.Join(home, ".config", "claude")
}

// collectAndReport gathers telemetry from all providers and posts to the control plane.
// When refresh is false, providers use incremental scan snapshots unless the
// control plane sealed a newer fullUsageRescanDay.
func collectAndReport(api *client.APIClient, refresh bool) (tools int, accounts int, quotas int, usage int, err error) {
	tools, accounts, quotas, usage, _, _, err = collectAndReportWithTools(context.Background(), api, refresh, func(string, string) {})
	return tools, accounts, quotas, usage, err
}

func collectAndReportWithProgress(
	ctx context.Context,
	api *client.APIClient,
	refresh bool,
	progress collectProgress,
) (tools int, accounts int, quotas int, usage int, warnings []string, err error) {
	tools, accounts, quotas, usage, _, warnings, err = collectAndReportWithTools(ctx, api, refresh, progress)
	return tools, accounts, quotas, usage, warnings, err
}

func collectAndReportWithTools(
	ctx context.Context,
	api *client.APIClient,
	refresh bool,
	progress collectProgress,
) (tools int, accounts int, quotas int, usage int, toolList []types.ToolStatus, warnings []string, err error) {
	if progress == nil {
		progress = func(string, string) {}
	}

	progress("heartbeat", "Connecting to UseJunction")
	hb, err := heartbeat(api)
	if err != nil {
		return 0, 0, 0, 0, nil, warnings, fmt.Errorf("heartbeat: %w", err)
	}

	forceFull := refresh
	sealedDay := strings.TrimSpace(hb.FullUsageRescanDay)
	cfg, cfgErr := config.Load()
	lastFullDay := ""
	if cfgErr == nil && cfg != nil {
		lastFullDay = strings.TrimSpace(cfg.LastFullUsageRescanDay)
	}
	if shouldForceFullUsageRescan(refresh, sealedDay, lastFullDay) {
		forceFull = true
		if !refresh && sealedDay != "" {
			progress("scan", fmt.Sprintf("Full usage rescan for sealed day %s", sealedDay))
		}
	}

	accountPolicy, policyErr := api.AccountPolicy()
	if policyErr != nil && verbose {
		fmt.Printf("[collect] account policy: %v\n", policyErr)
	}
	linkClaudeLogins(accountPolicy)

	var toolReports []client.ToolReport
	var accountReports []client.AccountReport
	var modelReports []client.LocalModelReport
	var usageReports []client.UsageAggregate
	var quotaReports []client.QuotaReport

	allProviders := providers.All()
	progress("scan", fmt.Sprintf("Scanning %d tools in parallel", len(allProviders)))

	type providerOutcome struct {
		id       string
		result   providerCollectResult
		timedOut bool
	}
	outcomes := make([]providerOutcome, len(allProviders))
	sem := make(chan struct{}, providerCollectConcurrency)
	var wg sync.WaitGroup
	for i, p := range allProviders {
		wg.Add(1)
		go func(idx int, prov providers.Provider) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			id := prov.ID()
			if ctx.Err() != nil {
				outcomes[idx] = providerOutcome{id: id, timedOut: true}
				progress("scan-tool-skip", id)
				return
			}
			progress("scan-tool-start", id)
			result, timedOut := collectProviderWithTimeout(ctx, prov, forceFull, accountPolicy)
			outcomes[idx] = providerOutcome{id: id, result: result, timedOut: timedOut}
			if timedOut {
				progress("scan-tool-skip", id)
				return
			}
			if len(result.toolReports) == 0 {
				// Checked, not installed: never shown as found.
				progress("scan-tool-absent", id)
				return
			}
			progress("scan-tool-done", id)
		}(i, p)
	}
	wg.Wait()

	for _, out := range outcomes {
		if out.timedOut {
			warnings = append(warnings, fmt.Sprintf("%s scan timed out", out.id))
			continue
		}
		toolReports = append(toolReports, out.result.toolReports...)
		accountReports = append(accountReports, out.result.accountReports...)
		modelReports = append(modelReports, out.result.modelReports...)
		usageReports = append(usageReports, out.result.usageReports...)
		quotaReports = append(quotaReports, out.result.quotaReports...)
	}

	progress("upload-tools", fmt.Sprintf("Preparing %d tool / %d account / %d quota reports for sync", len(toolReports), len(accountReports), len(quotaReports)))
	if len(modelReports) > 0 {
		progress("upload-models", fmt.Sprintf("Uploading %d local model reports", len(modelReports)))
		if err := api.ReportLocalModels(modelReports); err != nil && verbose {
			fmt.Printf("[report] models: %v\n", err)
		}
	}
	usageIncomplete := false
	var uploadErr error
	uploaded := 0
	// Tools/accounts/quotas ride as sidecars on usage sync start. If there is no
	// usage or detected inventory, still open a sync session. Empty authoritative
	// sidecars are the server-visible checkpoint that the first scan completed.
	{
		daily := make([]types.DailyUsage, 0, len(usageReports))
		for _, row := range usageReports {
			daily = append(daily, aggregateToUsage(row))
		}
		progress("upload-usage", fmt.Sprintf("Syncing usage (%d scanned rows, last %d days) + inventory", len(daily), scan.UsageLookbackDays))
		// Drain until remaining==0 so first-sync dashboards are correct in one collect.
		// Each iteration re-starts; fingerprints from prior chunks shrink the delta.
		// Inventory sidecars are sent on the first pass; server no-ops on hash match.
		const maxUsageSyncIterations = 32
		remaining := 0
		maxChunks := scan.UsageUploadMaxBatchesPerSync
		if forceFull {
			maxChunks = scan.UsageUploadMaxBatchesPerSyncFirst
		}
		for iter := 0; iter < maxUsageSyncIterations; iter++ {
			if err := ctx.Err(); err != nil {
				uploadErr = err
				break
			}
			var inventory *syncengine.InventorySidecars
			if iter == 0 {
				toolsForPass := toolReports
				if toolsForPass == nil {
					toolsForPass = []client.ToolReport{}
				}
				accountsForPass := accountReports
				if accountsForPass == nil {
					accountsForPass = []client.AccountReport{}
				}
				quotasForPass := quotaReports
				if quotasForPass == nil {
					quotasForPass = []client.QuotaReport{}
				}
				inventory = &syncengine.InventorySidecars{
					Tools:    toolsForPass,
					Accounts: accountsForPass,
					Quotas:   quotasForPass,
				}
			}
			n, rem, syncWarnings, err := syncengine.UploadUsageSession(ctx, api, daily, inventory, syncengine.UploadOptions{
				MaxChunks: maxChunks,
				Progress: func(done, total int) {
					progress("upload-usage", fmt.Sprintf("Uploaded %d of %d usage rows this pass", done, total))
				},
			})
			warnings = append(warnings, syncWarnings...)
			uploaded += n
			remaining = rem
			uploadErr = err
			if uploadErr != nil {
				progress("upload-usage", fmt.Sprintf("Usage sync failed: %v", uploadErr))
				break
			}
			if remaining == 0 {
				break
			}
			progress("upload-usage", fmt.Sprintf("Uploaded %d usage rows so far; continuing (%d remaining)", uploaded, remaining))
		}
		if remaining > 0 && uploadErr == nil {
			warnings = append(warnings, fmt.Sprintf("%d usage rows still queued after %d sync passes", remaining, maxUsageSyncIterations))
		}
		switch {
		case uploaded == 0 && remaining == 0 && uploadErr == nil:
			progress("upload-usage", "No usage changes since last upload")
		case remaining > 0:
			progress("upload-usage", fmt.Sprintf("Uploaded %d usage rows; %d older rows queued for next sync", uploaded, remaining))
			warnings = append(warnings, fmt.Sprintf("%d usage rows still queued for upload", remaining))
		case uploadErr != nil:
			progress("upload-usage", fmt.Sprintf("Uploaded %d usage rows before error", uploaded))
		default:
			progress("upload-usage", fmt.Sprintf("Uploaded %d usage rows", uploaded))
		}
		if uploadErr != nil {
			warnings = append(warnings, fmt.Sprintf("usage upload interrupted: %v", uploadErr))
			if verbose {
				fmt.Printf("[report] usage upload: %v\n", uploadErr)
			}
		}
		if remaining > 0 || uploadErr != nil {
			usageIncomplete = true
		}
	}

	if !usageIncomplete && forceFull && sealedDay != "" && sealedDay > lastFullDay && cfgErr == nil && cfg != nil {
		cfg.LastFullUsageRescanDay = sealedDay
		if saveErr := config.Save(cfg); saveErr != nil {
			warnings = append(warnings, fmt.Sprintf("persist lastFullUsageRescanDay: %v", saveErr))
		}
	}

	toolList = make([]types.ToolStatus, 0, len(toolReports))
	for _, tr := range toolReports {
		toolList = append(toolList, types.ToolStatus{
			ToolName:   tr.ToolName,
			Detected:   tr.Detected,
			Configured: tr.Configured,
			ConfigPath: tr.ConfigPath,
			Version:    tr.Version,
		})
	}

	if uploadErr != nil && uploaded == 0 {
		progress("complete", "Sync failed")
		return len(toolReports), len(accountReports), len(quotaReports), len(usageReports), toolList, warnings, fmt.Errorf("usage: %w", uploadErr)
	}
	if cfgErr == nil {
		markCollectCompleted(cfg)
	}
	if usageIncomplete {
		progress("complete", "Sync complete with usage still queued")
		return len(toolReports), len(accountReports), len(quotaReports), len(usageReports), toolList, warnings, errUsageQueuePending
	}
	progress("complete", "Sync complete")
	return len(toolReports), len(accountReports), len(quotaReports), len(usageReports), toolList, warnings, nil
}

func markCollectCompleted(cfg *config.Config) {
	if cfg == nil {
		return
	}
	cfg.LastCollectCompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := config.Save(cfg); err != nil && verbose {
		fmt.Printf("[report] persist lastCollectCompletedAt: %v\n", err)
	}
}

func shouldSkipInitialDaemonCollect(cfg *config.Config) bool {
	if cfg == nil || strings.TrimSpace(cfg.LastCollectCompletedAt) == "" {
		return false
	}
	completedAt, err := time.Parse(time.RFC3339Nano, cfg.LastCollectCompletedAt)
	if err != nil {
		return false
	}
	return time.Since(completedAt) < 10*time.Minute
}

func collectProviderWithTimeout(ctx context.Context, p providers.Provider, refresh bool, policy *accountpolicy.Policy) (providerCollectResult, bool) {
	providerCtx, cancel := context.WithTimeout(ctx, providerCollectTimeout)
	defer cancel()
	ch := make(chan providerCollectResult, 1)
	go func() {
		ch <- collectProvider(providerCtx, p, refresh, policy)
	}()
	select {
	case result := <-ch:
		return result, false
	case <-providerCtx.Done():
		return providerCollectResult{}, true
	}
}

func collectProvider(ctx context.Context, p providers.Provider, refresh bool, policy *accountpolicy.Policy) providerCollectResult {
	var result providerCollectResult
	status, _ := p.Detect(ctx)
	if status == nil || !status.Detected {
		return result
	}

	result.toolReports = append(result.toolReports, client.ToolReport{
		ToolName:   status.ToolName,
		Detected:   true,
		Configured: status.Configured,
		ConfigPath: status.ConfigPath,
		Version:    status.Version,
	})

	acc, _ := p.AccountIdentity(ctx)
	signedIn := accountpolicy.NormalizeKey(accountKeyOf(acc), emailOf(acc))
	scan.SetSignedInAccount(p.ID(), signedIn)
	if p.ID() == "codex" {
		scan.SetSignedInAccount("codex-work", signedIn)
	}

	if daily, scanErr := p.ScanLocalUsage(ctx, refresh); scanErr == nil {
		for _, row := range daily {
			if strings.TrimSpace(row.AccountKey) == "" && guessSignedInAccount(row) {
				row.AccountKey = signedIn
			}
			if !accountpolicy.UsageAllowed(policy, row.ToolName, row.AccountKey, "") {
				continue
			}
			result.usageReports = append(result.usageReports, usageToAggregate(row))
		}
	}

	allowUsage := accountpolicy.UsageAllowed(policy, p.ID(), signedIn, emailOf(acc))

	var quotaSnaps []types.QuotaSnapshot
	if allowUsage {
		switch p.ID() {
		case "cursor":
			snaps, probeAcc, err := probe.ProbeCursorQuota(ctx)
			if err == nil {
				quotaSnaps = snaps
				acc = mergeToolAccounts(acc, probeAcc)
			}
			logQuotaProbe(p.ID(), err)
		case "codex":
			snaps, probeAcc, err := probe.ProbeCodexQuota(ctx, codexHomeForProbe())
			if err == nil {
				quotaSnaps = snaps
				acc = mergeToolAccounts(acc, probeAcc)
			}
			logQuotaProbe(p.ID(), err)
		case "claude":
			snaps, probeAcc, err := probe.ProbeClaudeQuota(ctx, claudeConfigDirForProbe())
			acc = mergeToolAccounts(acc, probeAcc)
			if err == nil {
				quotaSnaps = snaps
			}
			logQuotaProbe(p.ID(), err)
		default:
			snaps, err := p.ProbeQuota(ctx)
			quotaSnaps = snaps
			logQuotaProbe(p.ID(), err)
		}
	} else if acc != nil && verbose {
		fmt.Printf("[collect] %s: skipping quota until this account is turned on\n", p.ID())
	}

	plan := ""
	if acc != nil {
		plan = strings.TrimSpace(acc.Plan)
	}
	if acc != nil && (acc.AuthPresent || plan != "") {
		toolName := strings.TrimSpace(acc.ToolName)
		if toolName == "" {
			toolName = status.ToolName
		}
		result.accountReports = append(result.accountReports, client.AccountReport{
			ToolName:    toolName,
			AccountKey:  acc.AccountKey,
			Email:       acc.Email,
			Plan:        plan,
			LoginMethod: acc.LoginMethod,
			AuthPresent: acc.AuthPresent || plan != "",
		})
		if plan == "" && len(quotaSnaps) > 0 && verbose {
			fmt.Printf("[collect] %s: auth/quota present but plan empty — seat sync will use catalog default when available\n", toolName)
		}
	}
	result.accountReports = append(result.accountReports, otherAccountReports(ctx, p)...)

	for _, snap := range quotaSnaps {
		result.quotaReports = append(result.quotaReports, client.QuotaReport{
			ToolName:         snap.ToolName,
			AccountKey:       signedIn,
			WindowType:       snap.WindowType,
			UsedPercent:      snap.UsedPercent,
			ResetAt:          snap.ResetAt,
			CreditsRemaining: snap.CreditsRemaining,
			Source:           snap.Source,
		})
	}

	if o, ok := p.(*providers.OllamaProvider); ok {
		if ms, localErr := o.LocalModels(ctx); localErr == nil {
			for _, m := range ms {
				result.modelReports = append(result.modelReports, client.LocalModelReport{
					Provider:  m.Provider,
					ModelName: m.ModelName,
					Size:      m.Size,
					Running:   m.Running,
				})
			}
		}
	}
	if l, ok := p.(*providers.LMStudioProvider); ok {
		if ms, localErr := l.LocalModels(ctx); localErr == nil {
			for _, m := range ms {
				result.modelReports = append(result.modelReports, client.LocalModelReport{
					Provider:  m.Provider,
					ModelName: m.ModelName,
					Running:   m.Running,
				})
			}
		}
	}
	return result
}

func shouldForceFullUsageRescan(refresh bool, sealedDay, lastFullDay string) bool {
	if refresh {
		return true
	}
	sealedDay = strings.TrimSpace(sealedDay)
	lastFullDay = strings.TrimSpace(lastFullDay)
	return sealedDay != "" && sealedDay > lastFullDay
}

// logQuotaProbe records why a tool reported no plan windows, so "no quota" is
// never silent in the agent log (e.g. "claude credentials not found").
func logQuotaProbe(toolID string, err error) {
	if err != nil && verbose {
		fmt.Printf("[collect] %s: no quota windows: %v\n", toolID, err)
	}
}

func accountKeyOf(acc *types.ToolAccount) string {
	if acc == nil {
		return ""
	}
	return acc.AccountKey
}

func emailOf(acc *types.ToolAccount) string {
	if acc == nil {
		return ""
	}
	return acc.Email
}

func guessSignedInAccount(row types.DailyUsage) bool {
	switch strings.TrimSpace(row.Source) {
	case "cursor_local", "opencode_local", "opencode_usage", "antigravity_local", "antigravity_usage", "copilot_traces":
		return false
	default:
		return true
	}
}

// otherAccountReports lists the provider's non-active logins on this device so
// each gets its own collection switch.
func otherAccountReports(ctx context.Context, p providers.Provider) []client.AccountReport {
	multi, ok := p.(providers.MultiAccountProvider)
	if !ok {
		return nil
	}
	var reports []client.AccountReport
	for _, other := range multi.OtherAccounts(ctx) {
		// A login with no email is not a signed-in account yet. Claude desktop
		// sessions can exist before we learn the address; ask once it is known.
		if strings.TrimSpace(other.Email) == "" {
			continue
		}
		toolName := strings.TrimSpace(other.ToolName)
		if toolName == "" {
			toolName = p.ID()
		}
		reports = append(reports, client.AccountReport{
			ToolName:    toolName,
			AccountKey:  other.AccountKey,
			Email:       other.Email,
			Plan:        strings.TrimSpace(other.Plan),
			LoginMethod: other.LoginMethod,
			AuthPresent: other.AuthPresent,
		})
	}
	return reports
}
