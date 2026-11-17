package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/providers"
	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/types"
	"github.com/usejunction/agent/internal/ui"
)

// A first scan of a busy machine can take a while; later ones read a cache.
const usageReportScanTimeout = 10 * time.Minute

var (
	usageSince      string
	usageUntil      string
	usageTool       string
	usageOrder      string
	usageJSON       bool
	usageBreakdown  bool
	usageActiveOnly bool
	usageLast       int

	// Swapped out in tests so a command can run without reading real logs.
	scanUsageForReport = func(ctx context.Context) ([]types.DailyUsage, bool) {
		return scanLocalUsage(ctx, usageReportScanTimeout)
	}
	usageReportNow = time.Now
	// Claude Code events from session files changed since the given time.
	scanClaudeEventsForReport = func(modifiedSince time.Time) []scan.UsageEvent {
		return scan.ScanClaudeEvents(providers.ClaudeProjectRoots(), modifiedSince)
	}
)

func addUsageReportFlags(cmd *cobra.Command, unit string) {
	addUsageViewFlags(cmd)
	flags := cmd.Flags()
	flags.StringVar(&usageSince, "since", "", "First day to show (YYYYMMDD or YYYY-MM-DD)")
	flags.StringVar(&usageUntil, "until", "", "Last day to show (YYYYMMDD or YYYY-MM-DD)")
	flags.IntVar(&usageLast, "last", 0, fmt.Sprintf("Show only the most recent N %s (1 is the current one)", unit))
	flags.StringVar(&usageOrder, "order", "asc", "Oldest first (asc) or newest first (desc)")
}

// addUsageViewFlags are the flags every table takes, including today, week
// and month, which fix their own dates.
func addUsageViewFlags(cmd *cobra.Command) {
	flags := cmd.Flags()
	flags.StringVar(&usageTool, "tool", "all", "Show one tool only: claude|codex|cursor|copilot|opencode|…")
	flags.BoolVar(&usageBreakdown, "breakdown", false, "Add a line per model under each row")
	flags.BoolVar(&usageJSON, "json", false, "Print JSON instead of a table")
}

// runUsageReport reads local usage and prints one table. It never uploads:
// a connected device syncs from its background service, not from here.
func runUsageReport(cmd *cobra.Command, period string) error {
	return runUsageReportFor(cmd, period, usageLast)
}

// runUsageReportFor prints one table of the most recent `last` periods, or of
// the --since/--until window when last is 0.
func runUsageReportFor(cmd *cobra.Command, period string, last int) error {
	jsonOut := usageJSON || format == "json"
	opts := usageReportOptions{
		Period: period, Since: usageSince, Until: usageUntil,
		Tool: usageTool, Breakdown: usageBreakdown, Order: usageOrder, Last: last,
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
		step.Done(foundToolsLine(report.toolNames()))
	}

	out := cmd.OutOrStdout()
	if jsonOut {
		return writeUsageJSON(out, usageReportJSON(report))
	}

	cfg := alreadyConnected()
	renderUsageReport(out, report, cfg != nil)
	writeUsageTip(out, cfg, len(report.Rows) > 0, terminal)
	return nil
}

// foundToolsLine names the tools a report found, most expensive first.
func foundToolsLine(names []string) string {
	if len(names) == 0 {
		return "nothing in this period"
	}
	return strings.Join(names, ", ")
}

// writeUsageTip ends a table with the line that points past the terminal.
func writeUsageTip(out io.Writer, cfg *config.Config, hasRows, terminal bool) {
	if !hasRows {
		return
	}
	dashboardURL := ""
	if cfg != nil {
		dashboardURL = cfg.ControlPlaneURL
	}
	signIn := usageSignInCommand(os.Getenv("USEJUNCTION_RUNNER"), runtime.GOOS, resolveLoginURL(""))
	if tip := usageTip(cfg != nil, dashboardURL, terminal, false, os.Getenv("USEJUNCTION_NO_TIPS"), signIn); tip != "" {
		fmt.Fprintf(out, "\n %s\n", ui.Muted(tip))
	}
	fmt.Fprintln(out)
}

