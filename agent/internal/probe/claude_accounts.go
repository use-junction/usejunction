package probe

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/types"
)

// Claude Code keeps only the active login in ~/.claude.json. The Claude desktop
// app can hold several logins and records which one ran each Code session under
// claude-code-sessions/<accountUuid>/<orgUuid>/local_*.json. We read only those
// session ids — never the desktop app's token cache.

// ClaudeDesktopAccount is one login seen in the Claude desktop app.
type ClaudeDesktopAccount struct {
	AccountUUID string
	OrgUUID     string
	SessionIDs  []string
}

type knownClaudeAccount struct {
	Email  string    `json:"email"`
	Plan   string    `json:"plan,omitempty"`
	SeenAt time.Time `json:"seenAt"`
}

var knownClaudeAccountsMu sync.Mutex

func claudeDesktopDir() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Claude")
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "Claude")
		}
		return filepath.Join(home, "AppData", "Roaming", "Claude")
	default:
		return filepath.Join(home, ".config", "Claude")
	}
}

// ClaudeDesktopAccounts lists logins that ran Claude Code sessions from the
// desktop app, with the session ids each one owns.
func ClaudeDesktopAccounts() []ClaudeDesktopAccount {
	return claudeDesktopAccountsIn(filepath.Join(claudeDesktopDir(), "claude-code-sessions"))
}

func claudeDesktopAccountsIn(root string) []ClaudeDesktopAccount {
	accountDirs, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []ClaudeDesktopAccount
	for _, accountDir := range accountDirs {
		if !accountDir.IsDir() || strings.HasPrefix(accountDir.Name(), ".") {
			continue
		}
		orgDirs, _ := os.ReadDir(filepath.Join(root, accountDir.Name()))
		for _, orgDir := range orgDirs {
			if !orgDir.IsDir() {
				continue
			}
			account := ClaudeDesktopAccount{AccountUUID: accountDir.Name(), OrgUUID: orgDir.Name()}
			files, _ := filepath.Glob(filepath.Join(root, accountDir.Name(), orgDir.Name(), "local_*.json"))
			for _, file := range files {
				account.SessionIDs = append(account.SessionIDs, claudeSessionIDsFromFile(file)...)
			}
			out = append(out, account)
		}
	}
	return out
}

func claudeSessionIDsFromFile(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var doc struct {
		CLISessionID       string   `json:"cliSessionId"`
		PriorCLISessionIDs []string `json:"priorCliSessionIds"`
	}
	if json.Unmarshal(data, &doc) != nil {
		return nil
	}
	var ids []string
	for _, id := range append([]string{doc.CLISessionID}, doc.PriorCLISessionIDs...) {
		if id = strings.TrimSpace(id); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func knownClaudeAccountsPath() string {
	return filepath.Join(config.CacheDir(), "claude-accounts.json")
}

func loadKnownClaudeAccounts() map[string]knownClaudeAccount {
	out := map[string]knownClaudeAccount{}
	data, err := os.ReadFile(knownClaudeAccountsPath())
	if err == nil {
		_ = json.Unmarshal(data, &out)
	}
	return out
}

// rememberClaudeAccount keeps the email and plan of each login seen as the
// active one, so it can still be named after the user switches accounts.
func rememberClaudeAccount(accountUUID, email, plan string) {
	accountUUID = strings.TrimSpace(accountUUID)
	email = strings.ToLower(strings.TrimSpace(email))
	if accountUUID == "" || email == "" {
		return
	}
	knownClaudeAccountsMu.Lock()
	defer knownClaudeAccountsMu.Unlock()
	known := loadKnownClaudeAccounts()
	prev := known[accountUUID]
	if prev.Email == email && prev.Plan == plan {
		return
	}
	known[accountUUID] = knownClaudeAccount{Email: email, Plan: plan, SeenAt: time.Now().UTC()}
	data, err := json.MarshalIndent(known, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(knownClaudeAccountsPath()), 0o700)
	_ = os.WriteFile(knownClaudeAccountsPath(), data, 0o600)
}

// activeClaudeAccount reads the account uuid of the current Claude Code login
// and remembers its email and plan.
func activeClaudeAccount(home string) (uuid string, account *types.ToolAccount) {
	data, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		return "", nil
	}
	var doc struct {
		OAuthAccount *claudeJSONOAuthAccount `json:"oauthAccount"`
	}
	if json.Unmarshal(data, &doc) != nil || doc.OAuthAccount == nil {
		return "", nil
	}
	uuid = strings.TrimSpace(doc.OAuthAccount.AccountUUID)
	email := strings.TrimSpace(doc.OAuthAccount.EmailAddress)
	plan := claudePlanFromOAuthAccount(*doc.OAuthAccount)
	rememberClaudeAccount(uuid, email, plan)
	if email == "" {
		return uuid, nil
	}
	return uuid, &types.ToolAccount{ToolName: "claude", Email: email, Plan: plan}
}

// ClaudeAccountKey is the account key usage rows and switches use for a
// Claude login: its email when known, otherwise a stable placeholder.
func ClaudeAccountKey(accountUUID, email string) string {
	if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
		return email
	}
	return "claude:" + strings.TrimSpace(accountUUID)
}

