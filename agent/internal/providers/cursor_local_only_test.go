package providers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/scan"
)

type countingTransport struct{ calls atomic.Int32 }

func (c *countingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	c.calls.Add(1)
	return nil, errors.New("no network in tests")
}

// The terminal tables say nothing left the machine. Cursor's billed usage
// lives on cursor.com, and the normal scan fetches it with the local Cursor
// login; a local-only scan must not.
func TestCursorLocalOnlyScanMakesNoRequest(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("USEJUNCTION_HOME", filepath.Join(home, ".usejunction"))
	if err := config.ApplyRuntimeProfile("", ""); err != nil {
		t.Fatal(err)
	}

	// A signed-in Cursor: its state database holds an access token.
	dbPath := filepath.Join(platformdirs.CursorUserDir(), "globalStorage", "state.vscdb")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"auth0|user_1"}`))
	if _, err := db.Exec(`CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO ItemTable (key, value) VALUES (?, ?)`, "cursorAuth/accessToken", "header."+claims+".signature"); err != nil {
		t.Fatal(err)
	}
	db.Close()

	transport := &countingTransport{}
	previous := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previous })

	provider := &CursorProvider{}
	if _, err := provider.ScanLocalUsage(scan.LocalOnly(context.Background()), true); err != nil {
		t.Fatal(err)
	}
	if calls := transport.calls.Load(); calls != 0 {
		t.Fatalf("a local-only scan made %d network requests", calls)
	}

	// The same machine without the mark does reach for the network, which is
	// what shows this test would catch a scan that ignored the mark.
	_, _ = provider.ScanLocalUsage(context.Background(), true)
	if transport.calls.Load() == 0 {
		t.Fatalf("the normal scan made no request, so this test proves nothing")
	}
}
