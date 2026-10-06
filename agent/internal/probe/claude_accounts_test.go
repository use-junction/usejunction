package probe

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/usejunction/agent/internal/config/configtest"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestClaudeDesktopAccountsReadsSessionOwners(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "acct-1", "org-a", "local_1.json"), `{"cliSessionId":"s1","priorCliSessionIds":["s0"]}`)
	writeFile(t, filepath.Join(root, "acct-1", "org-a", "scheduled-tasks.json"), `{"scheduledTasks":[]}`)
	writeFile(t, filepath.Join(root, "acct-2", "org-b", "local_2.json"), `{"cliSessionId":"s2"}`)
	writeFile(t, filepath.Join(root, ".DS_Store"), "")

	accounts := claudeDesktopAccountsIn(root)
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].AccountUUID < accounts[j].AccountUUID })
	var got []string
	for _, a := range accounts {
		sort.Strings(a.SessionIDs)
		got = append(got, a.AccountUUID+"/"+a.OrgUUID+":"+strings.Join(a.SessionIDs, ","))
	}
	if want := "acct-1/org-a:s0,s1 acct-2/org-b:s2"; strings.Join(got, " ") != want {
		t.Fatalf("accounts = %v, want %s", got, want)
	}
}

func TestRememberClaudeAccountNamesLaterLogins(t *testing.T) {
	configtest.WithIsolatedHome(t)
	if got := ClaudeAccountKey("uuid-2", ""); got != "claude:uuid-2" {
		t.Fatalf("unknown key = %q", got)
	}
	rememberClaudeAccount("uuid-2", "Work@Acme.dev", "team")
	known := loadKnownClaudeAccounts()["uuid-2"]
	if known.Email != "work@acme.dev" || known.Plan != "team" {
		t.Fatalf("remembered = %+v", known)
	}
	if got := ClaudeAccountKey("uuid-2", known.Email); got != "work@acme.dev" {
		t.Fatalf("known key = %q", got)
	}
}
