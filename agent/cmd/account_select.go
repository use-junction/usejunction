package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/spf13/cobra"
	"github.com/usejunction/agent/internal/accountpolicy"
	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/probe"
	"github.com/usejunction/agent/internal/providers"
	"github.com/usejunction/agent/internal/ui"
)

// accountSelectionResult summarizes what the account picker changed.
type accountSelectionResult struct {
	Offered int
	On      int
	Skipped bool // the user dismissed the picker; nothing was changed
}

// discoverSignedInAccounts reads the login each provider has on this device.
func discoverSignedInAccounts(ctx context.Context) []client.AccountReport {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		reports []client.AccountReport
	)
	for _, p := range providers.All() {
		wg.Add(1)
		go func(prov providers.Provider) {
			defer wg.Done()
			status, _ := prov.Detect(ctx)
			if status == nil || !status.Detected {
				return
			}
			found := otherAccountReports(ctx, prov)
			if acc, _ := prov.AccountIdentity(ctx); acc != nil && (acc.AuthPresent || strings.TrimSpace(acc.Plan) != "") {
				toolName := strings.TrimSpace(acc.ToolName)
				if toolName == "" {
					toolName = prov.ID()
				}
				found = append(found, client.AccountReport{
					ToolName:    toolName,
					AccountKey:  acc.AccountKey,
					Email:       acc.Email,
					Plan:        strings.TrimSpace(acc.Plan),
					LoginMethod: acc.LoginMethod,
					AuthPresent: true,
				})
			}
			mu.Lock()
			reports = append(reports, found...)
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	return reports
}

func pickerAccountID(account accountpolicy.Account) string {
	return account.ToolName + "\x00" + account.AccountKey
}

func providerDisplayName(account accountpolicy.Account) string {
	if name := strings.TrimSpace(account.DisplayName); name != "" {
		return name
	}
	tool := strings.TrimSpace(account.ToolName)
	if tool == "" {
		return "Unknown"
	}
	return strings.ToUpper(tool[:1]) + tool[1:]
}

// matchesAccountSpec reports whether a --accounts entry names this account:
// an email, a provider id, or provider:email.
func matchesAccountSpec(account accountpolicy.Account, spec string) bool {
	spec = strings.ToLower(strings.TrimSpace(spec))
	if spec == "" {
		return false
	}
	tool := strings.ToLower(strings.TrimSpace(account.ToolName))
	email := strings.ToLower(strings.TrimSpace(account.Email))
	if specTool, specEmail, ok := strings.Cut(spec, ":"); ok {
		return specTool == tool && specEmail == email
	}
	return spec == tool || (email != "" && spec == email)
}

// selectionFromSpec applies a non-interactive --accounts value: "all",
// "none", or a comma-separated list of emails / providers / provider:email.
func selectionFromSpec(accounts []accountpolicy.Account, spec string) map[string]bool {
	spec = strings.TrimSpace(spec)
	selected := map[string]bool{}
	for _, account := range accounts {
		on := false
		switch strings.ToLower(spec) {
		case "all":
			on = true
		case "none", "":
			on = false
		default:
			for _, part := range strings.Split(spec, ",") {
				if matchesAccountSpec(account, part) {
					on = true
					break
				}
			}
		}
		selected[pickerAccountID(account)] = on
	}
	return selected
}

// openTTY returns the controlling terminal even when stdin is a pipe
// (curl … | sh), or nil when there is none.
func openTTY() *os.File {
	if format == "json" {
		return nil
	}
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return nil
	}
	return tty
}

// runAccountSelection registers this device's signed-in accounts, lets the
// developer choose which to collect from, and saves those choices before any
// usage is read. spec overrides the picker ("all", "none", or a list).
func runAccountSelection(ctx context.Context, api *client.APIClient, spec string) (*accountSelectionResult, error) {
	accounts, err := loadSelectableAccounts(ctx, api)
	if err != nil {
		return nil, err
	}
	return chooseAccounts(api, accounts, spec)
}

// loadSelectableAccounts reports the signed-in logins so the control plane
// has a switch for each, then returns those switches.
func loadSelectableAccounts(ctx context.Context, api *client.APIClient) ([]accountpolicy.Account, error) {
	if earlier, err := api.AccountPolicy(); err == nil {
		linkClaudeLogins(earlier)
	}
	if discovered := discoverSignedInAccounts(ctx); len(discovered) > 0 {
		if err := api.ReportAccounts(discovered); err != nil {
			return nil, fmt.Errorf("register accounts: %w", err)
		}
	}
	policy, err := api.AccountPolicy()
	if err != nil {
		return nil, fmt.Errorf("load account policy: %w", err)
	}
	var accounts []accountpolicy.Account
	for _, account := range policy.Accounts {
		if account.AuthPresent {
			accounts = append(accounts, account)
		}
	}
	return accounts, nil
}

