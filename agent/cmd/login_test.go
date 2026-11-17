package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/config"
)

func noSleep(ctx context.Context, d time.Duration) error { return ctx.Err() }

func scriptedPoller(t *testing.T, steps ...any) (deviceAuthPoller, *int) {
	t.Helper()
	calls := 0
	return func(ctx context.Context) (*client.DeviceAuthPollResponse, error) {
		if calls >= len(steps) {
			t.Fatalf("polled %d times, only %d scripted", calls+1, len(steps))
		}
		step := steps[calls]
		calls++
		switch v := step.(type) {
		case error:
			return nil, v
		case string:
			return &client.DeviceAuthPollResponse{Status: v}, nil
		case *client.DeviceAuthPollResponse:
			return v, nil
		}
		t.Fatalf("bad scripted step %T", step)
		return nil, nil
	}, &calls
}

func approved() *client.DeviceAuthPollResponse {
	return &client.DeviceAuthPollResponse{
		Status: client.DeviceAuthApproved,
		EnrollResponse: client.EnrollResponse{
			DeviceID: "device_1", UserID: "developer_1", OrgID: "org_1", DeviceToken: "uj_dev_token",
		},
	}
}

func TestWaitForDeviceApprovalKeepsPollingUntilApproved(t *testing.T) {
	poll, calls := scriptedPoller(t, client.DeviceAuthPending, client.DeviceAuthPending, approved())
	resp, err := waitForDeviceApproval(context.Background(), poll, time.Second, time.Minute, noSleep)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.DeviceToken != "uj_dev_token" || resp.OrgID != "org_1" {
		t.Fatalf("credentials not returned: %+v", resp)
	}
	if *calls != 3 {
		t.Fatalf("polled %d times, want 3", *calls)
	}
}

func TestWaitForDeviceApprovalStopsOnTerminalStates(t *testing.T) {
	cases := []struct {
		name string
		step any
		want string
	}{
		{"refused in the browser", client.DeviceAuthDenied, "refused in the browser"},
		{"code expired", client.DeviceAuthExpired, "expired before it was approved"},
		{"already completed", client.DeviceAuthConsumed, "already completed"},
		{
			"one device per person",
			&client.DeviceAuthPollResponse{Status: client.DeviceAuthFailed, Error: "This user already has a device enrolled."},
			"remove it under My devices",
		},
		{"approved without credentials", &client.DeviceAuthPollResponse{Status: client.DeviceAuthApproved}, "no device credentials"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			poll, calls := scriptedPoller(t, client.DeviceAuthPending, tc.step)
			_, err := waitForDeviceApproval(context.Background(), poll, time.Second, time.Minute, noSleep)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want it to mention %q", err, tc.want)
			}
			if *calls != 2 {
				t.Fatalf("kept polling after a terminal state: %d calls", *calls)
			}
		})
	}
}

func TestWaitForDeviceApprovalRidesOutBriefNetworkFailures(t *testing.T) {
	flaky := errors.New("connection reset")
	poll, _ := scriptedPoller(t, flaky, flaky, client.DeviceAuthPending, flaky, approved())
	if _, err := waitForDeviceApproval(context.Background(), poll, time.Second, time.Minute, noSleep); err != nil {
		t.Fatalf("brief failures should be retried: %v", err)
	}

	steps := make([]any, deviceAuthMaxPollErrors)
	for i := range steps {
		steps[i] = flaky
	}
	poll, _ = scriptedPoller(t, steps...)
	_, err := waitForDeviceApproval(context.Background(), poll, time.Second, time.Minute, noSleep)
	if err == nil || !strings.Contains(err.Error(), "lost contact") {
		t.Fatalf("error = %v, want lost contact after %d failures in a row", err, deviceAuthMaxPollErrors)
	}
}

func TestWaitForDeviceApprovalSlowsDownWhenAsked(t *testing.T) {
	var waits []time.Duration
	sleep := func(ctx context.Context, d time.Duration) error {
		waits = append(waits, d)
		return nil
	}
	poll, _ := scriptedPoller(t, client.ErrDeviceAuthSlowDown, approved())
	if _, err := waitForDeviceApproval(context.Background(), poll, 3*time.Second, time.Minute, sleep); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(waits) != 2 || waits[0] != 3*time.Second || waits[1] != 6*time.Second {
		t.Fatalf("waits = %v, want [3s 6s]", waits)
	}
}

func TestWaitForDeviceApprovalGivesUpWhenTheCodeHasExpiredLocally(t *testing.T) {
	poll, calls := scriptedPoller(t, client.DeviceAuthPending)
	_, err := waitForDeviceApproval(context.Background(), poll, time.Second, time.Nanosecond, func(ctx context.Context, d time.Duration) error {
		time.Sleep(time.Millisecond)
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("error = %v, want expiry", err)
	}
	if *calls != 1 {
		t.Fatalf("polled %d times after the deadline", *calls)
	}
}

func TestWaitForDeviceApprovalStopsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	poll, calls := scriptedPoller(t)
	if _, err := waitForDeviceApproval(ctx, poll, time.Second, time.Minute, noSleep); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if *calls != 0 {
		t.Fatal("polled after cancellation")
	}
}

