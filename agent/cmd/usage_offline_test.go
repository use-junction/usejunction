package cmd

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/usejunction/agent/internal/config"
)

type refusingTransport struct{ calls atomic.Int32 }

func (r *refusingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	r.calls.Add(1)
	return nil, errors.New("no network in tests")
}

// The usage tables read local logs and nothing else. This runs each of them
// with the real scanners on a connected device and fails on any request: to
// the control plane (an upload) or to anywhere else.
func TestUsageCommandsMakeNoNetworkRequests(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("APPDATA", filepath.Join(home, "AppData", "Roaming"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, ".claude"))
	t.Setenv("CODEX_HOME", filepath.Join(home, ".codex"))
	t.Setenv("USEJUNCTION_HOME", filepath.Join(home, ".usejunction"))
	if err := config.ApplyRuntimeProfile("", ""); err != nil {
		t.Fatal(err)
	}

	var controlPlaneHits atomic.Int32
	controlPlane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		controlPlaneHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer controlPlane.Close()
	// Connected, so an upload would have somewhere to go.
	if err := config.Save(&config.Config{
		ControlPlaneURL: controlPlane.URL, DeviceToken: "uj_dev_test", DeviceID: "device-1", OrgID: "org-1", UserID: "user-1",
	}); err != nil {
		t.Fatal(err)
	}

	transport := &refusingTransport{}
	previousTransport := http.DefaultTransport
	http.DefaultTransport = transport
	previousFormat := format
	format = "text"
	t.Cleanup(func() {
		http.DefaultTransport = previousTransport
		format = previousFormat
		resetUsageFlags()
		rootCmd.SetOut(nil)
		rootCmd.SetIn(nil)
		rootCmd.SetArgs(nil)
	})

	for _, args := range [][]string{{}, {"daily"}, {"weekly"}, {"monthly", "--breakdown"}, {"today"}, {"week"}, {"month"}, {"daily", "--last", "7"}, {"session"}, {"blocks"}, {"statusline"}, {"daily", "--json"}} {
		resetUsageFlags()
		var out bytes.Buffer
		rootCmd.SetOut(&out)
		rootCmd.SetIn(strings.NewReader(`{"session_id":"none"}`))
		rootCmd.SetArgs(append([]string{}, args...))
		if err := rootCmd.Execute(); err != nil {
			t.Fatalf("usejunction %s: %v", strings.Join(args, " "), err)
		}
		if out.Len() == 0 {
			t.Errorf("usejunction %s printed nothing", strings.Join(args, " "))
		}
		if calls := transport.calls.Load(); calls != 0 {
			t.Fatalf("usejunction %s made %d network requests", strings.Join(args, " "), calls)
		}
		if hits := controlPlaneHits.Load(); hits != 0 {
			t.Fatalf("usejunction %s reached the control plane %d times", strings.Join(args, " "), hits)
		}
	}
}
