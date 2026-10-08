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

	snaps := parseClaudeDesktopUsage(data, now, "")
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

func TestParseClaudeDesktopUsageFiltersByOrg(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	// org-b has the newest sample overall, but we probe org-a: the reading must
	// come from org-a's newest, not whichever org wrote last.
	orgAOld := now.Add(-3 * time.Hour).UnixMilli()
	orgANew := now.Add(-30 * time.Minute).UnixMilli()
	orgBNewest := now.Add(-1 * time.Minute).UnixMilli()
	data := []byte(fmt.Sprintf(`{"samples":[
		{"t":%d,"org":"org-a","u":{"fh":12,"sd":3}},
		{"t":%d,"org":"org-a","u":{"fh":100,"sd":45}},
		{"t":%d,"org":"org-b","u":{"fh":0,"sd":0}}
	]}`, orgAOld, orgANew, orgBNewest))

	snaps := parseClaudeDesktopUsage(data, now, "org-a")
	byWindow := map[string]float64{}
	for _, s := range snaps {
		byWindow[s.WindowType] = *s.UsedPercent
	}
	if byWindow["session_5h"] != 100 || byWindow["weekly"] != 45 {
		t.Fatalf("org-a reading wrong, got %+v (leaked org-b?)", byWindow)
	}

	// An unknown org has no samples.
	if snaps := parseClaudeDesktopUsage(data, now, "org-missing"); snaps != nil {
		t.Fatalf("expected nil for unknown org, got %+v", snaps)
	}

	// Empty org falls back to the newest across all orgs (org-b here).
	fallback := parseClaudeDesktopUsage(data, now, "")
	fb := map[string]float64{}
	for _, s := range fallback {
		fb[s.WindowType] = *s.UsedPercent
	}
	if fb["session_5h"] != 0 {
		t.Fatalf("empty-org fallback should take org-b newest, got %+v", fb)
	}
}

func TestParseClaudeDesktopUsageByOrg(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	orgANew := now.Add(-20 * time.Minute).UnixMilli()
	orgAOld := now.Add(-5 * time.Hour).UnixMilli()
	orgBNew := now.Add(-2 * time.Minute).UnixMilli()
	orgCStale := now.Add(-(claudeDesktopUsageMaxAge + time.Hour)).UnixMilli()
	data := []byte(fmt.Sprintf(`{"samples":[
		{"t":%d,"org":"org-a","u":{"fh":10,"sd":5}},
		{"t":%d,"org":"org-a","u":{"fh":70,"sd":22}},
		{"t":%d,"org":"org-b","u":{"fh":4,"sd":1}},
		{"t":%d,"org":"org-c","u":{"fh":99,"sd":99}}
	]}`, orgAOld, orgANew, orgBNew, orgCStale))

	byOrg := parseClaudeDesktopUsageByOrg(data, now)
	if len(byOrg) != 2 {
		t.Fatalf("expected orgs a and b (c is stale), got %d: %+v", len(byOrg), byOrg)
	}
	if _, ok := byOrg["org-c"]; ok {
		t.Errorf("stale org-c should be excluded")
	}
	fh := map[string]float64{}
	for _, s := range byOrg["org-a"] {
		fh[s.WindowType] = *s.UsedPercent
	}
	if fh["session_5h"] != 70 || fh["weekly"] != 22 {
		t.Errorf("org-a should use its newest sample, got %+v", fh)
	}
}

func TestParseClaudeDesktopUsageStaleReturnsNil(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-(claudeDesktopUsageMaxAge + time.Hour)).UnixMilli()
	data := []byte(fmt.Sprintf(`{"samples":[{"t":%d,"org":"o","u":{"fh":50,"sd":9}}]}`, stale))

	if snaps := parseClaudeDesktopUsage(data, now, ""); snaps != nil {
		t.Fatalf("expected nil for stale history, got %+v", snaps)
	}
}

func TestParseClaudeDesktopUsageMissingWindowSkipped(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	fresh := now.Add(-time.Minute).UnixMilli()
	// Only the five-hour window is present.
	data := []byte(fmt.Sprintf(`{"samples":[{"t":%d,"org":"o","u":{"fh":40}}]}`, fresh))

	snaps := parseClaudeDesktopUsage(data, now, "")
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
		if snaps := parseClaudeDesktopUsage([]byte(tc), now, ""); snaps != nil {
			t.Errorf("input %q: expected nil, got %+v", tc, snaps)
		}
	}
}