// ClaudeOtherAccounts returns desktop-app logins other than the active Claude
// Code login. Email and plan come from when each was last the active login.
func ClaudeOtherAccounts() []types.ToolAccount {
	home, _ := os.UserHomeDir()
	activeUUID, _ := activeClaudeAccount(home)
	known := loadKnownClaudeAccounts()
	seen := map[string]bool{}
	var out []types.ToolAccount
	for _, desktop := range ClaudeDesktopAccounts() {
		uuid := desktop.AccountUUID
		if uuid == activeUUID || seen[uuid] {
			continue
		}
		seen[uuid] = true
		info := known[uuid]
		out = append(out, types.ToolAccount{
			ToolName:    "claude",
			AccountKey:  ClaudeAccountKey(uuid, info.Email),
			Email:       info.Email,
			Plan:        info.Plan,
			LoginMethod: "desktop",
			AuthPresent: true,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AccountKey < out[j].AccountKey })
	return out
}

// ClaudeSessionAccountKeys maps each desktop-launched Claude Code session id
// to the account key of the login that ran it.
func ClaudeSessionAccountKeys() map[string]string {
	home, _ := os.UserHomeDir()
	activeUUID, active := activeClaudeAccount(home)
	known := loadKnownClaudeAccounts()
	out := map[string]string{}
	for _, desktop := range ClaudeDesktopAccounts() {
		email := known[desktop.AccountUUID].Email
		if desktop.AccountUUID == activeUUID && active != nil {
			email = active.Email
		}
		key := ClaudeAccountKey(desktop.AccountUUID, email)
		for _, id := range desktop.SessionIDs {
			out[id] = key
		}
	}
	return out
}

// RememberClaudeAccount names a login, e.g. from an email the control plane
// already holds for this device.
func RememberClaudeAccount(accountUUID, email, plan string) {
	rememberClaudeAccount(accountUUID, email, plan)
}

// UnnamedClaudeAccountUUIDs lists desktop-app logins (other than the active
// one) whose email is not known yet.
func UnnamedClaudeAccountUUIDs() []string {
	var out []string
	for _, account := range ClaudeOtherAccounts() {
		if account.Email == "" {
			out = append(out, strings.TrimPrefix(account.AccountKey, "claude:"))
		}
	}
	return out
}

// ClaudeLocalEmails lists every Claude email already tied to a login here.
func ClaudeLocalEmails() map[string]bool {
	out := map[string]bool{}
	home, _ := os.UserHomeDir()
	if _, active := activeClaudeAccount(home); active != nil {
		out[strings.ToLower(active.Email)] = true
	}
	for _, known := range loadKnownClaudeAccounts() {
		if known.Email != "" {
			out[known.Email] = true
		}
	}
	return out
}
