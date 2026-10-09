package cmd

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/configure"
	"github.com/usejunction/agent/internal/localsync"
	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/uninstall"
	"github.com/usejunction/agent/internal/updater"
)

const (
	heartbeatInterval = 15 * time.Minute
	// wakeCheckInterval polls wall clock so a heartbeat fires soon after sleep
	// even when the steady-state ticker was paused by the OS.
	wakeCheckInterval = 1 * time.Minute
	// collectionInterval is the steady-state cadence between scheduled collects.
	// The schedule is self-correcting: the next collect is scheduled relative to
	// the previous one finishing, so it can never silently skip a slot.
	collectionInterval = 30 * time.Minute
	// collectTimeout hard-caps a single collect. If a collect exceeds this it is
	// cancelled, reported, and rescheduled — it can never wedge the daemon.
	collectTimeout = 5 * time.Minute
	// collectRetryBase is the first backoff after a failed/incomplete collect.
	// It doubles on repeated failures, capped at collectionInterval.
	collectRetryBase = 1 * time.Minute
	// featuresAuthorClaimInterval is how often mapped GitHub-author daemons
	// claim a Features-queued remote usage sync when Ably is unavailable.
	featuresAuthorClaimInterval = 2 * time.Minute
)

// errUsageQueuePending means the sync uploaded something but left rows queued.
// Treated as non-fatal for the UI, but the scheduler retries sooner.
var errUsageQueuePending = errors.New("usage upload queue still pending")

// collectStatus holds the outcome of the most recent scheduled collect so the
// independent heartbeat goroutine can forward it to the control plane. It uses
// report-once semantics (via a generation counter) so a single failure alerts
// at most once, but is retried on the next heartbeat if the report itself fails.
type collectStatus struct {
	mu          sync.Mutex
	gen         uint64
	reportedGen uint64
	status      string
	at          time.Time
	durationMs  int64
	errMsg      string
	warnings    []string
}

func (c *collectStatus) set(status string, dur time.Duration, errMsg string, warnings []string) {
	c.mu.Lock()
	c.gen++
	c.status = status
	c.at = time.Now()
	c.durationMs = dur.Milliseconds()
	c.errMsg = errMsg
	c.warnings = append([]string(nil), warnings...)
	c.mu.Unlock()
}

// pending returns the latest unreported collect status (and its generation), or
// nil when there is nothing new to report.
func (c *collectStatus) pending() (*client.CollectStatus, uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.status == "" || c.gen == c.reportedGen {
		return nil, 0
	}
	out := &client.CollectStatus{
		Status:     c.status,
		At:         c.at.UTC().Format(time.RFC3339),
		DurationMs: c.durationMs,
		Error:      c.errMsg,
	}
	if len(c.warnings) > 0 {
		// Cap payload size — a handful of warnings is enough to triage.
		n := len(c.warnings)
		if n > 8 {
			n = 8
		}
		out.Warnings = append([]string(nil), c.warnings[:n]...)
	}
	return out, c.gen
}

func (c *collectStatus) markReported(gen uint64) {
	c.mu.Lock()
	if gen > c.reportedGen {
		c.reportedGen = gen
	}
	c.mu.Unlock()
}

// collectGate serializes overlapping collects (scheduled loop + localsync "Sync
// now"). It never blocks the heartbeat goroutine.
var collectGate sync.Mutex

func withCollectGate(fn func() (int, int, int, int, []string, error)) (int, int, int, int, []string, error) {
	collectGate.Lock()
	defer collectGate.Unlock()
	return fn()
}

var reportCmd = &cobra.Command{
	Use:    "report",
	Short:  "Send one heartbeat + tool/model report to the control plane",
	Hidden: true,
	RunE:   runReport,
}

