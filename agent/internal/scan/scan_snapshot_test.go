package scan

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/config/configtest"
	"github.com/usejunction/agent/internal/types"
)

func TestPruneAggregatesLookback(t *testing.T) {
	now := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	rows := []types.DailyUsage{
		{ToolName: "codex", Date: "2026-07-20", Model: "a"},
		{ToolName: "codex", Date: "2026-05-01", Model: "old"},
	}
	out := PruneAggregatesLookback(rows, now)
	if len(out) != 1 || out[0].Date != "2026-07-20" {
		t.Fatalf("expected only recent row, got %#v", out)
	}
}

func TestReplaceToolNamesAggregates(t *testing.T) {
	existing := []types.DailyUsage{
		{ToolName: "codex", Date: "2026-07-20", Model: "a"},
		{ToolName: "codex-work", Date: "2026-07-20", Model: "b"},
		{ToolName: "claude", Date: "2026-07-20", Model: "c"},
	}
	next := []types.DailyUsage{{ToolName: "codex", Date: "2026-07-21", Model: "a"}}
	out := ReplaceToolNamesAggregates(existing, []string{"codex", "codex-work"}, next)
	if len(out) != 2 {
		t.Fatalf("expected claude + new codex, got %#v", out)
	}
	if out[0].ToolName != "claude" || out[1].Date != "2026-07-21" {
		t.Fatalf("unexpected order/content %#v", out)
	}
}

func TestSourcesUnchanged(t *testing.T) {
	wm := SourceWatermark{Path: "/tmp/a.jsonl", Size: 10, ModTime: 100}
	snap := ScanSnapshot{Sources: map[string]SourceWatermark{"jsonl:/tmp/a.jsonl": wm}}
	current := map[string]SourceWatermark{"jsonl:/tmp/a.jsonl": wm}
	if !SourcesUnchanged(snap, []string{"jsonl:/tmp/a.jsonl"}, current) {
		t.Fatal("expected unchanged")
	}
	current["jsonl:/tmp/a.jsonl"] = SourceWatermark{Path: "/tmp/a.jsonl", Size: 11, ModTime: 100}
	if SourcesUnchanged(snap, []string{"jsonl:/tmp/a.jsonl"}, current) {
		t.Fatal("expected changed size")
	}
}

func TestPathUnderRootAcceptsForwardSlashPathsOnWindows(t *testing.T) {
	if filepath.Separator != '\\' {
		t.Skip("windows-only regression")
	}
	if !pathUnderRoot(`/root/b.jsonl`, `/root`) {
		t.Fatal("forward-slash jsonl paths must match scan roots on Windows")
	}
}

func TestPathUnderRoot(t *testing.T) {
	root := filepath.Join("data", "codex")
	child := filepath.Join(root, "session.jsonl")
	if !pathUnderRoot(child, root) {
		t.Fatalf("expected %q under %q", child, root)
	}
	if pathUnderRoot(filepath.Join("data", "other", "x.jsonl"), root) {
		t.Fatal("expected sibling path to be outside root")
	}
}

func TestJSONLSourcesUnchangedDetectsDeletedFile(t *testing.T) {
	dir := t.TempDir()
	pathA := filepath.Join(dir, "a.jsonl")
	pathB := filepath.Join(dir, "b.jsonl")
	wmA := SourceWatermark{Path: pathA, Size: 1, ModTime: 1}
	wmB := SourceWatermark{Path: pathB, Size: 2, ModTime: 2}
	snap := ScanSnapshot{Sources: map[string]SourceWatermark{
		"jsonl:" + pathA: wmA,
		"jsonl:" + pathB: wmB,
	}}
	current := map[string]SourceWatermark{"jsonl:" + pathA: wmA}
	keys := []string{"jsonl:" + pathA}
	if JSONLSourcesUnchanged(snap, []string{dir}, current, keys) {
		t.Fatal("deleted b.jsonl must invalidate snapshot")
	}
}

func TestScanSnapshotRoundTrip(t *testing.T) {
	configtest.WithIsolatedHome(t)
	if err := os.MkdirAll(configtest.CacheDir(t), 0700); err != nil {
		t.Fatal(err)
	}

	snap := ScanSnapshot{
		Aggregates: []types.DailyUsage{{ToolName: "codex", Date: time.Now().UTC().Format("2006-01-02"), Model: "x", Source: "local_scan"}},
		Sources: map[string]SourceWatermark{
			"jsonl:/x": {Path: "/x", Size: 1, ModTime: 2},
		},
	}
	if err := SaveScanSnapshot(snap); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadScanSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Aggregates) != 1 || loaded.Sources["jsonl:/x"].Size != 1 {
		t.Fatalf("round trip failed: %#v", loaded)
	}
	rows := AggregatesForTools(loaded, "codex")
	if len(rows) != 1 {
		t.Fatalf("aggregates for tool: %#v", rows)
	}
}

func TestCollectJSONLWatermarks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(path, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	current, keys, err := CollectJSONLWatermarks([]string{dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 {
		t.Fatalf("keys=%v", keys)
	}
	if current[keys[0]].Size != 3 {
		t.Fatalf("wm=%#v", current[keys[0]])
	}
}
