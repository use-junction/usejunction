package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/configure"
	"github.com/usejunction/agent/internal/providers"
	"github.com/usejunction/agent/internal/types"
	"github.com/usejunction/agent/internal/ui"
)

var (
	onboardToken        string
	onboardURL          string
	onboardEmail        string
	onboardName         string
	onboardComplete     bool
	onboardAcceptNotice bool
	onboardAccounts     string
)

var onboardCmd = &cobra.Command{
	Use:   "onboard",
	Short: "Animated first-run enroll, tool scan, and success panel",
	Long: `Runs the branded first-run experience:
  1. Enroll this device
  2. Choose which signed-in accounts to collect from, provider by provider
  3. Upload initial usage and scan for AI coding tools
  4. Turn on Claude Code metrics export, if Claude Code is installed
  5. Show a status card

After the installer starts the background agent, call again with --complete
to print the success panel (admin URL + PATH tips).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ui.SetNoColor(noColor || format == "json")

		if onboardComplete {
			return runOnboardComplete()
		}
		return runOnboard()
	},
}

func runOnboardComplete() error {
	cfg, err := config.Load()
	adminURL := "http://localhost:3001"
	if err == nil && cfg.ControlPlaneURL != "" {
		adminURL = cfg.ControlPlaneURL
	} else if u := os.Getenv("USEJUNCTION_URL"); u != "" {
		adminURL = u
	}
	cliPath, _ := os.Executable()
	if cliPath == "" {
		id := config.CurrentServiceIdentity()
		cliPath = id.CLISymlinkPath(config.ConfigDir())
	}
	if format == "json" {
		printJSON(map[string]any{
			"ok":       true,
			"adminUrl": adminURL,
			"cliPath":  cliPath,
		})
		return nil
	}
	ui.SuccessBox(adminURL, cliPath)
	return nil
}

func runOnboard() error {
	if onboardToken == "" {
		return fmt.Errorf("--token is required")
	}

	if format == "json" {
		res, err := doEnroll(enrollOptions{
			Token:         onboardToken,
			URL:           onboardURL,
			Email:         onboardEmail,
			Name:          onboardName,
			Setup:         true,
			Quiet:         true,
			NoReportPrint: true,
		})
		if err != nil {
			return err
		}
		selection, err := runAccountSelection(context.Background(), client.New(res.cfg), onboardAccounts)
		if err != nil {
			return err
		}
		tools := detectTools()
		printJSON(map[string]any{
			"deviceId":      res.cfg.DeviceID,
			"orgId":         res.cfg.OrgID,
			"agentVersion":  config.Version,
			"toolsDetected": len(tools),
			"tools":         tools,
			"accounts":      selection,
		})
		return nil
	}

	ui.Banner()

	enrollStep := ui.StepStart("Enrolling device")
	res, err := doEnroll(enrollOptions{
		Token:         onboardToken,
		URL:           onboardURL,
		Email:         onboardEmail,
		Name:          onboardName,
		Setup:         false,
		Quiet:         true,
		NoReportPrint: true,
		AcceptNotice:  onboardAcceptNotice,
	})
	if err != nil {
		enrollStep.Fail(err.Error())
		return err
	}
	enrollStep.Done(deviceLabel(res.cfg.DeviceID))
	ui.QuietLine("Settings  " + homeRelative(config.ConfigPath()))

	// Written quietly so Claude Code metrics work even if it is installed later;
	// only mentioned once we know Claude Code is on this machine.
	setupErr := configure.RunSetup(res.cfg, configure.SetupOptions{EnableOtel: true})

	chooseOnboardAccounts(client.New(res.cfg))

	toolIDs := providerToolIDs()
	reportPanel := ui.ScanPanelStart("Uploading initial usage", toolIDs)
	stats, reportErr := runInitialReportWithProgress(true, func(step, message string) {
		switch step {
		case "scan-tool-start":
			reportPanel.ToolStart(message)
		case "scan-tool-done":
			reportPanel.ToolFinish(message, false)
		case "scan-tool-skip":
			reportPanel.ToolFinish(message, true)
		case "scan-tool-absent":
			reportPanel.ToolAbsent(message)
		default:
			if label := humanizeCollectProgress(step, message); label != "" {
				reportPanel.Update(label)
			}
		}
	})

	tools := []types.ToolStatus{}
	if stats != nil {
		tools = stats.ToolList
	}
	if reportErr != nil {
		if errors.Is(reportErr, errUsageQueuePending) && stats != nil {
			reportPanel.Done(fmt.Sprintf("%d tools · %d accounts · %d quotas · %d usage rows (more queued)",
				stats.Tools, stats.Accounts, stats.Quotas, stats.Usage))
			ui.WarnLine(fmt.Sprintf("initial report warning: %v", reportErr))
		} else {
			reportPanel.Fail(reportErr.Error())
			ui.WarnLine(fmt.Sprintf("initial report warning: %v", reportErr))
		}
	} else if stats != nil {
		reportPanel.Done(fmt.Sprintf("%d tools · %d accounts · %d quotas · %d usage rows",
			stats.Tools, stats.Accounts, stats.Quotas, stats.Usage))
	} else {
		reportPanel.Done("")
	}

	scanStep := ui.StepStart("Scanning AI coding tools")
	if len(tools) == 0 {
		tools = detectTools()
	}
	scanStep.Done(fmt.Sprintf("%d found", len(tools)))
	for _, t := range tools {
		ui.ToolReveal(t.ToolName, t.Configured)
	}
	reportClaudeMetrics(tools, setupErr)

	if reportErr != nil && !errors.Is(reportErr, errUsageQueuePending) {
		return fmt.Errorf("initial sync incomplete: %w", reportErr)
	}
	return nil
}

// deviceLabel names the device by hostname, with a short device id for support.
func deviceLabel(deviceID string) string {
	short := deviceID
	if len(short) > 8 {
		short = short[:8]
	}
	host, _ := os.Hostname()
	host = strings.TrimSuffix(host, ".local")
	if host == "" {
		return "device " + short
	}
	return fmt.Sprintf("%s · %s", host, short)
}

// homeRelative shortens a path under the home directory to ~/…
func homeRelative(path string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" || !strings.HasPrefix(path, home) {
		return path
	}
	return "~" + strings.TrimPrefix(path, home)
}

// reportClaudeMetrics mentions the Claude Code metrics export only when Claude
// Code was found, so the step never appears before we know anything about it.
func reportClaudeMetrics(tools []types.ToolStatus, setupErr error) {
	found := false
	for _, tool := range tools {
		if tool.ToolName == "claude" {
			found = true
			break
		}
	}
	if !found {
		return
	}
	step := ui.StepStart("Claude Code metrics")
	if setupErr != nil {
		step.Fail(setupErr.Error())
		ui.WarnLine("Claude Code usage will not export until this is fixed: usejunction setup")
		return
	}
	step.Done("usage export on")
	ui.QuietLine("Claude Code sends usage through ~/.usejunction/claude-env.sh")
}

// chooseOnboardAccounts lets the developer pick accounts before the first
// report reads any usage. Failures leave collection off and are not fatal.
func chooseOnboardAccounts(api *client.APIClient) {
	findStep := ui.StepStart("Finding signed-in accounts")
	accounts, err := loadSelectableAccounts(context.Background(), api)
	if err != nil {
		findStep.Fail(err.Error())
		ui.WarnLine("collection stays off until you choose accounts: usejunction accounts select")
		return
	}
	providerNames := map[string]bool{}
	for _, account := range accounts {
		providerNames[providerDisplayName(account)] = true
	}
	findStep.Done(fmt.Sprintf("%d across %d %s", len(accounts), len(providerNames), map[bool]string{true: "provider", false: "providers"}[len(providerNames) == 1]))
	if len(accounts) == 0 {
		return
	}

	selection, err := chooseAccounts(api, accounts, onboardAccounts)
	saveStep := ui.StepStart("Saving account choices")
	if err != nil {
		saveStep.Fail(err.Error())
		ui.WarnLine("collection stays off until you choose accounts: usejunction accounts select")
		return
	}
	saveStep.Done(accountSelectionSummary(selection))
	if selection.On < selection.Offered {
		ui.QuietLine("Change this any time: usejunction accounts select")
	}
}

func providerToolIDs() []string {
	all := providers.All()
	ids := make([]string, 0, len(all))
	for _, p := range all {
		ids = append(ids, p.ID())
	}
	return ids
}

func detectTools() []types.ToolStatus {
	ctx := context.Background()
	providersList := providers.All()
	results := make([]types.ToolStatus, 0, len(providersList))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, p := range providersList {
		wg.Add(1)
		go func(prov providers.Provider) {
			defer wg.Done()
			s, err := prov.Detect(ctx)
			if err != nil || s == nil || !s.Detected {
				return
			}
			mu.Lock()
			results = append(results, *s)
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	return results
}

// humanizeCollectProgress maps collect progress callbacks to short onboard labels.
func humanizeCollectProgress(step, message string) string {
	switch step {
	case "scan-tool-start", "scan-tool-done", "scan-tool-skip", "scan-tool-absent":
		return ""
	case "scan":
		// Tool rows in ScanPanel already cover per-tool scan progress.
		return ""
	}
	if strings.TrimSpace(message) != "" {
		return strings.TrimSpace(message)
	}
	switch step {
	case "heartbeat":
		return "Connecting to UseJunction"
	case "upload-tools":
		return "Preparing inventory"
	case "upload-models":
		return "Uploading local models"
	case "upload-usage":
		return "Syncing usage"
	case "complete":
		return "Finishing sync"
	default:
		return step
	}
}

func init() {
	onboardCmd.Flags().StringVar(&onboardToken, "token", "", "Enrollment token (required unless --complete)")
	onboardCmd.Flags().StringVar(&onboardURL, "url", "", "Control plane URL")
	onboardCmd.Flags().StringVar(&onboardEmail, "email", "", "Developer email")
	onboardCmd.Flags().StringVar(&onboardName, "name", "", "Developer name")
	onboardCmd.Flags().BoolVar(&onboardComplete, "complete", false, "Print the post-install success panel only")
	onboardCmd.Flags().BoolVar(&onboardAcceptNotice, "accept-collection-notice", false, "Acknowledge the device collection notice")
	onboardCmd.Flags().StringVar(&onboardAccounts, "accounts", os.Getenv("USEJUNCTION_ACCOUNTS"), `Skip the account picker: "all", "none", or a comma-separated list of emails, providers, or provider:email`)
	rootCmd.AddCommand(onboardCmd)
}
