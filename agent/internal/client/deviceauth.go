package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/controlurl"
)

// Sign-in from the terminal: the agent starts a request, the person approves a
// short code in the browser, and the agent polls until the control plane hands
// over device credentials. No Bearer token is involved until then.

// ErrDeviceAuthUnsupported means the control plane predates terminal sign-in.
var ErrDeviceAuthUnsupported = errors.New("this UseJunction server does not support signing in from the terminal")

// Poll statuses returned by the control plane.
const (
	DeviceAuthPending  = "pending"
	DeviceAuthApproved = "approved"
	DeviceAuthDenied   = "denied"
	DeviceAuthExpired  = "expired"
	DeviceAuthConsumed = "consumed"
	DeviceAuthFailed   = "failed"
)

type DeviceAuthStartRequest struct {
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
	AgentVersion string `json:"agentVersion"`
}

type DeviceAuthStartResponse struct {
	// DeviceCode is this agent's secret; it is never shown to the person.
	DeviceCode string `json:"deviceCode"`
	// UserCode is the short code the person confirms in the browser.
	UserCode        string `json:"userCode"`
	VerificationURL string `json:"verificationUrl"`
	// ExpiresIn and Interval are in seconds.
	ExpiresIn int `json:"expiresIn"`
	Interval  int `json:"interval"`
}

// DeviceAuthPollResponse carries the request's state and, once approved, the
// same credentials a token enrollment returns.
type DeviceAuthPollResponse struct {
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	Interval int    `json:"interval,omitempty"`
	EnrollResponse
}

func deviceAuthPost(ctx context.Context, baseURL, path string, body any) (int, []byte, error) {
	if err := controlurl.Validate(baseURL); err != nil {
		return 0, nil, err
	}
	data, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+path, bytes.NewReader(data))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, raw, nil
}

func deviceAuthErrorMessage(raw []byte) string {
	var errResp struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &errResp) == nil && errResp.Error != "" {
		return errResp.Error
	}
	msg := strings.TrimSpace(string(raw))
	if len(msg) > 200 || strings.HasPrefix(msg, "<") {
		return "unexpected response"
	}
	return msg
}

// StartDeviceAuth asks the control plane for a sign-in request for this machine.
func StartDeviceAuth(ctx context.Context, baseURL string, req DeviceAuthStartRequest) (*DeviceAuthStartResponse, error) {
	status, raw, err := deviceAuthPost(ctx, baseURL, "/api/device-auth/start", req)
	if err != nil {
		return nil, err
	}
	// Older servers have no such route: a 404, or a redirect to their login page.
	if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
		return nil, ErrDeviceAuthUnsupported
	}
	if status >= 300 {
		return nil, fmt.Errorf("could not start sign-in (%d): %s", status, deviceAuthErrorMessage(raw))
	}
	var out DeviceAuthStartResponse
	if err := json.Unmarshal(raw, &out); err != nil || out.DeviceCode == "" || out.VerificationURL == "" {
		return nil, ErrDeviceAuthUnsupported
	}
	return &out, nil
}

// ErrDeviceAuthSlowDown means the control plane rate-limited this poll.
var ErrDeviceAuthSlowDown = errors.New("polling too fast")

// PollDeviceAuth asks whether the request behind deviceCode has been approved.
func PollDeviceAuth(ctx context.Context, baseURL, deviceCode string) (*DeviceAuthPollResponse, error) {
	status, raw, err := deviceAuthPost(ctx, baseURL, "/api/device-auth/poll", map[string]string{"deviceCode": deviceCode})
	if err != nil {
		return nil, err
	}
	if status == http.StatusTooManyRequests {
		return nil, ErrDeviceAuthSlowDown
	}
	if status == http.StatusNotFound {
		return &DeviceAuthPollResponse{Status: DeviceAuthExpired}, nil
	}
	if status >= 300 {
		return nil, fmt.Errorf("sign-in check failed (%d): %s", status, deviceAuthErrorMessage(raw))
	}
	var out DeviceAuthPollResponse
	if err := json.Unmarshal(raw, &out); err != nil || out.Status == "" {
		return nil, fmt.Errorf("invalid sign-in response")
	}
	return &out, nil
}
