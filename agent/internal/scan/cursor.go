package scan

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/sqlitedb"
	"github.com/usejunction/agent/internal/types"
)

const cursorLocalSource = "cursor_local"

// cursorStateDBPathOverride is set by tests to point at a fixture state.vscdb.
var cursorStateDBPathOverride string

func cursorStateDBPath() string {
	if cursorStateDBPathOverride != "" {
		return cursorStateDBPathOverride
	}
	return filepath.Join(platformdirs.CursorUserDir(), "globalStorage", "state.vscdb")
}

func cursorAITrackingDBPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".cursor", "ai-tracking", "ai-code-tracking.db")
}

func cursorLocalSourceKeys() (map[string]SourceWatermark, []string) {
	paths := []string{cursorStateDBPath(), cursorAITrackingDBPath()}
	current := map[string]SourceWatermark{}
	keys := make([]string, 0, len(paths))
	for _, path := range paths {
		wm, err := FileWatermark(path)
		if err != nil {
			continue
		}
		key := "sqlite:" + path
		current[key] = wm
		keys = append(keys, key)
	}
	return current, keys
}

// ScanCursorLocal harvests WakaTime-style AI line metrics and model attribution
// from Cursor's local sqlite stores (User/globalStorage/state.vscdb and
// ~/.cursor/ai-tracking/ai-code-tracking.db). It never reads prompt text.
// When forceFull is false and both sqlite files are unchanged, prior aggregates
// are reused from the scan snapshot.
func ScanCursorLocal(forceFull bool) ([]types.DailyUsage, error) {
	cacheFile := filepath.Join(config.CacheDir(), "cursor-local.json")
	current, keys := cursorLocalSourceKeys()
	snap, _ := LoadScanSnapshot()
	if !forceFull && SQLiteSourcesUnchanged(snap, current, keys) {
		if rows := AggregatesForSource(snap, "cursor", cursorLocalSource); len(rows) > 0 || len(keys) == 0 {
			return rows, nil
		}
	}

	buckets := map[string]*types.DailyUsage{}

	_ = scanCursorDailyStats(buckets)
	_ = scanCursorAICodeHashes(buckets)
	_ = scanCursorScoredCommits(buckets)

	result := make([]types.DailyUsage, 0, len(buckets))
	for _, b := range buckets {
		if b.Source == "" {
			b.Source = cursorLocalSource
		}
		result = append(result, *b)
	}
	result = PruneAggregatesLookback(result, time.Now().UTC())
	result = stampSourceActivity("cursor", cursorLocalSource, result)
	_ = saveCache(cacheFile, result)
	_ = CommitScanSnapshotUpdate(func(snap *ScanSnapshot) {
		snap.Aggregates = ReplaceSourceAggregates(snap.Aggregates, "cursor", cursorLocalSource, result)
		if snap.Sources == nil {
			snap.Sources = map[string]SourceWatermark{}
		}
		for key := range snap.Sources {
			if strings.HasPrefix(key, "sqlite:") {
				if _, ok := current[key]; !ok {
					delete(snap.Sources, key)
				}
			}
		}
		for key, wm := range current {
			snap.Sources[key] = wm
		}
	})
	return result, nil
}

func cursorBucket(buckets map[string]*types.DailyUsage, date, model string) *types.DailyUsage {
	if model == "" {
		model = "unknown"
	}
	key := date + "|" + model
	if buckets[key] == nil {
		buckets[key] = &types.DailyUsage{
			Date: date, ToolName: "cursor", Model: model, Source: "cursor_local",
			MetricKind: types.MetricKindProductivity, Requests: 0,
		}
	}
	return buckets[key]
}

func scanCursorDailyStats(buckets map[string]*types.DailyUsage) error {
	return scanCursorDailyStatsAt(cursorStateDBPath(), buckets)
}

func scanCursorDailyStatsAt(dbPath string, buckets map[string]*types.DailyUsage) error {
	if _, err := os.Stat(dbPath); err != nil {
		return err
	}
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	rows, err := db.Query(`SELECT key, value FROM ItemTable WHERE key LIKE 'aiCodeTracking.dailyStats.%'`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		var stats struct {
			Date                   string `json:"date"`
			TabSuggestedLines      int    `json:"tabSuggestedLines"`
			TabAcceptedLines       int    `json:"tabAcceptedLines"`
			ComposerSuggestedLines int    `json:"composerSuggestedLines"`
			ComposerAcceptedLines  int    `json:"composerAcceptedLines"`
		}
		if json.Unmarshal([]byte(value), &stats) != nil || stats.Date == "" {
			continue
		}
		suggested := stats.TabSuggestedLines + stats.ComposerSuggestedLines
		accepted := stats.TabAcceptedLines + stats.ComposerAcceptedLines
		if suggested+accepted == 0 {
			continue
		}
		b := cursorBucket(buckets, stats.Date, "ai-lines")
		b.SuggestedLines += suggested
		b.AcceptedLines += accepted
		b.MetricKind = types.MetricKindProductivity
		b.Requests = 0
	}
	return rows.Err()
}

