package cmd

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/usejunction/agent/internal/accountpolicy"
	"github.com/usejunction/agent/internal/config/configtest"
	"github.com/usejunction/agent/internal/probe"
)

func TestSelectionFromSpec(t *testing.T) {
	accounts := []accountpolicy.Account{
		{ToolName: "cursor", AccountKey: "c1", Email: "me@gmail.com"},
		{ToolName: "codex", AccountKey: "x1", Email: "me@gmail.com"},
		{ToolName: "cursor", AccountKey: "c2", Email: "me@acme.dev"},
	}
	cases := map[string][]bool{
		"all":                       {true, true, true},
		"none":                      {false, false, false},
		"Me@Gmail.com":              {true, true, false},
		"codex":                     {false, true, false},
		"cursor:me@acme.dev":        {false, false, true},
		"codex, cursor:me@acme.dev": {false, true, true},
	}
	for spec, want := range cases {
		got := selectionFromSpec(accounts, spec)
		for i, account := range accounts {
			if got[pickerAccountID(account)] != want[i] {
				t.Errorf("spec %q: %s/%s = %v, want %v", spec, account.ToolName, account.Email, got[pickerAccountID(account)], want[i])
			}
		}
	}
}

func writeTestFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// claudeTestHome lays out an active Claude Code login plus a second login that
// only the desktop app knows about.
func claudeTestHome(t *testing.T) {
	t.Helper()
	configtest.WithIsolatedHome(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	writeTestFile(t, filepath.Join(home, ".claude.json"),
		`{"oauthAccount":{"accountUuid":"active-uuid","emailAddress":"me@gmail.com","organizationType":"claude_pro"}}`)
	sessions := filepath.Join(home, "Library", "Application Support", "Claude", "claude-code-sessions")
	if runtime.GOOS != "darwin" {
		sessions = filepath.Join(home, ".config", "Claude", "claude-code-sessions")
	}
	writeTestFile(t, filepath.Join(sessions, "active-uuid", "org-a", "local_1.json"), `{"cliSessionId":"s1"}`)
	writeTestFile(t, filepath.Join(sessions, "other-uuid", "org-b", "local_2.json"), `{"cliSessionId":"s2"}`)
}

func TestLinkClaudeLoginsUsesTheOneOrphanEmail(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("desktop path differs on windows")
	}
	claudeTestHome(t)
	linkClaudeLogins(&accountpolicy.Policy{Accounts: []accountpolicy.Account{
		{ToolName: "claude", AccountKey: "me@gmail.com", Email: "me@gmail.com"},
		{ToolName: "claude", AccountKey: "claude:other-uuid"},
		{ToolName: "claude", AccountKey: "work@acme.dev", Email: "work@acme.dev", Plan: "team-standard"},
		{ToolName: "cursor", AccountKey: "cursor@x.dev", Email: "cursor@x.dev"},
	}})
	others := probe.ClaudeOtherAccounts()
	if len(others) != 1 || others[0].Email != "work@acme.dev" || others[0].Plan != "team-standard" || others[0].AccountKey != "work@acme.dev" {
		t.Fatalf("other logins = %+v", others)
	}
	if got := probe.ClaudeSessionAccountKeys()["s2"]; got != "work@acme.dev" {
		t.Fatalf("session s2 key = %q", got)
	}
}

func TestLinkClaudeLoginsDoesNotGuessBetweenEmails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("desktop path differs on windows")
	}
	claudeTestHome(t)
	linkClaudeLogins(&accountpolicy.Policy{Accounts: []accountpolicy.Account{
		{ToolName: "claude", AccountKey: "a@acme.dev", Email: "a@acme.dev"},
		{ToolName: "claude", AccountKey: "b@acme.dev", Email: "b@acme.dev"},
	}})
	if others := probe.ClaudeOtherAccounts(); len(others) != 1 || others[0].Email != "" {
		t.Fatalf("ambiguous emails must stay unnamed, got %+v", others)
	}
}
