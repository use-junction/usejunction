package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/types"
	"github.com/usejunction/agent/internal/ui"
)

// A first scan of a busy machine can take a while; later ones read a cache.
const usageReportScanTimeout = 10 * time.Minute

var (
	usageSince     string
	usageUntil     string
	usageTool      string
	usageOrder     string
	usageJSON      bool
	usageBreakdown bool

	// Swapped out in tests so a command can run without reading real logs.
	scanUsageForReport = func(ctx context.Context) ([]types.DailyUsage, bool) {
		return scanLocalUsage(ctx, usageReportScanTimeout)
	}
	usageReportNow = time.Now
)

func addUsageReportFlags(cmd *cobra.Command) {
	flags := cmd.Flags()
	flags.StringVar(&usageSince, "since", "", "First day to show (YYYYMMDD or YYYY-MM-DD)")
	flags.StringVar(&usageUntil, "until", "", "Last day to show (YYYYMMDD or YYYY-MM-DD)")
	flags.StringVar(&usageTool, "tool", "all", "Show one tool only: claude|codex|cursor|copilot|opencode|…")
	flags.StringVar(&usageOrder, "order", "asc", "Oldest first (asc) or newest first (desc)")
	flags.BoolVar(&usageBreakdown, "breakdown", false, "Add a line per model under each row")
	flags.BoolVar(&usageJSON, "json", false, "Print JSON instead of a table")
}

// runUsageReport reads local usage and prints one table. It never uploads:
// a connected device syncs from its background service, not from here.
func runUsageReport(cmd *cobra.Command, period string) error {
	jsonOut := usageJSON || format == "json"
	opts := usageReportOptions{
		Period: period, Since: usageSince, Until: usageUntil,
		Tool: usageTool, Breakdown: usageBreakdown, Order: usageOrder,
	}
	now := usageReportNow()
	// Check the flags before spending time on a scan.
	if _, err := resolveUsageWindow(now, opts); err != nil {
		return err
	}

	terminal := ui.IsTerminal()
	var step *ui.Step
	if terminal && !jsonOut {
		step = ui.StepStart("Reading local usage")
	}
	rows, ok := scanUsageForReport(context.Background())
	if !ok {
		if step != nil {
			step.Fail("took too long")
		}
		return fmt.Errorf("reading local logs took more than %s; run it again to pick up where it stopped", usageReportScanTimeout)
	}
	report, err := buildUsageReport(rows, now, opts)
	if err != nil {
		if step != nil {
			step.Fail(err.Error())
		}
		return err
	}
	if step != nil {
		tools := map[string]bool{}
		for _, row := range report.Rows {
			tools[row.Tool] = true
		}
		step.Done(fmt.Sprintf("%d %s", len(tools), plural(len(tools), "tool", "tools")))
	}

	out := cmd.OutOrStdout()
	if jsonOut {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		return enc.Encode(usageReportJSON(report))
	}

	cfg := alreadyConnected()
	renderUsageReport(out, report, cfg != nil)
	dashboardURL := ""
	if cfg != nil {
		dashboardURL = cfg.ControlPlaneURL
	}
	if len(report.Rows) > 0 {
		if tip := usageTip(cfg != nil, dashboardURL, terminal, jsonOut, os.Getenv("USEJUNCTION_NO_TIPS")); tip != "" {
			fmt.Fprintf(out, "\n %s\n", ui.Muted(tip))
		}
		fmt.Fprintln(out)
	}
	return nil
}

var dailyCmd = &cobra.Command{
	Use:   "daily",
	Short: "Show usage and estimated cost per day, from this machine's logs",
	Long: `daily prints one row per day and tool for the last 30 days.

It reads the usage numbers AI coding tools already write to this machine.
No account is needed and nothing is uploaded. Prompt text is never read.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUsageReport(cmd, usagePeriodDaily)
	},
}

var monthlyCmd = &cobra.Command{
	Use:   "monthly",
	Short: "Show usage and estimated cost per month, from this machine's logs",
	Long: `monthly prints one row per month and tool.

Only the last 60 days of logs are read, so the oldest month is usually
partial; the table says which days each month covers.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUsageReport(cmd, usagePeriodMonthly)
	},
}

func init() {
	// With no command, show the daily table rather than the help text.
	rootCmd.RunE = func(cmd *cobra.Command, args []string) error {
		return runUsageReport(cmd, usagePeriodDaily)
	}
	addUsageReportFlags(rootCmd)
	addUsageReportFlags(dailyCmd)
	addUsageReportFlags(monthlyCmd)
	rootCmd.AddCommand(dailyCmd)
	rootCmd.AddCommand(monthlyCmd)
}
