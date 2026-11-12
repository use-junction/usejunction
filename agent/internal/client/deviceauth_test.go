package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStartDeviceAuthReturnsCodesAndLink(t *testing.T) {
	var got DeviceAuthStartRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/device-auth/start" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "" {
			t.Errorf("sign-in must not send credentials, got %q", auth)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"deviceCode":"uj_device_secret","userCode":"KQRT-BXWM","verificationUrl":"https://usejunction.dev/connect?code=KQRT-BXWM","expiresIn":900,"interval":3}`))
	}))
	defer srv.Close()

	started, err := StartDeviceAuth(context.Background(), srv.URL+"/", DeviceAuthStartRequest{
		Hostname: "laptop", OS: "darwin", Architecture: "arm64", AgentVersion: "0.9.0",
	})
	if err != nil {
		t.Fatalf("StartDeviceAuth: %v", err)
	}
	if started.DeviceCode != "uj_device_secret" || started.UserCode != "KQRT-BXWM" || started.ExpiresIn != 900 || started.Interval != 3 {
		t.Fatalf("unexpected start response: %+v", started)
	}
	if got.Hostname != "laptop" || got.OS != "darwin" || got.AgentVersion != "0.9.0" {
		t.Fatalf("machine details not sent: %+v", got)
	}
}

func TestStartDeviceAuthOnAServerWithoutTerminalSignIn(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"no such route": func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) },
		// An older server bounces the unknown route to its HTML login page.
		"login page": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<!doctype html><html><body>Sign in</body></html>"))
		},
		"method not allowed": func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusMethodNotAllowed) },
	}
	for name, handler := range cases {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(handler)
			defer srv.Close()
			_, err := StartDeviceAuth(context.Background(), srv.URL, DeviceAuthStartRequest{})
			if !errors.Is(err, ErrDeviceAuthUnsupported) {
				t.Fatalf("want ErrDeviceAuthUnsupported, got %v", err)
			}
		})
	}
}

func TestStartDeviceAuthRefusesPlainHTTPToARemoteHost(t *testing.T) {
	if _, err := StartDeviceAuth(context.Background(), "http://example.com", DeviceAuthStartRequest{}); err == nil {
		t.Fatal("expected plain HTTP to a remote host to be refused")
	}
}

func TestPollDeviceAuthStates(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		body       string
		wantStatus string
		wantErr    error
		wantToken  string
	}{
		{name: "pending", status: 200, body: `{"status":"pending","interval":3}`, wantStatus: DeviceAuthPending},
		{name: "approved carries credentials", status: 200, body: `{"status":"approved","deviceId":"device_1","userId":"developer_1","orgId":"org_1","deviceToken":"uj_dev_token","otel":{"enabled":true,"metricsEndpoint":"https://usejunction.dev/api/otel/v1/metrics"}}`, wantStatus: DeviceAuthApproved, wantToken: "uj_dev_token"},
		{name: "denied", status: 200, body: `{"status":"denied"}`, wantStatus: DeviceAuthDenied},
		{name: "failed with a reason", status: 200, body: `{"status":"failed","error":"This user already has a device enrolled."}`, wantStatus: DeviceAuthFailed},
		{name: "unknown code reads as expired", status: 404, body: `{"error":"unknown device code"}`, wantStatus: DeviceAuthExpired},
		{name: "rate limited", status: 429, body: `{"error":"too many requests"}`, wantErr: ErrDeviceAuthSlowDown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]string
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["deviceCode"] != "uj_device_secret" {
					t.Errorf("device code not sent: %v", body)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()

			resp, err := PollDeviceAuth(context.Background(), srv.URL, "uj_device_secret")
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("want %v, got %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("PollDeviceAuth: %v", err)
			}
			if resp.Status != tc.wantStatus {
				t.Fatalf("status = %q, want %q", resp.Status, tc.wantStatus)
			}
			if resp.DeviceToken != tc.wantToken {
				t.Fatalf("device token = %q, want %q", resp.DeviceToken, tc.wantToken)
			}
			if tc.wantToken != "" && (resp.Otel == nil || resp.Otel.MetricsEndpoint == "" || resp.OrgID != "org_1") {
				t.Fatalf("approved response lost enrollment fields: %+v", resp)
			}
		})
	}
}