func writeUsageJSON(out io.Writer, value any) error {
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

// runSessionReport prints one row per Claude Code session.
func runSessionReport(cmd *cobra.Command) error {
	jsonOut := usageJSON || format == "json"
	now := usageReportNow()
	window, err := resolveEventWindow(now, usageSince, usageUntil, usageSessionDefaultDays)
	if err != nil {
		return err
	}
	descending, err := checkUsageOrder(usageOrder)
	if err != nil {
		return err
	}
	terminal := ui.IsTerminal()
	var step *ui.Step
	if terminal && !jsonOut {
		step = ui.StepStart("Reading Claude Code sessions")
	}
	report := buildSessionReport(scanClaudeEventsForReport(window.From), window, usageBreakdown, descending)
	if step != nil {
		step.Done(fmt.Sprintf("%d %s", len(report.Rows), plural(len(report.Rows), "session", "sessions")))
	}
	out := cmd.OutOrStdout()
	if jsonOut {
		return writeUsageJSON(out, sessionReportJSON(report))
	}
	cfg := alreadyConnected()
	renderSessionReport(out, report, cfg != nil)
	writeUsageTip(out, cfg, len(report.Rows) > 0, terminal)
	return nil
}

// runBlockReport prints Claude Code usage in 5-hour blocks.
func runBlockReport(cmd *cobra.Command) error {
	jsonOut := usageJSON || format == "json"
	now := usageReportNow()
	window, err := resolveEventWindow(now, usageSince, usageUntil, usageBlockDefaultDays)
	if err != nil {
		return err
	}
	descending, err := checkUsageOrder(usageOrder)
	if err != nil {
		return err
	}
	terminal := ui.IsTerminal()
	var step *ui.Step
	if terminal && !jsonOut {
		step = ui.StepStart("Reading Claude Code usage")
	}
	// Where a block starts depends on the activity before it.
	events := scanClaudeEventsForReport(window.From.Add(-usageBlockLeadIn))
	report := buildBlockReport(events, now, window, usageActiveOnly, descending)
	if step != nil {
		step.Done(fmt.Sprintf("%d %s", len(report.Blocks), plural(len(report.Blocks), "block", "blocks")))
	}
	out := cmd.OutOrStdout()
	if jsonOut {
		return writeUsageJSON(out, blockReportJSON(report))
	}
	cfg := alreadyConnected()
	renderBlockReport(out, report, now, cfg != nil)
	writeUsageTip(out, cfg, len(report.Blocks) > 0, terminal)
	return nil
}

// readStatuslineInput takes the JSON Claude Code pipes to a status line
// command. Run by hand there is nothing on stdin, and that is fine.
func readStatuslineInput(in io.Reader) statuslineInput {
	var input statuslineInput
	if file, ok := in.(*os.File); ok {
		if info, err := file.Stat(); err != nil || info.Mode()&os.ModeCharDevice != 0 {
			return input
		}
	}
	raw, err := io.ReadAll(io.LimitReader(in, 1<<20))
	if err != nil {
		return input
	}
	_ = json.Unmarshal(raw, &input)
	return input
}

func runStatusline(cmd *cobra.Command) error {
	now := usageReportNow()
	input := readStatuslineInput(cmd.InOrStdin())
	events := scanClaudeEventsForReport(now.Add(-usageBlockLeadIn))
	fmt.Fprintln(cmd.OutOrStdout(), buildStatusline(events, now, input))
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

var weeklyCmd = &cobra.Command{
	Use:   "weekly",
	Short: "Show usage and estimated cost per week, from this machine's logs",
	Long: `weekly prints one row per week and tool. Weeks run Monday to Sunday, UTC,
and are named by the Monday they start on.

Only the last 60 days of logs are read, so the oldest week can be partial;
the table says which days a partial week covers.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUsageReport(cmd, usagePeriodWeekly)
	},
}

// One-word views of the current day, week and month.
var todayCmd = &cobra.Command{
	Use:   "today",
	Short: "Show today's usage and estimated cost (same as daily --last 1)",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUsageReportFor(cmd, usagePeriodDaily, 1)
	},
}

var weekCmd = &cobra.Command{
	Use:   "week",
	Short: "Show this week's usage and estimated cost (same as weekly --last 1)",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUsageReportFor(cmd, usagePeriodWeekly, 1)
	},
}

var monthCmd = &cobra.Command{
	Use:   "month",
	Short: "Show this month's usage and estimated cost (same as monthly --last 1)",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUsageReportFor(cmd, usagePeriodMonthly, 1)
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

var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Show Claude Code usage and estimated cost per session",
	Long: `session prints one row per Claude Code session active in the last 30 days:
the project it ran in, when it was last active, and what it cost.

It reads local logs only. No account is needed and nothing is uploaded.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error { return runSessionReport(cmd) },
}

var blocksCmd = &cobra.Command{
	Use:   "blocks",
	Short: "Show Claude Code usage in 5-hour blocks, with the pace of the active one",
	Long: `blocks groups the last 7 days of Claude Code usage into 5-hour blocks, the
window Claude's usage limits run on. For the block in progress it shows the
time left, the spend per hour so far, and where that pace ends up.

It reads local logs only. No account is needed and nothing is uploaded.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error { return runBlockReport(cmd) },
}

var statuslineCmd = &cobra.Command{
	Use:   "statusline",
	Short: "Print one line of Claude Code cost for its status line",
	Long: `statusline prints what this session, today and the current 5-hour block
have cost, on one line. Point Claude Code's status line at it in
~/.claude/settings.json:

  "statusLine": { "type": "command", "command": "usejunction statusline" }

It reads local logs only and uploads nothing.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error { return runStatusline(cmd) },
}

func init() {
	sessionFlags := sessionCmd.Flags()
	sessionFlags.StringVar(&usageSince, "since", "", "First day to show (YYYYMMDD or YYYY-MM-DD)")
	sessionFlags.StringVar(&usageUntil, "until", "", "Last day to show (YYYYMMDD or YYYY-MM-DD)")
	sessionFlags.StringVar(&usageOrder, "order", "asc", "Oldest first (asc) or newest first (desc)")
	sessionFlags.BoolVar(&usageBreakdown, "breakdown", false, "Add a line per model under each session")
	sessionFlags.BoolVar(&usageJSON, "json", false, "Print JSON instead of a table")

	blockFlags := blocksCmd.Flags()
	blockFlags.StringVar(&usageSince, "since", "", "First day to show (YYYYMMDD or YYYY-MM-DD)")
	blockFlags.StringVar(&usageUntil, "until", "", "Last day to show (YYYYMMDD or YYYY-MM-DD)")
	blockFlags.StringVar(&usageOrder, "order", "asc", "Oldest first (asc) or newest first (desc)")
	blockFlags.BoolVar(&usageActiveOnly, "active", false, "Show only the block in progress")
	blockFlags.BoolVar(&usageJSON, "json", false, "Print JSON instead of a table")

	rootCmd.AddCommand(sessionCmd)
	rootCmd.AddCommand(blocksCmd)
	rootCmd.AddCommand(statuslineCmd)

	// With no command, show the daily table rather than the help text.
	rootCmd.RunE = func(cmd *cobra.Command, args []string) error {
		return runUsageReport(cmd, usagePeriodDaily)
	}
	addUsageReportFlags(rootCmd, "days")
	addUsageReportFlags(dailyCmd, "days")
	addUsageReportFlags(weeklyCmd, "weeks")
	addUsageReportFlags(monthlyCmd, "months")
	for _, view := range []*cobra.Command{todayCmd, weekCmd, monthCmd} {
		addUsageViewFlags(view)
	}
	rootCmd.AddCommand(dailyCmd, weeklyCmd, monthlyCmd, todayCmd, weekCmd, monthCmd)
}
