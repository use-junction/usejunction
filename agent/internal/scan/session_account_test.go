package scan

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/config/configtest"
)

func writeClaudeSession(t *testing.T, dir, sessionID string, output int) {
	t.Helper()
	ts := time.Now().UTC().Format(time.RFC3339)
	line := fmt.Sprintf(`{"type":"assistant","requestId":"%s","timestamp":"%s","message":{"id":"m-%s","model":"claude-opus-5","usage":{"input_tokens":10,"output_tokens":%d}}}`,
		sessionID, ts, sessionID, output)
	if err := os.WriteFile(filepath.Join(dir, sessionID+".jsonl"), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func outputByAccount(t *testing.T, root string) string {
	t.Helper()
	rows, err := ScanClaude([]string{root}, false)
	if err != nil {
		t.Fatal(err)
	}
	totals := map[string]int{}
	for _, row := range rows {
		totals[row.AccountKey] += row.OutputTokens
	}
	var parts []string
	for key, total := range totals {
		parts = append(parts, fmt.Sprintf("%s=%d", key, total))
	}
	sort.Strings(parts)
	return strings.Join(parts, " ")
}

func TestSessionAccountHintsReattributeSavedFiles(t *testing.T) {
	configtest.WithIsolatedHome(t)
	if err := os.MkdirAll(configtest.CacheDir(t), 0o700); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "projects")
	project := filepath.Join(root, "-repo")
	if err := os.MkdirAll(project, 0o700); err != nil {
		t.Fatal(err)
	}
	writeClaudeSession(t, project, "sess-personal", 5)
	writeClaudeSession(t, project, "sess-work", 7)

	SetSignedInAccount("claude", "me@gmail.com")
	t.Cleanup(func() {
		SetSignedInAccount("claude", "")
		SetSessionAccounts("claude", nil)
	})

	// Before the desktop mapping is known, every file lands on the active login.
	if got := outputByAccount(t, root); got != "me@gmail.com=12" {
		t.Fatalf("first scan = %q", got)
	}

	// The mapping overrides the saved first-seen account without a forced rescan.
	SetSessionAccounts("claude", map[string]string{
		"sess-personal": "me@gmail.com",
		"sess-work":     "claude:work-uuid",
	})
	if got := outputByAccount(t, root); got != "claude:work-uuid=7 me@gmail.com=5" {
		t.Fatalf("after hints = %q", got)
	}
}

func TestSessionAccountHintMatchesSubagentLogs(t *testing.T) {
	SetSessionAccounts("claude", map[string]string{"sess-1": "a@x.dev"})
	t.Cleanup(func() { SetSessionAccounts("claude", nil) })
	for path, want := range map[string]string{
		"/p/-repo/sess-1.jsonl":                     "a@x.dev",
		"/p/-repo/sess-1/subagents/agent-abc.jsonl": "a@x.dev",
		"/p/-repo/sess-2.jsonl":                     "",
	} {
		if got := SessionAccountHint("claude", path); got != want {
			t.Errorf("%s = %q, want %q", path, got, want)
		}
	}
	if got := SessionAccountHint("codex", "/p/-repo/sess-1.jsonl"); got != "" {
		t.Errorf("other tools must not use claude hints, got %q", got)
	}
}