func TestResolveLoginURL(t *testing.T) {
	t.Setenv("USEJUNCTION_URL", "")
	if got := resolveLoginURL("https://junction.example.com/"); got != "https://junction.example.com" {
		t.Fatalf("flag: got %q", got)
	}
	t.Setenv("USEJUNCTION_URL", "https://self-hosted.example.com/")
	if got := resolveLoginURL(""); got != "https://self-hosted.example.com" {
		t.Fatalf("env: got %q", got)
	}
}

// The whole terminal half against a stand-in control plane: start, show the
// link, poll until approved, save credentials.
func TestDoLoginSavesTheCredentialsTheBrowserApproved(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USEJUNCTION_HOME", filepath.Join(home, ".usejunction"))
	t.Setenv("USEJUNCTION_URL", "")
	if err := config.ApplyRuntimeProfile("", ""); err != nil {
		t.Fatal(err)
	}

	var polls atomic.Int32
	var started client.DeviceAuthStartRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/device-auth/start":
			_ = json.NewDecoder(r.Body).Decode(&started)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"deviceCode":"uj_device_secret","userCode":"KQRT-BXWM","verificationUrl":"http://example.test/connect?code=KQRT-BXWM","expiresIn":900,"interval":0}`))
		case "/api/device-auth/poll":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["deviceCode"] != "uj_device_secret" {
				t.Errorf("polled with %q", body["deviceCode"])
			}
			if polls.Add(1) < 3 {
				_, _ = w.Write([]byte(`{"status":"pending","interval":0}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"approved","deviceId":"device_1","userId":"developer_1","orgId":"org_1","deviceToken":"uj_dev_token","otel":{"enabled":true,"metricsEndpoint":"http://example.test/api/otel/v1/metrics"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	previousInterval, previousOpen, previousFormat := deviceAuthMinInterval, openBrowser, format
	deviceAuthMinInterval = time.Millisecond
	var opened string
	openBrowser = func(url string) error {
		opened = url
		return nil
	}
	format = "json" // keep terminal styling out of the test output
	defer func() {
		deviceAuthMinInterval, openBrowser, format = previousInterval, previousOpen, previousFormat
	}()

	res, err := doLogin(context.Background(), loginOptions{URL: srv.URL})
	if err != nil {
		t.Fatalf("doLogin: %v", err)
	}

	if opened != "http://example.test/connect?code=KQRT-BXWM" {
		t.Fatalf("browser opened %q", opened)
	}
	if started.Hostname == "" || started.OS == "" || started.AgentVersion != config.Version {
		t.Fatalf("machine details not sent: %+v", started)
	}
	if polls.Load() != 3 {
		t.Fatalf("polled %d times, want 3", polls.Load())
	}
	if res.cfg.DeviceToken != "uj_dev_token" || res.cfg.OrgID != "org_1" || res.cfg.ControlPlaneURL != srv.URL {
		t.Fatalf("unexpected config: %+v", res.cfg)
	}

	saved, err := config.Load()
	if err != nil {
		t.Fatalf("config not saved: %v", err)
	}
	if saved.DeviceToken != "uj_dev_token" || saved.DeviceID != "device_1" || saved.UserID != "developer_1" {
		t.Fatalf("saved config = %+v", saved)
	}
	if saved.CollectionNoticeVersion != CollectionNoticeVersion {
		t.Fatalf("notice version = %q, want %q (approved in the browser)", saved.CollectionNoticeVersion, CollectionNoticeVersion)
	}
	if !saved.OtelEnabled || saved.OtelMetricsEndpoint == "" {
		t.Fatalf("otel settings not saved: %+v", saved)
	}
	if alreadyConnected() == nil {
		t.Fatal("a signed-in device should read as already connected")
	}
}

func TestDoLoginExplainsAServerThatCannotSignInFromTheTerminal(t *testing.T) {
	t.Setenv("USEJUNCTION_URL", "")
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()

	previousFormat := format
	format = "json"
	defer func() { format = previousFormat }()

	_, err := doLogin(context.Background(), loginOptions{URL: srv.URL, NoBrowser: true})
	if !errors.Is(err, client.ErrDeviceAuthUnsupported) {
		t.Fatalf("error = %v, want ErrDeviceAuthUnsupported", err)
	}
	if !strings.Contains(err.Error(), "copy the install command with your token") {
		t.Fatalf("error should say what to do instead: %v", err)
	}
}
