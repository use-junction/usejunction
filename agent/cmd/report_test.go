package cmd

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/client"
)

func TestClassifyCollect(t *testing.T) {
	cases := []struct {
		name      string
		timedOut  bool
		err       error
		want      string
		retrySoon bool
	}{
		{"success", false, nil, "ok", false},
		{"queued", false, errUsageQueuePending, "queued", true},
		{"timeout", true, context.DeadlineExceeded, "timeout", true},
		{"failed", false, errors.New("boom"), "failed", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, retrySoon := classifyCollect(tc.timedOut, tc.err)
			if status != tc.want {
				t.Fatalf("status = %q, want %q", status, tc.want)
			}
			if retrySoon != tc.retrySoon {
				t.Fatalf("retrySoon = %v, want %v", retrySoon, tc.retrySoon)
			}
		})
	}
}

func TestCollectStatusReportOnce(t *testing.T) {
	var c collectStatus

	// Nothing set yet: nothing to report.
	if got, _ := c.pending(); got != nil {
		t.Fatal("expected no pending status before any collect")
	}

	c.set("failed", 2*time.Second, "network down", []string{"w1"})
	got, gen := c.pending()
	if got == nil || got.Status != "failed" || got.Error != "network down" {
		t.Fatalf("unexpected pending status: %#v", got)
	}

	// Still pending until explicitly reported (so a failed heartbeat retries).
	if again, _ := c.pending(); again == nil {
		t.Fatal("status must stay pending until reported")
	}

	c.markReported(gen)
	if after, _ := c.pending(); after != nil {
		t.Fatal("status must not be re-reported once acknowledged")
	}

	// A newer collect supersedes the reported generation.
	c.set("ok", time.Second, "", nil)
	if fresh, freshGen := c.pending(); fresh == nil || fresh.Status != "ok" || freshGen <= gen {
		t.Fatalf("expected a fresh pending status after a new collect, got %#v gen %d", fresh, freshGen)
	}
}

func TestCollectStatusWarningsCapped(t *testing.T) {
	var c collectStatus
	warnings := make([]string, 20)
	for i := range warnings {
		warnings[i] = "w"
	}
	c.set("failed", time.Second, "boom", warnings)
	got, _ := c.pending()
	if got == nil {
		t.Fatal("expected pending status")
	}
	if len(got.Warnings) != 8 {
		t.Fatalf("warnings = %d, want capped at 8", len(got.Warnings))
	}
}

func TestHeartbeatRequestsRemoteSync(t *testing.T) {
	if heartbeatRequestsRemoteSync(nil) {
		t.Fatal("nil response must not request remote sync")
	}
	if heartbeatRequestsRemoteSync(&client.HeartbeatResponse{}) {
		t.Fatal("empty response must not request remote sync")
	}
	if !heartbeatRequestsRemoteSync(&client.HeartbeatResponse{PendingRemoteSync: true}) {
		t.Fatal("pending remote sync must request a claim")
	}
	if !heartbeatRequestsRemoteSync(&client.HeartbeatResponse{FeaturesAuthorSync: true}) {
		t.Fatal("mapped GitHub author must poll for Features usage sync")
	}
}

func TestNoteFeaturesAuthorSync(t *testing.T) {
	var flag atomic.Bool
	noteFeaturesAuthorSync(&client.HeartbeatResponse{FeaturesAuthorSync: true}, &flag)
	if !flag.Load() {
		t.Fatal("expected Features author flag to be set")
	}
	noteFeaturesAuthorSync(&client.HeartbeatResponse{}, &flag)
	if flag.Load() {
		t.Fatal("expected Features author flag to clear when the heartbeat drops it")
	}
}
