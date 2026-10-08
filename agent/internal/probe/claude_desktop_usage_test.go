package probe

import (
	"fmt"
	"testing"
	"time"
)

func TestParseClaudeDesktopUsageLatestFreshSample(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	older := now.Add(-2 * time.Hour).UnixMilli()
	newest := now.Add(-10 * time.Minute).UnixMilli()
	data := []byte(fmt.Sprintf(`{"version":1,"samples":[
		{"t":%d,"org":"org-a","u":{"fh":10,"sd":2}},
		{"t":%d,"org":"org-a","u":{"fh":62,"sd":18}}
	]}`, older, newest))

	snaps := parseClaudeDesktopUsage(data, now)
	if len(snaps) != 2 {
		t.Fatalf("expected 2 snapshots, got %d: %+v", len(snaps), snaps)
	}

	byWindow := map[string]float64{}
	for _, s := range snaps {
		if s.Source != claudeDesktopUsageSource {
			t.Errorf("window %s: source = %q, want %q", s.WindowType, s.Source, claudeDesktopUsageSource)
		}
		if s.ToolName != "claude" {
			t.Errorf("window %s: tool = %q, want claude", s.WindowType, s.ToolName)
		}
		if s.UsedPercent == nil {
			t.Fatalf("window %s: nil used percent", s.WindowType)
		}
		byWindow[s.WindowType] = *s.UsedPercent
	}
	if got := byWindow["session_5h"]; got != 62 {
		t.Errorf("session_5h = %v, want 62 (newest sample)", got)
	}
	if got := byWindow["weekly"]; got != 18 {
		t.Errorf("weekly = %v, want 18 (newest sample)", got)
	}
}

func TestParseClaudeDesktopUsageStaleReturnsNil(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-(claudeDesktopUsageMaxAge + time.Hour)).UnixMilli()
	data := []byte(fmt.Sprintf(`{"samples":[{"t":%d,"org":"o","u":{"fh":50,"sd":9}}]}`, stale))

	if snaps := parseClaudeDesktopUsage(data, now); snaps != nil {
		t.Fatalf("expected nil for stale history, got %+v", snaps)
	}
}

func TestParseClaudeDesktopUsageMissingWindowSkipped(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-time.Minute).UnixMilli()
	// Only the five-hour window is present.
	data := []byte(fmt.Sprintf(`{"samples":[{"t":%d,"org":"o","u":{"fh":40}}]}`, fresh))

	snaps := parseClaudeDesktopUsage(data, now)
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d: %+v", len(snaps), snaps)
	}
	if snaps[0].WindowType != "session_5h" {
		t.Errorf("window = %q, want session_5h", snaps[0].WindowType)
	}
}

func TestParseClaudeDesktopUsageEmptyOrGarbage(t *testing.T) {
	now := time.Now()
	for _, tc := range []string{`{}`, `{"samples":[]}`, `not json`, `{"samples":[{"t":0,"u":{"fh":5}}]}`} {
		if snaps := parseClaudeDesktopUsage([]byte(tc), now); snaps != nil {
			t.Errorf("input %q: expected nil, got %+v", tc, snaps)
		}
	}
}
