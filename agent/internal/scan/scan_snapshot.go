package scan

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/types"
)

// scanSnapshotMu serializes load-modify-save of the shared scan-snapshot.json
// so parallel provider collects cannot clobber each other's watermarks.
var scanSnapshotMu sync.Mutex

const scanSnapshotVersion = 1

// SourceWatermark tracks whether a local scan input changed since the last snapshot.
type SourceWatermark struct {
	Path    string `json:"path,omitempty"`
	Size    int64  `json:"size,omitempty"`
	ModTime int64  `json:"modTimeUnix,omitempty"` // unix seconds
	// Extra holds tool-specific watermarks (e.g. lastEventTimestamp).
	Extra string `json:"extra,omitempty"`
}

// ScanSnapshot persists the last computed daily aggregates and source watermarks
// so incremental syncs can skip unchanged tools.
type ScanSnapshot struct {
	Version      int                        `json:"version"`
	SavedAt      string                     `json:"savedAt"`
	Aggregates   []types.DailyUsage         `json:"aggregates"`
	Sources      map[string]SourceWatermark `json:"sources"`
	AccountFiles map[string]string          `json:"accountFiles,omitempty"`
}

func scanSnapshotPath() string {
	return filepath.Join(config.CacheDir(), "scan-snapshot.json")
}

func LoadScanSnapshot() (ScanSnapshot, error) {
	scanSnapshotMu.Lock()
	defer scanSnapshotMu.Unlock()
	return loadScanSnapshotUnlocked()
}

func loadScanSnapshotUnlocked() (ScanSnapshot, error) {
	data, err := os.ReadFile(scanSnapshotPath())
	if err != nil {
		return ScanSnapshot{Sources: map[string]SourceWatermark{}}, err
	}
	var snap ScanSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return ScanSnapshot{Sources: map[string]SourceWatermark{}}, err
	}
	if snap.Sources == nil {
		snap.Sources = map[string]SourceWatermark{}
	}
	if snap.Version != scanSnapshotVersion {
		return ScanSnapshot{Sources: map[string]SourceWatermark{}}, fmt.Errorf("snapshot version mismatch")
	}
	return snap, nil
}

func SaveScanSnapshot(snap ScanSnapshot) error {
	scanSnapshotMu.Lock()
	defer scanSnapshotMu.Unlock()
	return saveScanSnapshotUnlocked(snap)
}

