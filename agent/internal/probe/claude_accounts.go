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
	AccountUUID  string
	OrgUUID      string
	SessionIDs   []string
	LastActivity time.Time
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

// ClaudeActiveDesktopAccount returns the desktop login the user is currently
// running — the one with the most recent session activity — or nil when none is
// known. This is the account whose live limits matter most, even when the
// Claude Code CLI is signed into a different login.
func ClaudeActiveDesktopAccount() *ClaudeDesktopAccount {
	var active *ClaudeDesktopAccount
	for _, account := range ClaudeDesktopAccounts() {
		a := account
		if active == nil || a.LastActivity.After(active.LastActivity) {
			active = &a
		}
	}
	return active
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
				ids, activity := claudeSessionInfoFromFile(file)
				account.SessionIDs = append(account.SessionIDs, ids...)
				if activity.After(account.LastActivity) {
					account.LastActivity = activity
				}
			}
			// The desktop app leaves stray empty org folders — an account can have
			// a 0-session folder under an org that belongs to a different login.
			// Those misattribute the account's org (and, via org→plan resolution,
			// its plan), so skip any (account, org) pair with no real sessions.
			if len(account.SessionIDs) == 0 {
				continue
			}
			out = append(out, account)
		}
	}
	return out
}

func claudeSessionIDsFromFile(path string) []string {
	ids, _ := claudeSessionInfoFromFile(path)
	return ids
}

// claudeSessionInfoFromFile returns the session ids a desktop metadata file
// owns and the newest activity timestamp on it, used to tell which login the
// user is actively running.
func claudeSessionInfoFromFile(path string) ([]string, time.Time) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}
	}
	var doc struct {
		CLISessionID       string   `json:"cliSessionId"`
		PriorCLISessionIDs []string `json:"priorCliSessionIds"`
		LastActivityAt     int64    `json:"lastActivityAt"`
		LastFocusedAt      int64    `json:"lastFocusedAt"`
		CreatedAt          int64    `json:"createdAt"`
	}
	if json.Unmarshal(data, &doc) != nil {
		return nil, time.Time{}
	}
	var ids []string
	for _, id := range append([]string{doc.CLISessionID}, doc.PriorCLISessionIDs...) {
		if id = strings.TrimSpace(id); id != "" {
			ids = append(ids, id)
		}
	}
	activityMs := doc.LastActivityAt
	for _, candidate := range []int64{doc.LastFocusedAt, doc.CreatedAt} {
		if candidate > activityMs {
			activityMs = candidate
		}
	}
	var activity time.Time
	if activityMs > 0 {
		activity = time.UnixMilli(activityMs)
	}
	return ids, activity
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

// claudeAccountIdentity resolves the best email+plan for a desktop login from
// what we have learned on this device: nothing on disk names a non-active
// login's email or plan in plaintext (that lives only in the desktop app's
// encrypted store, which we deliberately do not read), so this is empty until
// the login has been the active Claude Code login at least once. The login's
// org, however, is plaintext (see ClaudeDesktopAccounts), and the control plane
// resolves the plan from that org.
func claudeAccountIdentity(uuid string, known map[string]knownClaudeAccount) (email, plan string) {
	info := known[uuid]
	return info.Email, info.Plan
}

// claudeBestDesktopEntryByUUID picks, for each login, the organization it is
// most actively using — the (account, org) pair with the most recent session
// activity. Empty org folders are already dropped upstream; this guards the
// case where a login legitimately has sessions under more than one org.
func claudeBestDesktopEntryByUUID() map[string]ClaudeDesktopAccount {
	out := map[string]ClaudeDesktopAccount{}
	for _, desktop := range ClaudeDesktopAccounts() {
		uuid := strings.TrimSpace(desktop.AccountUUID)
		if uuid == "" || strings.TrimSpace(desktop.OrgUUID) == "" {
			continue
		}
		if best, ok := out[uuid]; !ok || desktop.LastActivity.After(best.LastActivity) {
			out[uuid] = desktop
		}
	}
	return out
}

// claudePrimaryOrgByUUID maps each desktop login to the organization it is most
// actively using.
func claudePrimaryOrgByUUID() map[string]string {
	out := map[string]string{}
	for uuid, entry := range claudeBestDesktopEntryByUUID() {
		out[uuid] = entry.OrgUUID
	}
	return out
}

// ClaudeOtherAccounts returns desktop-app logins other than the active Claude
// Code login. Email/plan are filled only when this device has seen the login as
// active before; otherwise the login carries just its account key and org, and
// the control plane resolves the plan from the org.
func ClaudeOtherAccounts() []types.ToolAccount {
	home, _ := os.UserHomeDir()
	activeUUID, _ := activeClaudeAccount(home)
	known := loadKnownClaudeAccounts()
	orgByUUID := claudePrimaryOrgByUUID()
	seen := map[string]bool{}
	var out []types.ToolAccount
	for _, desktop := range ClaudeDesktopAccounts() {
		uuid := desktop.AccountUUID
		if uuid == activeUUID || seen[uuid] {
			continue
		}
		seen[uuid] = true
		email, plan := claudeAccountIdentity(uuid, known)
		out = append(out, types.ToolAccount{
			ToolName:    "claude",
			AccountKey:  ClaudeAccountKey(uuid, email),
			Email:       email,
			Plan:        plan,
			OrgKey:      orgByUUID[uuid],
			LoginMethod: "desktop",
			AuthPresent: true,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AccountKey < out[j].AccountKey })
	return out
}

// ClaudeOtherAccountQuotas returns live quota windows for desktop logins other
// than the active Claude Code login, read from the desktop app's cached usage
// history and scoped to each login's organization. Each snapshot carries the
// account key so the control plane files it under the right login rather than
// the active one. Returns nil when no other login has fresh usage.
func ClaudeOtherAccountQuotas() []types.QuotaSnapshot {
	usageByOrg := ClaudeDesktopUsageByOrg()
	if len(usageByOrg) == 0 {
		return nil
	}
	home, _ := os.UserHomeDir()
	activeUUID, _ := activeClaudeAccount(home)
	known := loadKnownClaudeAccounts()

	// Map each non-active login's org to its account key from the plaintext
	// session-folder layout, so the usage history (keyed by org) can be filed
	// under the right login. Use the login's most-active org only.
	orgToKey := map[string]string{}
	for uuid, entry := range claudeBestDesktopEntryByUUID() {
		if uuid == activeUUID {
			continue
		}
		orgToKey[entry.OrgUUID] = ClaudeAccountKey(uuid, known[uuid].Email)
	}

	var out []types.QuotaSnapshot
	for org, snaps := range usageByOrg {
		key, ok := orgToKey[org]
		if !ok {
			continue
		}
		for _, snap := range snaps {
			snap.AccountKey = key
			out = append(out, snap)
		}
	}
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
		email, _ := claudeAccountIdentity(desktop.AccountUUID, known)
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
