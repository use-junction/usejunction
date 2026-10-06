package scan

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/sqlitedb"
	"github.com/usejunction/agent/internal/types"
)

const (
	opencodeUsageSource = "opencode_usage"
	opencodeLocalSource = "opencode_local"
)

// OpenCode DailyUsage field ← source mapping (UseJunction contract):
//
//	Identity: Date, ToolName="opencode", Model="providerID/modelID"
//	Activity: Requests (assistant turns)
//	Tokens:   InputTokens, OutputTokens, CacheRead/Write, ReasoningTokens
//	Cost:     message.data.cost when >0 → CostKindActualSpend;
//	          else EstimateCostForTool → CostKindEstimatedAPI
//	Provenance: Source=opencode_usage, MetricKind=usage,
//	            TokenSemantics=vendor_reported, Verified=false
//	Productivity: session.summary_additions/deletions → Source=opencode_local
//
// Primary store: ~/.local/share/opencode/opencode.db (message-level).
// Session rollups undercount multi-model sessions — always sum messages.
// Never ingest: prompt text, credentials, part bodies.

// opencodeDBPathOverride is set by tests.
var opencodeDBPathOverride string

// ScanOpenCode harvests usage from the standalone OpenCode SQLite DB.
func ScanOpenCode(forceFull bool) ([]types.DailyUsage, error) {
	cacheFile := filepath.Join(config.CacheDir(), "opencode-local.json")
	current, keys := opencodeSourceKeys()
	snap, _ := LoadScanSnapshot()
	if !forceFull && SQLiteSourcesUnchanged(snap, current, keys) {
		usageRows := AggregatesForSource(snap, "opencode", opencodeUsageSource)
		localRows := AggregatesForSource(snap, "opencode", opencodeLocalSource)
		if len(usageRows) > 0 || len(localRows) > 0 || len(keys) == 0 {
			return append(usageRows, localRows...), nil
		}
	}

	dbPath := opencodeDBPath()
	if dbPath == "" {
		return nil, nil
	}
	if _, err := os.Stat(dbPath); err != nil {
		return nil, nil
	}

	usageBuckets := map[string]*types.DailyUsage{}
	localBuckets := map[string]*types.DailyUsage{}
	if err := scanOpenCodeDB(dbPath, usageBuckets, localBuckets); err != nil {
		return nil, err
	}

	result := make([]types.DailyUsage, 0, len(usageBuckets)+len(localBuckets))
	usageOnly := make([]types.DailyUsage, 0, len(usageBuckets))
	localOnly := make([]types.DailyUsage, 0, len(localBuckets))
	for _, b := range usageBuckets {
		finalizeOpenCodeUsage(b)
		usageOnly = append(usageOnly, *b)
		result = append(result, *b)
	}
	for _, b := range localBuckets {
		finalizeOpenCodeLocal(b)
		localOnly = append(localOnly, *b)
		result = append(result, *b)
	}
	result = PruneAggregatesLookback(result, time.Now().UTC())
	usageOnly = stampSourceActivity("opencode", opencodeUsageSource, usageOnly)
	localOnly = stampSourceActivity("opencode", opencodeLocalSource, localOnly)
	result = append([]types.DailyUsage{}, usageOnly...)
	result = append(result, localOnly...)
	_ = saveCache(cacheFile, result)

	_ = CommitScanSnapshotUpdate(func(snap *ScanSnapshot) {
		snap.Aggregates = ReplaceSourceAggregates(snap.Aggregates, "opencode", opencodeUsageSource, usageOnly)
		snap.Aggregates = ReplaceSourceAggregates(snap.Aggregates, "opencode", opencodeLocalSource, localOnly)
		if snap.Sources == nil {
			snap.Sources = map[string]SourceWatermark{}
		}
		for key := range snap.Sources {
			if strings.HasPrefix(key, "sqlite:opencode:") {
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

func opencodeDBPath() string {
	if opencodeDBPathOverride != "" {
		return opencodeDBPathOverride
	}
	for _, dir := range platformdirs.OpenCodeCandidates() {
		candidate := filepath.Join(dir, "opencode.db")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

// OpenCodeDBPath returns the path to the standalone OpenCode SQLite DB when present.
func OpenCodeDBPath() string {
	return opencodeDBPath()
}

// SetOpenCodeDBPathForTest overrides the OpenCode DB path for tests.
func SetOpenCodeDBPathForTest(path string) func() {
	prev := opencodeDBPathOverride
	opencodeDBPathOverride = path
	return func() { opencodeDBPathOverride = prev }
}

func opencodeSourceKeys() (map[string]SourceWatermark, []string) {
	out := map[string]SourceWatermark{}
	keys := make([]string, 0, 1)
	path := opencodeDBPath()
	if path == "" {
		return out, keys
	}
	wm, err := FileWatermark(path)
	if err != nil {
		return out, keys
	}
	key := "sqlite:opencode:" + path
	out[key] = wm
	keys = append(keys, key)
	return out, keys
}

func scanOpenCodeDB(dbPath string, usage, local map[string]*types.DailyUsage) error {
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := scanOpenCodeMessages(db, usage); err != nil {
		return err
	}
	return scanOpenCodeSessionSummaries(db, local)
}

func scanOpenCodeMessages(db *sql.DB, buckets map[string]*types.DailyUsage) error {
	// Prefer turn timestamp inside message JSON; fall back to row time_created.
	// Both OpenCode stores are milliseconds since epoch.
	rows, err := db.Query(`
		SELECT
			date(
				(CASE
					WHEN json_extract(data, '$.time.created') IS NOT NULL
						THEN json_extract(data, '$.time.created')
					ELSE time_created
				END) / 1000,
				'unixepoch'
			) AS day,
			COALESCE(json_extract(data, '$.providerID'), '') AS provider,
			COALESCE(json_extract(data, '$.modelID'), '') AS model,
			COUNT(*) AS requests,
			SUM(COALESCE(json_extract(data, '$.tokens.input'), 0)) AS tin,
			SUM(COALESCE(json_extract(data, '$.tokens.output'), 0)) AS tout,
			SUM(COALESCE(json_extract(data, '$.tokens.reasoning'), 0)) AS treason,
			SUM(COALESCE(json_extract(data, '$.tokens.cache.read'), 0)) AS cread,
			SUM(COALESCE(json_extract(data, '$.tokens.cache.write'), 0)) AS cwrite,
			SUM(COALESCE(json_extract(data, '$.cost'), 0)) AS cost
		FROM message
		WHERE json_extract(data, '$.role') = 'assistant'
			AND (
				COALESCE(json_extract(data, '$.tokens.input'), 0)
				+ COALESCE(json_extract(data, '$.tokens.output'), 0)
				+ COALESCE(json_extract(data, '$.tokens.reasoning'), 0)
				+ COALESCE(json_extract(data, '$.tokens.cache.read'), 0)
				+ COALESCE(json_extract(data, '$.tokens.cache.write'), 0)
				+ COALESCE(json_extract(data, '$.cost'), 0)
			) > 0
		GROUP BY 1, 2, 3
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var day, provider, model string
		var requests, tin, tout, treason, cread, cwrite int
		var cost float64
		if err := rows.Scan(&day, &provider, &model, &requests, &tin, &tout, &treason, &cread, &cwrite, &cost); err != nil {
			return err
		}
		day = strings.TrimSpace(day)
		if day == "" {
			continue
		}
		modelKey := opencodeModelKey(provider, model)
		b := opencodeBucket(buckets, day, modelKey, opencodeUsageSource)
		b.Requests += requests
		b.InputTokens += tin
		b.OutputTokens += tout
		b.ReasoningTokens += treason
		b.CacheReadTokens += cread
		b.CacheWriteTokens += cwrite
		b.EstimatedCost += cost
		if provider != "" {
			if b.Metadata == nil {
				b.Metadata = map[string]any{}
			}
			b.Metadata["upstreamProvider"] = provider
		}
	}
	return rows.Err()
}

func scanOpenCodeSessionSummaries(db *sql.DB, buckets map[string]*types.DailyUsage) error {
	rows, err := db.Query(`
		SELECT
			date(time_created / 1000, 'unixepoch') AS day,
			SUM(COALESCE(summary_additions, 0)) AS adds,
			SUM(COALESCE(summary_deletions, 0)) AS dels,
			COUNT(*) AS sessions
		FROM session
		WHERE COALESCE(summary_additions, 0) + COALESCE(summary_deletions, 0) > 0
		GROUP BY 1
	`)
	if err != nil {
		// Older schemas without summary columns — skip productivity.
		if strings.Contains(strings.ToLower(err.Error()), "no such column") {
			return nil
		}
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var day string
		var adds, dels, sessions int
		if err := rows.Scan(&day, &adds, &dels, &sessions); err != nil {
			return err
		}
		day = strings.TrimSpace(day)
		if day == "" || adds+dels == 0 {
			continue
		}
		b := opencodeBucket(buckets, day, "opencode", opencodeLocalSource)
		b.AddedLines += adds
		b.DeletedLines += dels
		b.Requests += sessions
	}
	return rows.Err()
}

func opencodeModelKey(provider, model string) string {
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	switch {
	case provider != "" && model != "":
		return provider + "/" + model
	case model != "":
		return model
	case provider != "":
		return provider
	default:
		return "opencode"
	}
}

func opencodeBucket(buckets map[string]*types.DailyUsage, date, model, source string) *types.DailyUsage {
	key := fmt.Sprintf("%s|%s|%s", date, model, source)
	if b := buckets[key]; b != nil {
		return b
	}
	b := &types.DailyUsage{
		Date:               date,
		ToolName:           "opencode",
		Model:              model,
		Source:             source,
		MetricKind:         types.MetricKindUsage,
		TokenSemantics:     types.TokenSemanticsVendor,
		CalculationVersion: calculationVersion,
		Verified:           false,
	}
	if source == opencodeLocalSource {
		b.MetricKind = types.MetricKindProductivity
	}
	buckets[key] = b
	return b
}

func finalizeOpenCodeUsage(b *types.DailyUsage) {
	if b.ToolName == "" {
		b.ToolName = "opencode"
	}
	if b.Source == "" {
		b.Source = opencodeUsageSource
	}
	if b.MetricKind == "" {
		b.MetricKind = types.MetricKindUsage
	}
	if b.CalculationVersion == "" {
		b.CalculationVersion = calculationVersion
	}
	if b.TokenSemantics == "" {
		b.TokenSemantics = types.TokenSemanticsVendor
	}
	b.Verified = false
	if b.EstimatedCost > 0 {
		b.CostKind = types.CostKindActualSpend
		return
	}
	if (b.InputTokens + b.OutputTokens + b.CacheReadTokens + b.ReasoningTokens) > 0 {
		b.EstimatedCost = EstimateCostForTool(
			"opencode", b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens,
		)
		if b.EstimatedCost > 0 {
			b.CostKind = types.CostKindEstimatedAPI
		}
	}
}

func finalizeOpenCodeLocal(b *types.DailyUsage) {
	if b.ToolName == "" {
		b.ToolName = "opencode"
	}
	b.Source = opencodeLocalSource
	b.MetricKind = types.MetricKindProductivity
	if b.CalculationVersion == "" {
		b.CalculationVersion = calculationVersion
	}
	b.Verified = false
	b.EstimatedCost = 0
	b.CostKind = ""
}
