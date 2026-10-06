package cmd

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/configure"
	"github.com/usejunction/agent/internal/controlurl"
	"github.com/usejunction/agent/internal/types"
)

var (
	enrollToken     string
	controlPlaneURL string
	enrollEmail     string
	enrollName      string
	enrollSetup     bool
	enrollAcceptNotice bool
)

type enrollResult struct {
	cfg *config.Config
}

type enrollOptions struct {
	Token         string
	URL           string
	Email         string
	Name          string
	Setup         bool
	Quiet         bool // suppress enroll success lines (onboard owns the narrative)
	NoReportPrint bool // run report but suppress its text output
	AcceptNotice  bool
}

func doEnroll(opts enrollOptions) (*enrollResult, error) {
	if opts.Token == "" {
		return nil, fmt.Errorf("--token is required")
	}
	url := opts.URL
	if url == "" {
		url = os.Getenv("USEJUNCTION_URL")
	}
	if url == "" {
		url = "http://localhost:3001"
	}
	if err := warnEnrollmentTarget(url, opts); err != nil {
		return nil, err
	}
	if err := acceptCollectionNotice(opts); err != nil {
		return nil, err
	}

	osName, arch := platformInfo()
	resp, err := client.Enroll(url, client.EnrollRequest{
		Token:         opts.Token,
		Email:         opts.Email,
		Name:          opts.Name,
		Hostname:      hostname(),
		OS:            osName,
		Architecture:  arch,
		AgentVersion:  config.Version,
		NoticeVersion: CollectionNoticeVersion,
	})
	if err != nil {
		return nil, err
	}

	cfg := &config.Config{
		ControlPlaneURL: url,
		DeviceToken:     resp.DeviceToken,
		DeviceID:        resp.DeviceID,
		UserID:          resp.UserID,
		OrgID:           resp.OrgID,
		// Never store or use a gateway URL. Local tools keep their own
		// vendor configs (e.g. ~/.codex/config.toml) untouched.
	}
	if resp.Otel != nil {
		cfg.OtelEnabled = resp.Otel.Enabled
		cfg.		OtelMetricsEndpoint = resp.Otel.MetricsEndpoint
	}
	cfg.CollectionNoticeVersion = CollectionNoticeVersion
	if _, err := cfg.EnsureLocalSyncCredentials(); err != nil {
		return nil, fmt.Errorf("local sync credentials: %w", err)
	}
	if err := config.Save(cfg); err != nil {
		return nil, fmt.Errorf("saving config: %w", err)
	}

	if err := configure.RepairLegacyCodexGatewayConfig(); err != nil {
		fmt.Printf("codex config repair warning: %v\n", err)
	}

	if opts.Setup {
		if err := configure.RunSetup(cfg, configure.SetupOptions{
			EnableOtel: true,
		}); err != nil {
			fmt.Printf("setup warning: %v\n", err)
		}
		if stats, err := runInitialReport(opts.NoReportPrint); err != nil {
			fmt.Printf("initial report warning: %v\n", err)
		} else {
			_ = stats
		}
	}

	if !opts.Quiet {
		if format == "json" {
			printJSON(map[string]any{
				"deviceId": resp.DeviceID,
				"orgId":    resp.OrgID,
			})
		} else {
			fmt.Printf("Enrolled device %s for org %s\n", resp.DeviceID, resp.OrgID)
			fmt.Printf("Config saved to %s\n", config.ConfigPath())
		}
	}

	return &enrollResult{cfg: cfg}, nil
}

func warnEnrollmentTarget(targetURL string, opts enrollOptions) error {
	parsed, err := url.ParseRequestURI(targetURL)
	if err != nil {
		return fmt.Errorf("invalid control plane URL: %w", err)
	}
	if !controlurl.IsLoopbackHost(parsed.Hostname()) {
		return nil
	}
	if envURL := strings.TrimSpace(os.Getenv("USEJUNCTION_URL")); envURL != "" {
		envParsed, err := url.ParseRequestURI(envURL)
		if err == nil && !controlurl.IsLoopbackHost(envParsed.Hostname()) {
			return fmt.Errorf(
				"USEJUNCTION_URL is %s but enrolling to %s; pass --url %s",
				envURL,
				targetURL,
				envURL,
			)
		}
	}
	if !opts.Quiet && format != "json" {
		fmt.Printf(
			"WARNING: Enrolling to local dev (%s). Remote production dashboards will not receive device activity.\n",
			targetURL,
		)
	}
	return nil
}

type reportStats struct {
	Tools    int
	Accounts int
	Quotas   int
	Usage    int
	ToolList []types.ToolStatus
}

// runInitialReport runs the initial collect/report. When quiet, suppresses
// stdout so onboard can wrap it in a progress step.
func runInitialReport(quiet bool) (*reportStats, error) {
	return runInitialReportWithProgress(quiet, nil)
}

// runInitialReportWithProgress runs the initial collect/report and forwards
// collect phase updates to progress when provided.
func runInitialReportWithProgress(quiet bool, progress collectProgress) (*reportStats, error) {
	cfg, err := requireConfig()
	if err != nil {
		return nil, err
	}
	if changed, err := cfg.EnsureLocalSyncCredentials(); err != nil {
		return nil, err
	} else if changed {
		_ = config.Save(cfg)
	}
	tools, accounts, quotas, usage, toolList, _, err := collectAndReportWithTools(
		context.Background(),
		client.New(cfg),
		true,
		progress,
	)
	stats := &reportStats{Tools: tools, Accounts: accounts, Quotas: quotas, Usage: usage, ToolList: toolList}
	if err != nil {
		return stats, err
	}
	if quiet {
		return stats, nil
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
	return stats, nil
}

var enrollCmd = &cobra.Command{
	Use:   "enroll",
	Short: "Enroll this device with the UseJunction control plane",
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := doEnroll(enrollOptions{
			Token:        enrollToken,
			URL:          controlPlaneURL,
			Email:        enrollEmail,
			Name:         enrollName,
			Setup:        enrollSetup,
			AcceptNotice: enrollAcceptNotice,
		})
		return err
	},
}

func init() {
	enrollCmd.Flags().StringVar(&enrollToken, "token", "", "Enrollment token (required)")
	enrollCmd.Flags().StringVar(&controlPlaneURL, "url", "", "Control plane URL (default: $USEJUNCTION_URL or http://localhost:3001)")
	enrollCmd.Flags().StringVar(&enrollEmail, "email", "", "Developer email")
	enrollCmd.Flags().StringVar(&enrollName, "name", "", "Developer name")
	enrollCmd.Flags().BoolVar(&enrollSetup, "setup", true, "Enable Claude OTEL and send initial report")
	enrollCmd.Flags().BoolVar(&enrollAcceptNotice, "accept-collection-notice", false, "Acknowledge the device collection notice")
	rootCmd.AddCommand(enrollCmd)
}