// chooseAccounts applies spec, or shows the picker when a terminal is
// available, and saves the result. With neither, every switch is left as is.
func chooseAccounts(api *client.APIClient, accounts []accountpolicy.Account, spec string) (*accountSelectionResult, error) {
	result := &accountSelectionResult{Offered: len(accounts)}
	if len(accounts) == 0 {
		return result, nil
	}

	var selected map[string]bool
	if strings.TrimSpace(spec) != "" {
		selected = selectionFromSpec(accounts, spec)
	} else if tty := openTTY(); tty != nil {
		defer tty.Close()
		picked, ok, err := ui.PickAccounts(pickerGroups(accounts), tty, tty)
		if err != nil {
			return nil, err
		}
		if ok {
			selected = map[string]bool{}
			for _, account := range picked {
				selected[account.ID] = account.Selected
			}
		}
	}
	if selected == nil {
		result.Skipped = true
		for _, account := range accounts {
			if account.UsageAllowed {
				result.On++
			}
		}
		return result, nil
	}

	for _, account := range accounts {
		on := selected[pickerAccountID(account)]
		if on {
			result.On++
		}
		current := account.UsageEnabled || account.LoggingEnabled
		if on == current || (account.UsageAdminLocked && account.LoggingAdminLocked) {
			continue
		}
		if _, err := api.PatchAccountPolicy(client.AccountPolicyPatch{
			Scope:      "account",
			ToolName:   account.ToolName,
			AccountKey: account.AccountKey,
			Enabled:    on,
		}); err != nil {
			return nil, fmt.Errorf("save %s %s: %w", providerDisplayName(account), account.Email, err)
		}
	}
	return result, nil
}

// linkClaudeLogins names a desktop-app Claude login whose email is unknown
// locally, using the one Claude email this device reported before that no
// current login accounts for. With any ambiguity it leaves the login unnamed.
func linkClaudeLogins(policy *accountpolicy.Policy) {
	if policy == nil {
		return
	}
	unnamed := probe.UnnamedClaudeAccountUUIDs()
	if len(unnamed) != 1 {
		return
	}
	local := probe.ClaudeLocalEmails()
	var orphan *accountpolicy.Account
	for i := range policy.Accounts {
		row := &policy.Accounts[i]
		email := strings.ToLower(strings.TrimSpace(row.Email))
		if row.ToolName != "claude" || email == "" || local[email] {
			continue
		}
		if orphan != nil && !strings.EqualFold(orphan.Email, email) {
			return
		}
		orphan = row
	}
	if orphan != nil {
		probe.RememberClaudeAccount(unnamed[0], orphan.Email, orphan.Plan)
	}
}

func pickerGroups(accounts []accountpolicy.Account) []ui.PickerGroup {
	items := make([]ui.PickerAccount, 0, len(accounts))
	for _, account := range accounts {
		items = append(items, ui.PickerAccount{
			ID:       pickerAccountID(account),
			Email:    account.Email,
			Provider: providerDisplayName(account),
			Plan:     pickerDetail(account),
			Selected: account.UsageEnabled || account.LoggingEnabled,
			Locked:   account.UsageAdminLocked && account.LoggingAdminLocked,
		})
	}
	return ui.GroupPickerAccounts(items)
}

// pickerDetail explains a login whose email is not known yet.
func pickerDetail(account accountpolicy.Account) string {
	if strings.TrimSpace(account.Email) == "" && strings.HasPrefix(account.AccountKey, account.ToolName+":") {
		detail := "another login from the desktop app · email appears after you next use it in Claude Code"
		if account.Plan != "" {
			detail = account.Plan + " · " + detail
		}
		return detail
	}
	return account.Plan
}

func accountSelectionSummary(res *accountSelectionResult) string {
	switch {
	case res.Offered == 0:
		return "no signed-in accounts found"
	case res.Skipped:
		return fmt.Sprintf("%d of %d accounts on · unchanged", res.On, res.Offered)
	default:
		return fmt.Sprintf("%d of %d accounts on", res.On, res.Offered)
	}
}

var accountsSelectSpec string

var accountsSelectCmd = &cobra.Command{
	Use:   "select",
	Short: "Choose which signed-in accounts to collect from, in the terminal",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("not enrolled: %w", err)
		}
		res, err := runAccountSelection(cmd.Context(), client.New(cfg), accountsSelectSpec)
		if err != nil {
			return err
		}
		if format == "json" {
			printJSON(res)
			return nil
		}
		fmt.Println(accountSelectionSummary(res))
		return nil
	},
}

func init() {
	accountsSelectCmd.Flags().StringVar(&accountsSelectSpec, "accounts", "", `Skip the picker: "all", "none", or a comma-separated list of emails, providers, or provider:email`)
	accountsCmd.AddCommand(accountsSelectCmd)
}