var daemonCmd = &cobra.Command{
	Use:    "daemon",
	Short:  "Run the reporting loop and localhost sync endpoint",
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := requireConfig()
		if err != nil {
			return err
		}
		maybeCleanupLegacyDarwinBundles()
		if err := configure.RepairLegacyCodexGatewayConfig(); err != nil {
			fmt.Printf("[daemon] codex config repair warning: %v\n", err)
		}
		if changed, err := cfg.EnsureLocalSyncCredentials(); err != nil {
			return err
		} else if changed {
			if err := config.Save(cfg); err != nil {
				return err
			}
		}

		api := client.New(cfg)
		collect := &collectStatus{}
		remoteSyncSignals := make(chan struct{}, 1)
		var featuresAuthorSync atomic.Bool

		// doCollect runs one gated collect+report and returns the real error
		// (including errUsageQueuePending) so callers can classify the outcome.
		doCollect := func(ctx context.Context, refresh bool, progress localsync.ProgressFunc) (int, int, int, int, []string, error) {
			return withCollectGate(func() (int, int, int, int, []string, error) {
				return collectAndReportWithProgress(ctx, api, refresh, progress)
			})
		}

		// localSyncFn adapts doCollect for the "Sync now" UI: queued-but-uploaded
		// rows are surfaced as success (warnings carry the detail).
		localSyncFn := func(ctx context.Context, refresh bool, progress localsync.ProgressFunc) (int, int, int, int, []string, error) {
			tools, accounts, quotas, usage, warnings, err := doCollect(ctx, refresh, progress)
			if errors.Is(err, errUsageQueuePending) {
				return tools, accounts, quotas, usage, warnings, nil
			}
			return tools, accounts, quotas, usage, warnings, err
		}

		go func() {
			srv := localsync.New(cfg, localSyncFn)
			fmt.Printf("Local sync endpoint: %s\n", cfg.LocalSyncURL())
			if err := srv.ListenAndServe(); err != nil {
				fmt.Printf("[daemon] local sync server stopped: %v\n", err)
			}
		}()

		if err := updater.ConsumeHandoffResult(cfg, api, config.Version); err != nil {
			fmt.Printf("[daemon] update handoff: %v\n", err)
		}
		if _, err := updater.ConfirmPending(cfg, api, config.Version); err != nil {
			fmt.Printf("[daemon] update confirmation: %v\n", err)
		}

		// Register endpoint on the control plane immediately and apply an eligible update.
		if response, err := heartbeat(api); err != nil {
			if errors.Is(err, client.ErrUnauthorized) {
				fmt.Println("Device credentials revoked; uninstalling…")
				return uninstall.Run(verbose)
			}
			if verbose {
				fmt.Printf("[daemon] initial heartbeat: %v\n", err)
			}
		} else if response.Uninstall {
			fmt.Println("Control plane requested uninstall; removing agent…")
			return uninstall.Run(verbose)
		} else if updated, updateErr := applyUpdate(cmd.Context(), cfg, api, response.Update); updateErr != nil {
			fmt.Printf("[daemon] automatic update: %v\n", updateErr)
		} else if updated {
			fmt.Printf("Updated UseJunction agent; restarting service…\n")
			// Legacy installs still under ~/.usejunction converge to ~/Applications
			// here, during the bounded update, instead of on every daemon boot.
			if migrateDarwinBundleAfterUpdate() {
				// The relocation already restarted launchd from the visible path.
				return nil
			}
			if restartErr := restartBackgroundAgent(); restartErr != nil {
				// KeepAlive will usually relaunch from the updated path after we exit.
				fmt.Printf("[daemon] update installed; restart warning: %v\n", restartErr)
			}
			return nil
		} else {
			noteFeaturesAuthorSync(response, &featuresAuthorSync)
		}
		signalRemoteSync(remoteSyncSignals)

		fmt.Println("Starting UseJunction daemon (Ctrl-C to stop)…")

		// The collection loop runs independently so a slow or hung collect can
		// never starve heartbeats. Each collect is hard-capped by collectTimeout
		// and the next run is scheduled relative to completion (self-correcting),
		// with backoff on failure — no ticker drift, no silently skipped slots.
		go runCollectLoop(cmd.Context(), doCollect, collect)
		go runRemoteSyncWorker(cmd.Context(), api, doCollect, remoteSyncSignals)
		go runRemoteSyncRealtime(cmd.Context(), api, remoteSyncSignals)
		go runFeaturesAuthorSyncPoll(cmd.Context(), &featuresAuthorSync, remoteSyncSignals)

		// Heartbeats own the main goroutine: they are the lifeline for presence,
		// update directives, and uninstall, so they must always fire on cadence.
		return runHeartbeatLoop(cmd.Context(), cfg, api, collect, remoteSyncSignals, &featuresAuthorSync)
	},
}

// classifyCollect maps a collect outcome to a compact status string and whether
// the scheduler should retry sooner than the steady-state interval.
func classifyCollect(timedOut bool, err error) (status string, retrySoon bool) {
	switch {
	case err == nil:
		return "ok", false
	case errors.Is(err, errUsageQueuePending):
		return "queued", true
	case timedOut || errors.Is(err, context.DeadlineExceeded):
		return "timeout", true
	default:
		return "failed", true
	}
}