func saveScanSnapshotUnlocked(snap ScanSnapshot) error {
	snap.Version = scanSnapshotVersion
	snap.SavedAt = time.Now().UTC().Format(time.RFC3339)
	if snap.Sources == nil {
		snap.Sources = map[string]SourceWatermark{}
	}
	if err := os.MkdirAll(filepath.Dir(scanSnapshotPath()), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(scanSnapshotPath(), b, 0600)
}

// CommitScanSnapshotUpdate reloads the on-disk snapshot under the global lock,
// applies a mutation, and writes it back. Use this after a tool scan so parallel
// providers cannot clobber each other's aggregates/watermarks.
func CommitScanSnapshotUpdate(apply func(snap *ScanSnapshot)) error {
	scanSnapshotMu.Lock()
	defer scanSnapshotMu.Unlock()
	snap, _ := loadScanSnapshotUnlocked()
	apply(&snap)
	return saveScanSnapshotUnlocked(snap)
}

// WithScanSnapshot runs fn under the scan-snapshot lock with a loaded snapshot.
// Prefer CommitScanSnapshotUpdate for load-modify-save after scanning.
func WithScanSnapshot(fn func(snap *ScanSnapshot) error) error {
	scanSnapshotMu.Lock()
	defer scanSnapshotMu.Unlock()
	snap, _ := loadScanSnapshotUnlocked()
	if err := fn(&snap); err != nil {
		return err
	}
	return saveScanSnapshotUnlocked(snap)
}

func FileWatermark(path string) (SourceWatermark, error) {
	info, err := os.Stat(path)
	if err != nil {
		return SourceWatermark{}, err
	}
	return SourceWatermark{
		Path:    path,
		Size:    info.Size(),
		ModTime: info.ModTime().UTC().Unix(),
	}, nil
}

func WatermarkUnchanged(prev, next SourceWatermark) bool {
	if prev.Path == "" || next.Path == "" {
		return false
	}
	return prev.Path == next.Path && prev.Size == next.Size && prev.ModTime == next.ModTime && prev.Extra == next.Extra
}

func aggregateKey(row types.DailyUsage) string {
	source := row.Source
	if source == "" {
		source = "local_scan"
	}
	return fmt.Sprintf("%s|%s|%s|%s|%s", row.ToolName, row.AccountKey, row.Date, row.Model, source)
}

// PruneAggregatesLookback drops rows older than UsageLookbackDays.
func PruneAggregatesLookback(rows []types.DailyUsage, now time.Time) []types.DailyUsage {
	return FilterUsageLookback(rows, now)
}

// ReplaceToolAggregates removes all rows for toolName then appends next.
func ReplaceToolAggregates(existing []types.DailyUsage, toolName string, next []types.DailyUsage) []types.DailyUsage {
	out := make([]types.DailyUsage, 0, len(existing)+len(next))
	for _, row := range existing {
		if row.ToolName == toolName {
			continue
		}
		out = append(out, row)
	}
	out = append(out, next...)
	return out
}

// ReplaceSourceAggregates removes rows matching toolName+source then appends next.
func ReplaceSourceAggregates(existing []types.DailyUsage, toolName, source string, next []types.DailyUsage) []types.DailyUsage {
	out := make([]types.DailyUsage, 0, len(existing)+len(next))
	for _, row := range existing {
		if row.ToolName == toolName && row.Source == source {
			continue
		}
		out = append(out, row)
	}
	out = append(out, next...)
	return out
}

// ReplaceAccountSourceAggregates drops rows for one tool+source+account then appends next.
func ReplaceAccountSourceAggregates(existing []types.DailyUsage, toolName, source, accountKey string, next []types.DailyUsage) []types.DailyUsage {
	out := make([]types.DailyUsage, 0, len(existing)+len(next))
	for _, row := range existing {
		if row.ToolName == toolName && row.Source == source && strings.TrimSpace(row.AccountKey) == strings.TrimSpace(accountKey) {
			continue
		}
		out = append(out, row)
	}
	out = append(out, next...)
	return out
}

// AggregatesForSource returns snapshot rows for toolName+source.
func AggregatesForSource(snap ScanSnapshot, toolName, source string) []types.DailyUsage {
	out := make([]types.DailyUsage, 0)
	for _, row := range snap.Aggregates {
		if row.ToolName == toolName && row.Source == source {
			out = append(out, row)
		}
	}
	return PruneAggregatesLookback(out, time.Now().UTC())
}

// ReplaceToolPrefixAggregates drops rows whose tool name equals toolName or
// starts with prefix (e.g. "codex" + "codex-work").
func ReplaceToolNamesAggregates(existing []types.DailyUsage, toolNames []string, next []types.DailyUsage) []types.DailyUsage {
	drop := map[string]bool{}
	for _, name := range toolNames {
		drop[name] = true
	}
	out := make([]types.DailyUsage, 0, len(existing)+len(next))
	for _, row := range existing {
		if drop[row.ToolName] {
			continue
		}
		out = append(out, row)
	}
	out = append(out, next...)
	return out
}

func pathUnderRoot(path, root string) bool {
	path = filepath.Clean(path)
	root = filepath.Clean(root)
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// SourcesUnchanged reports whether every path in want matches the snapshot.
func SourcesUnchanged(snap ScanSnapshot, keys []string, current map[string]SourceWatermark) bool {
	if len(keys) == 0 {
		return false
	}
	for _, key := range keys {
		prev, ok := snap.Sources[key]
		if !ok || !WatermarkUnchanged(prev, current[key]) {
			return false
		}
	}
	return true
}

// JSONLSourcesUnchanged is SourcesUnchanged plus a check that no JSONL under
// roots disappeared since the snapshot was written.
func JSONLSourcesUnchanged(snap ScanSnapshot, roots []string, current map[string]SourceWatermark, keys []string) bool {
	if !SourcesUnchanged(snap, keys, current) {
		return false
	}
	for key, wm := range snap.Sources {
		if !strings.HasPrefix(key, "jsonl:") {
			continue
		}
		underRoot := false
		for _, root := range roots {
			if pathUnderRoot(wm.Path, root) {
				underRoot = true
				break
			}
		}
		if underRoot {
			if _, ok := current[key]; !ok {
				return false
			}
		}
	}
	return true
}

// SQLiteSourcesUnchanged is SourcesUnchanged plus a check that no sqlite:*
// watermark disappeared (file removed).
func SQLiteSourcesUnchanged(snap ScanSnapshot, current map[string]SourceWatermark, keys []string) bool {
	if !SourcesUnchanged(snap, keys, current) {
		return false
	}
	for key := range snap.Sources {
		if !strings.HasPrefix(key, "sqlite:") {
			continue
		}
		if _, ok := current[key]; !ok {
			return false
		}
	}
	return true
}

// AggregatesForTools returns snapshot rows for the given tool names.
func AggregatesForTools(snap ScanSnapshot, toolNames ...string) []types.DailyUsage {
	want := map[string]bool{}
	for _, name := range toolNames {
		want[name] = true
	}
	out := make([]types.DailyUsage, 0)
	for _, row := range snap.Aggregates {
		if want[row.ToolName] {
			out = append(out, row)
		}
	}
	return PruneAggregatesLookback(out, time.Now().UTC())
}

// CollectJSONLWatermarks walks roots for *.jsonl and returns path→watermark.
func CollectJSONLWatermarks(roots []string) (map[string]SourceWatermark, []string, error) {
	out := map[string]SourceWatermark{}
	keys := make([]string, 0)
	for _, root := range roots {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || filepath.Ext(path) != ".jsonl" {
				return nil
			}
			wm := SourceWatermark{Path: path, Size: info.Size(), ModTime: info.ModTime().UTC().Unix()}
			key := "jsonl:" + path
			out[key] = wm
			keys = append(keys, key)
			return nil
		})
	}
	return out, keys, nil
}