func scanCursorAICodeHashes(buckets map[string]*types.DailyUsage) error {
	dbPath := cursorAITrackingDBPath()
	if _, err := os.Stat(dbPath); err != nil {
		return err
	}
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT COALESCE(model, 'unknown') AS model,
		       date(createdAt/1000, 'unixepoch') AS day,
		       COUNT(*) AS n
		FROM ai_code_hashes
		WHERE source = 'composer' AND createdAt IS NOT NULL
		GROUP BY model, day
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var model, day string
		var n int
		if err := rows.Scan(&model, &day, &n); err != nil {
			continue
		}
		if day == "" || n <= 0 {
			continue
		}
		b := cursorBucket(buckets, day, model)
		b.AddedLines += n
		b.Requests = 0
	}
	return rows.Err()
}

func scanCursorScoredCommits(buckets map[string]*types.DailyUsage) error {
	dbPath := cursorAITrackingDBPath()
	if _, err := os.Stat(dbPath); err != nil {
		return err
	}
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT commitDate, scoredAt,
		       composerLinesAdded, composerLinesDeleted, tabLinesAdded,
		       v2AiPercentage
		FROM scored_commits
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type dayAgg struct {
		added, deleted, tabAdded, commits int
		aiPctSum                          float64
		aiPctN                            int
	}
	byDay := map[string]*dayAgg{}

	for rows.Next() {
		var commitDate sql.NullString
		var scoredAt sql.NullInt64
		var added, deleted, tabAdded sql.NullInt64
		var aiPct sql.NullFloat64
		if err := rows.Scan(&commitDate, &scoredAt, &added, &deleted, &tabAdded, &aiPct); err != nil {
			continue
		}
		day := cursorCommitDay(commitDate.String, scoredAt.Int64)
		if day == "" {
			continue
		}
		agg := byDay[day]
		if agg == nil {
			agg = &dayAgg{}
			byDay[day] = agg
		}
		agg.added += int(added.Int64)
		agg.deleted += int(deleted.Int64)
		agg.tabAdded += int(tabAdded.Int64)
		agg.commits++
		if aiPct.Valid {
			agg.aiPctSum += aiPct.Float64
			agg.aiPctN++
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for day, agg := range byDay {
		b := cursorBucket(buckets, day, "commits")
		b.AddedLines += agg.added + agg.tabAdded
		b.DeletedLines += agg.deleted
		b.Commits += agg.commits
		if agg.aiPctN > 0 {
			v := agg.aiPctSum / float64(agg.aiPctN)
			b.AiPercent = &v
		}
		b.Requests = 0
	}
	return nil
}

// cursorCommitDay returns YYYY-MM-DD for a scored commit. Cursor stores git-style
// commitDate values (e.g. "Wed Jul 22 21:55:05 2026 +0530"); substr(1,10) is wrong.
func cursorCommitDay(commitDate string, scoredAtMs int64) string {
	commitDate = strings.TrimSpace(commitDate)
	if day := parseCursorCommitDate(commitDate); day != "" {
		return day
	}
	if scoredAtMs > 0 {
		sec := scoredAtMs
		if scoredAtMs > 1_000_000_000_000 { // ms
			sec = scoredAtMs / 1000
		}
		return time.Unix(sec, 0).UTC().Format("2006-01-02")
	}
	return ""
}

func parseCursorCommitDate(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if len(raw) >= 10 && raw[4] == '-' && raw[7] == '-' {
		day := raw[:10]
		if _, err := time.Parse("2006-01-02", day); err == nil {
			return day
		}
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"Mon Jan _2 15:04:05 2006 -0700",
		"Mon Jan 2 15:04:05 2006 -0700",
		"Mon Jan _2 15:04:05 MST 2006",
		"Mon Jan 2 15:04:05 MST 2006",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC().Format("2006-01-02")
		}
	}
	return ""
}

// MergeCursorUsage merges local AI-line rows with verified usage-event rows.
// Event rows (with tokens/cost) take precedence for the same date+model when verified.
func MergeCursorUsage(local, events []types.DailyUsage) []types.DailyUsage {
	if len(events) == 0 {
		return local
	}
	if len(local) == 0 {
		return events
	}
	out := make([]types.DailyUsage, 0, len(local)+len(events))
	seen := map[string]bool{}
	for _, e := range events {
		key := e.Date + "|" + e.Model + "|" + e.Source + "|" + e.AccountKey
		seen[key] = true
		out = append(out, e)
	}
	for _, l := range local {
		key := l.Date + "|" + l.Model + "|" + l.Source + "|" + l.AccountKey
		if seen[key] {
			continue
		}
		// Keep AI-line / commit attribution rows even when events exist.
		out = append(out, l)
	}
	return out
}