// runCollectLoop performs the initial collect and then reschedules itself
// relative to each run finishing. It never blocks heartbeats.
func runCollectLoop(
	ctx context.Context,
	doCollect func(context.Context, bool, localsync.ProgressFunc) (int, int, int, int, []string, error),
	collect *collectStatus,
) {
	backoff := collectRetryBase

	runOnce := func() (retrySoon bool) {
		if ctx.Err() != nil {
			return false
		}
		cctx, cancel := context.WithTimeout(ctx, collectTimeout)
		defer cancel()
		startedAt := time.Now()
		// Incremental by default; the daily heartbeat seal forces a full rescan.
		_, _, _, _, warnings, err := doCollect(cctx, false, nil)
		dur := time.Since(startedAt)

		// A parent-context cancellation means the daemon is shutting down; don't
		// record it as a collect failure.
		if ctx.Err() != nil {
			return false
		}
		timedOut := cctx.Err() == context.DeadlineExceeded
		status, retrySoon := classifyCollect(timedOut, err)
		errMsg := ""
		if err != nil && status != "queued" {
			errMsg = err.Error()
		}
		collect.set(status, dur, errMsg, warnings)
		if (status == "failed" || status == "timeout") && verbose {
			fmt.Printf("[daemon] collect %s after %s: %v\n", status, dur.Round(time.Second), err)
		}
		return retrySoon
	}

	// Initial collect on startup, then schedule the next relative to completion.
	next := collectionInterval
	cfg, _ := config.Load()
	if cfg != nil && shouldSkipInitialDaemonCollect(cfg) {
		if verbose {
			fmt.Println("[daemon] skipping initial collect — onboard just finished")
		}
		backoff = collectRetryBase
	} else if runOnce() {
		next = backoff
		backoff = min(backoff*2, collectionInterval)
	} else {
		backoff = collectRetryBase
	}

	timer := time.NewTimer(next)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if runOnce() {
				timer.Reset(backoff)
				backoff = min(backoff*2, collectionInterval)
			} else {
				backoff = collectRetryBase
				timer.Reset(collectionInterval)
			}
		}
	}
}

// runHeartbeatLoop registers presence on cadence and applies update/uninstall
// directives. It forwards the latest collect status to the control plane so the
// server can alert on failures without a separate endpoint.
func runHeartbeatLoop(ctx context.Context, cfg *config.Config, api *client.APIClient, collect *collectStatus, remoteSyncSignals chan<- struct{}, featuresAuthorSync *atomic.Bool) error {
	heartbeatTicker := time.NewTicker(heartbeatInterval)
	wakeCheckTicker := time.NewTicker(wakeCheckInterval)
	defer heartbeatTicker.Stop()
	defer wakeCheckTicker.Stop()

	// Startup already sent one heartbeat before entering this loop.
	lastSuccess := time.Now()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-heartbeatTicker.C:
		case <-wakeCheckTicker.C:
			if time.Since(lastSuccess) < heartbeatInterval {
				continue
			}
		}

		shouldExit, err := runHeartbeatCycle(ctx, cfg, api, collect, remoteSyncSignals, featuresAuthorSync)
		if err != nil {
			return err
		}
		if shouldExit {
			return nil
		}
		lastSuccess = time.Now()
	}
}

func runHeartbeatCycle(
	ctx context.Context,
	cfg *config.Config,
	api *client.APIClient,
	collect *collectStatus,
	remoteSyncSignals chan<- struct{},
	featuresAuthorSync *atomic.Bool,
) (shouldExit bool, err error) {
	pending, gen := collect.pending()
	response, err := heartbeatWithCollect(api, pending)
	if errors.Is(err, client.ErrUnauthorized) {
		fmt.Println("Device credentials revoked; uninstalling…")
		return false, uninstall.Run(verbose)
	}
	if err != nil {
		fmt.Printf("[daemon] heartbeat error: %v\n", err)
		return false, nil
	}
	if pending != nil {
		collect.markReported(gen)
	}
	noteFeaturesAuthorSync(response, featuresAuthorSync)
	signalRemoteSync(remoteSyncSignals)
	if response.Uninstall {
		fmt.Println("Control plane requested uninstall; removing agent…")
		return false, uninstall.Run(verbose)
	}
	if handoffErr := updater.ConsumeHandoffResult(cfg, api, config.Version); handoffErr != nil {
		fmt.Printf("[daemon] update handoff: %v\n", handoffErr)
	}
	if _, confirmErr := updater.ConfirmPending(cfg, api, config.Version); confirmErr != nil {
		fmt.Printf("[daemon] update confirmation: %v\n", confirmErr)
	}
	updated, updateErr := applyUpdate(ctx, cfg, api, response.Update)
	if updateErr != nil {
		fmt.Printf("[daemon] automatic update: %v\n", updateErr)
	}
	if updated {
		fmt.Printf("Updated UseJunction agent; restarting service…\n")
		if restartErr := restartBackgroundAgent(); restartErr != nil {
			fmt.Printf("[daemon] update installed; restart warning: %v\n", restartErr)
		}
		return true, nil
	}
	return false, nil
}

