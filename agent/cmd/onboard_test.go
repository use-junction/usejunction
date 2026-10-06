package cmd

import "testing"

func TestHumanizeCollectProgress(t *testing.T) {
	if got := humanizeCollectProgress("scan", "Scanning cursor"); got != "" {
		t.Fatalf("expected scan messages suppressed for panel UI, got %q", got)
	}
	if got := humanizeCollectProgress("heartbeat", ""); got != "Connecting to UseJunction" {
		t.Fatalf("expected heartbeat fallback, got %q", got)
	}
	if got := humanizeCollectProgress("upload-usage", "  Syncing usage (934 rows)  "); got != "Syncing usage (934 rows)" {
		t.Fatalf("expected trimmed message, got %q", got)
	}
	if got := humanizeCollectProgress("scan-tool-start", "cursor"); got != "" {
		t.Fatalf("expected scan-tool events to be suppressed, got %q", got)
	}
}
