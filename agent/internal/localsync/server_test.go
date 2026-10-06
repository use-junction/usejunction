package localsync

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/config"
)

func TestOriginAllowed(t *testing.T) {
	s := New(&config.Config{ControlPlaneURL: "https://app.usejunction.com"}, func(context.Context, bool, ProgressFunc) (int, int, int, int, []string, error) {
		return 0, 0, 0, 0, nil, nil
	})
	if !s.originAllowed("https://app.usejunction.com") {
		t.Fatal("control plane origin should be allowed")
	}
	if !s.originAllowed("http://localhost:3001") {
		t.Fatal("local admin origin should be allowed")
	}
	if !s.originAllowed("http://localhost:3002") {
		t.Fatal("any localhost development port should be allowed")
	}
	if !s.originAllowed("http://127.0.0.1:5173") {
		t.Fatal("any loopback development port should be allowed")
	}
	if s.originAllowed("https://evil.example") {
		t.Fatal("foreign origin must be denied")
	}
}

func TestAuthorizeBearer(t *testing.T) {
	s := New(&config.Config{LocalSyncToken: "uj_local_secret"}, func(context.Context, bool, ProgressFunc) (int, int, int, int, []string, error) {
		return 1, 2, 3, 4, nil, nil
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/sync", nil)
	req.Header.Set("Authorization", "Bearer uj_local_secret")
	if !s.authorize(req) {
		t.Fatal("expected bearer auth to pass")
	}
	req.Header.Set("Authorization", "Bearer wrong")
	if s.authorize(req) {
		t.Fatal("expected bearer auth to fail")
	}
}

func TestHealthReportsBackgroundSyncProtocol(t *testing.T) {
	s := New(&config.Config{DeviceID: "device-1", LocalSyncToken: "uj_local_secret"}, func(context.Context, bool, ProgressFunc) (int, int, int, int, []string, error) {
		return 0, 0, 0, 0, nil, nil
	})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	res := httptest.NewRecorder()
	s.handleHealth(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["syncProtocol"] != float64(config.LocalSyncProtocol) {
		t.Fatalf("expected syncProtocol=%d, got %#v", config.LocalSyncProtocol, body["syncProtocol"])
	}
}

func TestSyncStartsBackgroundJobAndStatusCompletes(t *testing.T) {
	done := make(chan struct{})
	s := New(&config.Config{LocalSyncToken: "uj_local_secret"}, func(ctx context.Context, refresh bool, progress ProgressFunc) (int, int, int, int, []string, error) {
		progress("scan", "Scanning tools")
		<-done
		return 1, 2, 3, 4, nil, nil
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/sync?refresh=1", nil)
	req.Header.Set("Authorization", "Bearer uj_local_secret")
	res := httptest.NewRecorder()
	s.handleSync(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", res.Code)
	}
	var started map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	if started["status"] != "running" {
		t.Fatalf("expected running job, got %#v", started)
	}
	jobID, _ := started["jobId"].(string)
	if jobID == "" {
		t.Fatal("expected job id")
	}

	close(done)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		statusReq := httptest.NewRequest(http.MethodGet, "/v1/sync/status?jobId="+jobID, nil)
		statusReq.Header.Set("Authorization", "Bearer uj_local_secret")
		statusRes := httptest.NewRecorder()
		s.handleSyncStatus(statusRes, statusReq)
		if statusRes.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", statusRes.Code)
		}
		var status map[string]any
		if err := json.Unmarshal(statusRes.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		if status["status"] == "succeeded" {
			if status["usageRows"] != float64(4) {
				t.Fatalf("expected usageRows=4, got %#v", status["usageRows"])
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("job did not complete")
}

func TestConcurrentSyncAttachesToActiveJob(t *testing.T) {
	block := make(chan struct{})
	s := New(&config.Config{LocalSyncToken: "uj_local_secret"}, func(ctx context.Context, refresh bool, progress ProgressFunc) (int, int, int, int, []string, error) {
		<-block
		return 0, 0, 0, 0, nil, nil
	})
	defer close(block)

	firstReq := httptest.NewRequest(http.MethodPost, "/v1/sync?refresh=1", nil)
	firstReq.Header.Set("Authorization", "Bearer uj_local_secret")
	firstRes := httptest.NewRecorder()
	s.handleSync(firstRes, firstReq)
	var first map[string]any
	_ = json.Unmarshal(firstRes.Body.Bytes(), &first)

	secondReq := httptest.NewRequest(http.MethodPost, "/v1/sync?refresh=1", nil)
	secondReq.Header.Set("Authorization", "Bearer uj_local_secret")
	secondRes := httptest.NewRecorder()
	s.handleSync(secondRes, secondReq)
	var second map[string]any
	_ = json.Unmarshal(secondRes.Body.Bytes(), &second)

	if first["jobId"] == "" || first["jobId"] != second["jobId"] {
		t.Fatalf("expected same active job, got first=%#v second=%#v", first["jobId"], second["jobId"])
	}
}

func TestSyncStatusUnauthorized(t *testing.T) {
	s := New(&config.Config{LocalSyncToken: "uj_local_secret"}, func(context.Context, bool, ProgressFunc) (int, int, int, int, []string, error) {
		return 0, 0, 0, 0, nil, nil
	})
	req := httptest.NewRequest(http.MethodGet, "/v1/sync/status", nil)
	res := httptest.NewRecorder()
	s.handleSyncStatus(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.Code)
	}
}

func TestFailedSyncKeepsErrorGeneric(t *testing.T) {
	done := make(chan struct{})
	s := New(&config.Config{LocalSyncToken: "uj_local_secret"}, func(ctx context.Context, refresh bool, progress ProgressFunc) (int, int, int, int, []string, error) {
		<-done
		return 0, 0, 0, 0, nil, fmt.Errorf(`usage: POST /api/ingest/sync/usage/chunk returned 413: {"error":"maximum 1000 aggregates per request"}`)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/sync?refresh=1", nil)
	req.Header.Set("Authorization", "Bearer uj_local_secret")
	res := httptest.NewRecorder()
	s.handleSync(res, req)
	var started map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	jobID, _ := started["jobId"].(string)
	if jobID == "" {
		t.Fatalf("expected jobId, got %#v", started)
	}
	close(done)

	deadline := time.Now().Add(2 * time.Second)
	for {
		statusReq := httptest.NewRequest(http.MethodGet, "/v1/sync/status?jobId="+jobID, nil)
		statusReq.Header.Set("Authorization", "Bearer uj_local_secret")
		statusRes := httptest.NewRecorder()
		s.handleSyncStatus(statusRes, statusReq)
		var body map[string]any
		_ = json.Unmarshal(statusRes.Body.Bytes(), &body)
		if body["status"] == "failed" {
			if body["error"] != "Sync failed" {
				t.Fatalf("expected generic error, got %#v", body["error"])
			}
			if body["message"] != "Sync failed" {
				t.Fatalf("expected generic message, got %#v", body["message"])
			}
			detail, _ := body["error"].(string)
			if strings.Contains(detail, "413") || strings.Contains(detail, "local-usage") {
				t.Fatalf("leaked technical detail: %#v", detail)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for failed job, last=%#v", body)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestAccountsRequiresTokenAndACompletePatch(t *testing.T) {
	s := New(&config.Config{LocalSyncToken: "uj_local_secret"}, func(context.Context, bool, ProgressFunc) (int, int, int, int, []string, error) {
		return 0, 0, 0, 0, nil, nil
	})

	denied := httptest.NewRequest(http.MethodGet, "/v1/accounts", nil)
	deniedRes := httptest.NewRecorder()
	s.handleAccounts(deniedRes, denied)
	if deniedRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", deniedRes.Code)
	}

	page := httptest.NewRequest(http.MethodGet, "/v1/accounts?token=uj_local_secret", nil)
	page.Header.Set("Accept", "text/html")
	pageRes := httptest.NewRecorder()
	s.handleAccounts(pageRes, page)
	if pageRes.Code != http.StatusOK || !strings.Contains(pageRes.Body.String(), "UseJunction accounts") {
		t.Fatalf("expected accounts page, got %d %s", pageRes.Code, pageRes.Body.String())
	}

	missing := httptest.NewRequest(http.MethodPatch, "/v1/accounts?token=uj_local_secret", strings.NewReader(`{"scope":"provider","enabled":true}`))
	missingRes := httptest.NewRecorder()
	s.handleAccounts(missingRes, missing)
	if missingRes.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing toolName, got %d", missingRes.Code)
	}

	bad := httptest.NewRequest(http.MethodPatch, "/v1/accounts?token=uj_local_secret", strings.NewReader(`{`))
	badRes := httptest.NewRecorder()
	s.handleAccounts(badRes, bad)
	if badRes.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid json, got %d", badRes.Code)
	}

	other := httptest.NewRequest(http.MethodPost, "/v1/accounts?token=uj_local_secret", nil)
	otherRes := httptest.NewRecorder()
	s.handleAccounts(otherRes, other)
	if otherRes.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", otherRes.Code)
	}
}