func runReport(cmd *cobra.Command, args []string) error {
	cfg, err := requireConfig()
	if err != nil {
		return err
	}
	if changed, err := cfg.EnsureLocalSyncCredentials(); err != nil {
		return err
	} else if changed {
		_ = config.Save(cfg)
	}
	tools, accounts, quotas, usage, err := collectAndReport(client.New(cfg), true)
	if err != nil {
		return err
	}
	if format == "json" {
		printJSON(map[string]any{
			"ok":       true,
			"tools":    tools,
			"accounts": accounts,
			"quotas":   quotas,
			"usage":    usage,
		})
	} else {
		fmt.Printf("Reported %d tool(s), %d account(s), %d quota window(s), %d usage row(s).\n", tools, accounts, quotas, usage)
	}
	return nil
}

func runHeartbeat() error {
	cfg, err := requireConfig()
	if err != nil {
		return err
	}
	return sendHeartbeat(client.New(cfg))
}

func sendHeartbeat(api *client.APIClient) error {
	_, err := heartbeat(api)
	return err
}

func heartbeat(api *client.APIClient) (*client.HeartbeatResponse, error) {
	return heartbeatWithCollect(api, nil)
}

func heartbeatWithCollect(api *client.APIClient, collect *client.CollectStatus) (*client.HeartbeatResponse, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	if changed, err := cfg.EnsureLocalSyncCredentials(); err != nil {
		return nil, err
	} else if changed {
		_ = config.Save(cfg)
	}
	osName, arch := platformInfo()
	return api.Heartbeat(client.HeartbeatPayload{
		Hostname:           hostname(),
		OS:                 osName,
		Architecture:       arch,
		AgentVersion:       config.Version,
		LocalEndpoint:      cfg.LocalSyncURL(),
		LocalSyncToken:     cfg.LocalSyncToken,
		RemoteSyncProtocol: config.RemoteSyncProtocol,
		TimeZone:           platformdirs.LocalIANATimeZone(),
		AppLocation:        agentAppLocation(),
		LastCollect:        collect,
	})
}

func heartbeatRequestsRemoteSync(resp *client.HeartbeatResponse) bool {
	return resp != nil && (resp.PendingRemoteSync || resp.FeaturesAuthorSync)
}

func noteFeaturesAuthorSync(resp *client.HeartbeatResponse, flag *atomic.Bool) {
	if flag == nil {
		return
	}
	flag.Store(heartbeatRequestsRemoteSync(resp))
}

func runFeaturesAuthorSyncPoll(ctx context.Context, flag *atomic.Bool, signals chan<- struct{}) {
	ticker := time.NewTicker(featuresAuthorClaimInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if flag != nil && flag.Load() {
				signalRemoteSync(signals)
			}
		}
	}
}

func applyUpdate(ctx context.Context, cfg *config.Config, api *client.APIClient, directive *client.AgentUpdateDirective) (bool, error) {
	if directive == nil {
		return false, nil
	}
	updated, err := updater.Apply(ctx, cfg, updater.ApplyOptions{
		Directive: *directive, CurrentVersion: config.Version,
		ControlPlaneURL: cfg.ControlPlaneURL, Reporter: api,
	})
	if errors.Is(err, updater.ErrBlockedVersion) || errors.Is(err, updater.ErrLocalDevPinned) {
		return false, nil
	}
	return updated, err
}

func init() {
	rootCmd.AddCommand(reportCmd)
	rootCmd.AddCommand(daemonCmd)
}
