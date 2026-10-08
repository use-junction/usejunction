package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/probe"
)

var claudeDesktopCmd = &cobra.Command{
	Use:   "claude-desktop",
	Short: "Connect or disconnect live limits for the active Claude desktop account",
}

// claudeDesktopConnectCmd is the single user action that opts into reading the
// Claude desktop app's credential store. Running it records consent and
// immediately performs the read, so the one-time macOS Keychain "Always Allow"
// prompt appears here, in direct response to the user — never in the background.
var claudeDesktopConnectCmd = &cobra.Command{
	Use:   "connect",
	Short: "Allow reading live limits for the Claude desktop account you are actively using",
	Long: "Grants consent for the agent to read the Claude desktop app's encrypted " +
		"credential store so it can show live limits for the account you are " +
		"actively running, even when the Claude Code CLI is signed into a different " +
		"login. macOS shows a one-time Keychain prompt; choose \"Always Allow\". The " +
		"agent never reads this store until you run this command, and never writes to it.",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}
		cfg.ClaudeDesktopUsageConsent = true
		if err := config.Save(cfg); err != nil {
			return fmt.Errorf("save consent: %w", err)
		}

		active := probe.ClaudeActiveDesktopAccount()
		if active == nil {
			fmt.Println("Consent saved. No active Claude desktop session found yet; live limits will appear after you use the desktop app.")
			return nil
		}

		snaps, account := probe.ClaudeActiveDesktopUsage(context.Background(), true)
		if account == nil {
			fmt.Println("Consent saved, but the desktop credential store could not be read (Keychain denied or unavailable). Re-run after approving the prompt.")
			fmt.Println()
			fmt.Println(probe.ClaudeDesktopUsageDebug(context.Background()))
			return nil
		}
		who := account.Email
		if who == "" {
			who = "the active account"
		}
		if len(snaps) == 0 {
			fmt.Printf("Connected %s (%s). No live limit windows were returned.\n\n", who, account.Plan)
			fmt.Println("Diagnostic:")
			fmt.Println(probe.ClaudeDesktopUsageDebug(context.Background()))
			return nil
		}
		fmt.Printf("Connected %s (%s). Live limits:\n", who, account.Plan)
		for _, s := range snaps {
			if s.UsedPercent != nil {
				fmt.Printf("  %s: %.0f%% used\n", s.WindowType, *s.UsedPercent)
			}
		}
		fmt.Println("\nThese upload on the next collect. The background agent will pick them up; run `collect` now to push immediately.")
		return nil
	},
}

var claudeDesktopDisconnectCmd = &cobra.Command{
	Use:   "disconnect",
	Short: "Stop reading the Claude desktop credential store",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}
		cfg.ClaudeDesktopUsageConsent = false
		if err := config.Save(cfg); err != nil {
			return fmt.Errorf("save: %w", err)
		}
		fmt.Println("Disconnected. The agent will no longer read the Claude desktop credential store.")
		return nil
	},
}

func init() {
	claudeDesktopCmd.AddCommand(claudeDesktopConnectCmd)
	claudeDesktopCmd.AddCommand(claudeDesktopDisconnectCmd)
	rootCmd.AddCommand(claudeDesktopCmd)
}
