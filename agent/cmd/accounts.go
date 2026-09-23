package cmd

import (
	"fmt"
	"os/exec"
	"runtime"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/config"
)

var accountsCmd = &cobra.Command{
	Use:   "accounts",
	Short: "Open collection switches for this device",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("not enrolled: %w", err)
		}
		url := fmt.Sprintf("%s/v1/accounts?token=%s", cfg.LocalSyncURL(), cfg.LocalSyncToken)
		if format == "json" {
			printJSON(map[string]any{"url": url})
			return nil
		}
		fmt.Println(url)
		if err := openURL(url); err != nil {
			fmt.Printf("Open this page in a browser if it did not launch: %s\n", url)
		}
		return nil
	},
}

func openURL(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "linux":
		return exec.Command("xdg-open", url).Start()
	default:
		return fmt.Errorf("open is not supported on %s", runtime.GOOS)
	}
}

func init() {
	rootCmd.AddCommand(accountsCmd)
}
