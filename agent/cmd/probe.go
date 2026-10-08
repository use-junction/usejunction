package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/probe"
	"github.com/usejunction/agent/internal/providers"
)

var probeTool string

var probeCmd = &cobra.Command{
	Use:    "probe",
	Short:  "Probe quota and account identity for detected tools",
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		type result struct {
			Tool          string `json:"tool"`
			Account       any    `json:"account"`
			Quotas        any    `json:"quotas"`
			OtherAccounts any    `json:"otherAccounts,omitempty"`
			OtherQuotas   any    `json:"otherQuotas,omitempty"`
		}
		var out []result

		for _, p := range providers.All() {
			if probeTool != "" && p.ID() != probeTool {
				continue
			}
			acc, _ := p.AccountIdentity(ctx)
			quotas, _ := p.ProbeQuota(ctx)
			item := result{Tool: p.ID(), Account: acc, Quotas: quotas}
			if multi, ok := p.(providers.MultiAccountProvider); ok {
				item.OtherAccounts = multi.OtherAccounts(ctx)
			}
			if p.ID() == "claude" {
				item.OtherQuotas = probe.ClaudeOtherAccountQuotas()
			}
			out = append(out, item)
		}

		if format == "json" {
			printJSON(out)
			return nil
		}

		for _, item := range out {
			fmt.Printf("=== %s ===\n", item.Tool)
			fmt.Printf("  account: %+v\n", item.Account)
			fmt.Printf("  quotas:  %+v\n", item.Quotas)
			if item.OtherAccounts != nil {
				fmt.Printf("  other accounts: %+v\n", item.OtherAccounts)
			}
			if item.OtherQuotas != nil {
				fmt.Printf("  other quotas:   %+v\n", item.OtherQuotas)
			}
		}
		return nil
	},
}

func init() {
	probeCmd.Flags().StringVar(&probeTool, "tool", "", "Probe a specific tool (codex|claude|cursor|copilot|opencode)")
	rootCmd.AddCommand(probeCmd)
}
