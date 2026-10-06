package scan

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/platformdirs"
	"github.com/usejunction/agent/internal/sqlitedb"
	"github.com/usejunction/agent/internal/types"
)

const (
	antigravityLocalSource = "antigravity_local"
	antigravityUsageSource = "antigravity_usage"
)

// Antigravity DailyUsage field ← source mapping (UseJunction contract):
//
//	Identity: Date, ToolName="antigravity", Model (stable slug)
//	Activity: Requests
//	Tokens:   InputTokens, OutputTokens, CacheReadTokens, ReasoningTokens
//	Cost:     EstimatedCost via EstimateCostForTool → CostKindEstimatedAPI
//	Provenance: Source, MetricKind=usage, TokenSemantics=vendor_reported,
//	            Verified=false, CalculationVersion=usage-v2
//
// Source precedence (do not double-count date|model):
//  1. conversations/*.db gen_metadata protobuf → antigravity_usage (tokens+requests)
//  1b. steps.step_payload UsageMetadata → antigravity_usage
//  2. Live LS GetCascadeTrajectoryGeneratorMetadata → antigravity_usage (merged by provider)
//  3. brain transcript.jsonl MODEL turns → antigravity_local (requests only)
//
// Note: newer Antigravity IDE builds store conversations as *.pb (not *.db). Those
// blobs are not gen_metadata and do not yield tokens offline — open the IDE so the
// live LS path can supply antigravity_usage, otherwise cost stays $0.
//
// Never as usage rows: modelCredits, oauth, prompt bodies.

// antigravityRootsOverride is set by tests.
var antigravityRootsOverride []string

var (
	usageJSONKeys = []struct {
		input  string
		output string
		total  string
	}{
		{"promptTokenCount", "candidatesTokenCount", "totalTokenCount"},
		{"prompt_token_count", "candidates_token_count", "total_token_count"},
		{"input_tokens", "output_tokens", "total_tokens"},
		{"promptTokens", "completionTokens", "totalTokens"},
		{"prompt_tokens", "completion_tokens", "total_tokens"},
	}
	tokenNearLabelRe = regexp.MustCompile(`(?i)(prompt[_ ]?token(?:s|_count)?|input[_ ]?token(?:s)?|completion[_ ]?token(?:s)?|candidates[_ ]?token(?:s|_count)?|output[_ ]?token(?:s)?|total[_ ]?token(?:s|_count)?)[^0-9]{0,24}(\d{1,9})`)
)

// MergeAntigravityUsage prefers token-bearing antigravity_usage rows over
// request-only antigravity_local rows for the same date|model key.
func MergeAntigravityUsage(parts ...[]types.DailyUsage) []types.DailyUsage {
	usageByKey := map[string]*types.DailyUsage{}
	localByKey := map[string]*types.DailyUsage{}
	for _, rows := range parts {
		for _, row := range rows {
			key := row.Date + "|" + row.Model
			if row.Source == antigravityUsageSource || antigravityRowHasTokens(row) {
				dst := usageByKey[key]
				if dst == nil {
					cp := row
					if cp.Source == "" || cp.Source == antigravityLocalSource {
						cp.Source = antigravityUsageSource
					}
					usageByKey[key] = &cp
					continue
				}
				dst.InputTokens += row.InputTokens
				dst.OutputTokens += row.OutputTokens
				dst.CacheReadTokens += row.CacheReadTokens
				dst.CacheWriteTokens += row.CacheWriteTokens
				dst.ReasoningTokens += row.ReasoningTokens
				dst.Requests += row.Requests
			} else {
				dst := localByKey[key]
				if dst == nil {
					cp := row
					if cp.Source == "" {
						cp.Source = antigravityLocalSource
					}
					localByKey[key] = &cp
					continue
				}
				dst.Requests += row.Requests
			}
		}
	}
	out := make([]types.DailyUsage, 0, len(usageByKey)+len(localByKey))
	for key, row := range usageByKey {
		finalizeAntigravityUsage(row)
		out = append(out, *row)
		delete(localByKey, key)
	}
	for _, row := range localByKey {
		finalizeAntigravityUsage(row)
		out = append(out, *row)
	}
	return out
}

func antigravityRowHasTokens(row types.DailyUsage) bool {
	return row.InputTokens+row.OutputTokens+row.CacheReadTokens+row.ReasoningTokens > 0
}

func finalizeAntigravityUsage(b *types.DailyUsage) {
	if b.ToolName == "" {
		b.ToolName = "antigravity"
	}
	if b.Source == "" {
		b.Source = antigravityLocalSource
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
	if (b.InputTokens + b.OutputTokens + b.CacheReadTokens + b.ReasoningTokens) > 0 {
		b.EstimatedCost = EstimateCostForTool("antigravity", b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens)
		if b.EstimatedCost > 0 {
			b.CostKind = types.CostKindEstimatedAPI
		}
	}
}

// ScanAntigravityLocal harvests usage from Antigravity local stores:
//   - conversations/*.db gen_metadata + step_payload UsageMetadata (tokens)
//   - brain/**/transcript.jsonl model turns (requests only)
//
// Live LS token extraction is merged by the provider (see MergeAntigravityUsage).
func ScanAntigravityLocal(forceFull bool) ([]types.DailyUsage, error) {
	cacheFile := filepath.Join(config.CacheDir(), "antigravity-local.json")
	current, keys := antigravityLocalSourceKeys()
	snap, _ := LoadScanSnapshot()
	if !forceFull && SQLiteSourcesUnchanged(snap, current, keys) {
		usageRows := AggregatesForSource(snap, "antigravity", antigravityUsageSource)
		localRows := AggregatesForSource(snap, "antigravity", antigravityLocalSource)
		if len(usageRows) > 0 || len(localRows) > 0 || len(keys) == 0 {
			return MergeAntigravityUsage(usageRows, localRows), nil
		}
	}

	usageBuckets := map[string]*types.DailyUsage{}
	localBuckets := map[string]*types.DailyUsage{}
	seenResponseIDs := map[string]bool{}
	for _, dbPath := range antigravityConversationDBs() {
		_ = scanAntigravityGenMetadata(dbPath, usageBuckets, seenResponseIDs)
		_ = scanAntigravityConversationDB(dbPath, usageBuckets)
	}
	for _, path := range antigravityBrainTranscripts() {
		_ = scanAntigravityBrainTranscript(path, localBuckets)
	}

	usageRows := make([]types.DailyUsage, 0, len(usageBuckets))
	for _, b := range usageBuckets {
		finalizeAntigravityUsage(b)
		usageRows = append(usageRows, *b)
	}
	localRows := make([]types.DailyUsage, 0, len(localBuckets))
	for _, b := range localBuckets {
		finalizeAntigravityUsage(b)
		localRows = append(localRows, *b)
	}
	result := MergeAntigravityUsage(usageRows, localRows)
	result = PruneAggregatesLookback(result, time.Now().UTC())

	usageOnly := make([]types.DailyUsage, 0)
	localOnly := make([]types.DailyUsage, 0)
	for _, row := range result {
		if row.Source == antigravityUsageSource {
			usageOnly = append(usageOnly, row)
		} else {
			localOnly = append(localOnly, row)
		}
	}
	usageOnly = stampSourceActivity("antigravity", antigravityUsageSource, usageOnly)
	localOnly = stampSourceActivity("antigravity", antigravityLocalSource, localOnly)
	result = MergeAntigravityUsage(usageOnly, localOnly)
	_ = saveCache(cacheFile, result)
	_ = CommitScanSnapshotUpdate(func(snap *ScanSnapshot) {
		snap.Aggregates = ReplaceSourceAggregates(snap.Aggregates, "antigravity", antigravityUsageSource, usageOnly)
		snap.Aggregates = ReplaceSourceAggregates(snap.Aggregates, "antigravity", antigravityLocalSource, localOnly)
		if snap.Sources == nil {
			snap.Sources = map[string]SourceWatermark{}
		}
		for key := range snap.Sources {
			if strings.HasPrefix(key, "antigravity-db:") || strings.HasPrefix(key, "antigravity-transcript:") {
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

func antigravityRoots() []string {
	if antigravityRootsOverride != nil {
		return antigravityRootsOverride
	}
	return platformdirs.GeminiAntigravityRoots()
}

func antigravityConversationDBs() []string {
	var out []string
	for _, root := range antigravityRoots() {
		conv := filepath.Join(root, "conversations")
		entries, err := os.ReadDir(conv)
		if err != nil {
			continue
		}
		for _, ent := range entries {
			name := ent.Name()
			if ent.IsDir() || !strings.HasSuffix(name, ".db") {
				continue
			}
			if strings.HasSuffix(name, "-wal") || strings.HasSuffix(name, "-shm") {
				continue
			}
			out = append(out, filepath.Join(conv, name))
		}
	}
	return out
}

func antigravityBrainTranscripts() []string {
	var out []string
	for _, root := range antigravityRoots() {
		brain := filepath.Join(root, "brain")
		_ = filepath.Walk(brain, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if strings.EqualFold(info.Name(), "transcript.jsonl") {
				out = append(out, path)
			}
			return nil
		})
	}
	return out
}

func antigravityLocalSourceKeys() (map[string]SourceWatermark, []string) {
	current := map[string]SourceWatermark{}
	keys := make([]string, 0)
	for _, path := range antigravityConversationDBs() {
		wm, err := FileWatermark(path)
		if err != nil {
			continue
		}
		key := "antigravity-db:" + path
		current[key] = wm
		keys = append(keys, key)
	}
	for _, path := range antigravityBrainTranscripts() {
		wm, err := FileWatermark(path)
		if err != nil {
			continue
		}
		key := "antigravity-transcript:" + path
		current[key] = wm
		keys = append(keys, key)
	}
	return current, keys
}

func antigravityBucket(buckets map[string]*types.DailyUsage, date, model, source string) *types.DailyUsage {
	if model == "" {
		model = "unknown"
	}
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	if source == "" {
		source = antigravityLocalSource
	}
	key := date + "|" + model
	if buckets[key] == nil {
		buckets[key] = &types.DailyUsage{
			Date:               date,
			ToolName:           "antigravity",
			Model:              model,
			Source:             source,
			MetricKind:         types.MetricKindUsage,
			TokenSemantics:     types.TokenSemanticsVendor,
			CalculationVersion: calculationVersion,
		}
	}
	return buckets[key]
}

func scanAntigravityBrainTranscript(path string, buckets map[string]*types.DailyUsage) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	model := "unknown"
	return ForEachJSONLLine(f, func(line []byte) error {
		var row map[string]any
		if json.Unmarshal(line, &row) != nil {
			return nil
		}
		if content, _ := row["content"].(string); content != "" {
			if parsed := extractAntigravitySelectedModel(content); parsed != "" {
				model = parsed
			}
		}
		source, _ := row["source"].(string)
		stepType, _ := row["type"].(string)
		isModelTurn := strings.EqualFold(source, "MODEL") ||
			strings.EqualFold(stepType, "PLANNER_RESPONSE") ||
			strings.EqualFold(stepType, "GENERATE_RESPONSE")
		if !isModelTurn {
			return nil
		}
		date := ""
		if created, _ := row["created_at"].(string); created != "" {
			if t, err := time.Parse(time.RFC3339, created); err == nil {
				date = t.UTC().Format("2006-01-02")
			} else if t, err := time.Parse(time.RFC3339Nano, created); err == nil {
				date = t.UTC().Format("2006-01-02")
			}
		}
		b := antigravityBucket(buckets, date, model, antigravityLocalSource)
		b.Requests++
		return nil
	})
}

func extractAntigravitySelectedModel(content string) string {
	lower := strings.ToLower(content)
	idx := strings.Index(lower, "model selection")
	if idx < 0 {
		return ""
	}
	rest := content[idx:]
	toIdx := strings.Index(strings.ToLower(rest), " to ")
	if toIdx < 0 {
		return ""
	}
	name := rest[toIdx+4:]
	// Sentence end is ". " / ".\n" / ".</" — not the dot inside "3.6".
	cut := len(name)
	for i := 0; i < len(name); i++ {
		if name[i] != '.' {
			continue
		}
		if i+1 >= len(name) {
			cut = i
			break
		}
		next := name[i+1]
		if next == ' ' || next == '\n' || next == '\r' || next == '<' || next == '"' || next == '\'' {
			cut = i
			break
		}
	}
	return normalizeAntigravityModelName(name[:cut])
}

func normalizeAntigravityModelName(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, "`\"' ")
	s = strings.ReplaceAll(s, " (High)", "")
	s = strings.ReplaceAll(s, " (Medium)", "")
	s = strings.ReplaceAll(s, " (Low)", "")
	s = strings.ReplaceAll(s, " (Thinking)", "")
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	switch {
	case strings.Contains(lower, "gemini") && strings.Contains(lower, "3.6") && strings.Contains(lower, "flash"):
		return "gemini-3.6-flash"
	case strings.Contains(lower, "gemini") && strings.Contains(lower, "3.5") && strings.Contains(lower, "flash"):
		return "gemini-3.5-flash"
	case strings.Contains(lower, "gemini") && strings.Contains(lower, "3.1") && strings.Contains(lower, "pro"):
		return "gemini-3.1-pro"
	case strings.Contains(lower, "claude") && strings.Contains(lower, "sonnet"):
		return "claude-sonnet-4.6"
	case strings.Contains(lower, "claude") && strings.Contains(lower, "opus"):
		return "claude-opus-4.6"
	case s == "":
		return ""
	default:
		return strings.ToLower(strings.ReplaceAll(s, " ", "-"))
	}
}

func scanAntigravityConversationDB(dbPath string, buckets map[string]*types.DailyUsage) error {
	if _, err := os.Stat(dbPath); err != nil {
		return err
	}
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	modelByCascade := loadAntigravityModels(db)
	dayByCascade := loadAntigravityDays(db)

	rows, err := db.Query(`
		SELECT cascade_id, step_payload, COALESCE(created_at, 0)
		FROM steps
		WHERE step_payload IS NOT NULL
	`)
	if err != nil {
		// Older / alternate schemas: try without created_at.
		rows, err = db.Query(`SELECT cascade_id, step_payload, 0 FROM steps WHERE step_payload IS NOT NULL`)
		if err != nil {
			return err
		}
	}
	defer rows.Close()

	for rows.Next() {
		var cascadeID string
		var payload []byte
		var createdAt int64
		if err := rows.Scan(&cascadeID, &payload, &createdAt); err != nil {
			continue
		}
		input, output, ok := parseAntigravityUsagePayload(payload)
		if !ok || input+output == 0 {
			continue
		}
		model := modelByCascade[cascadeID]
		date := dayByCascade[cascadeID]
		if date == "" && createdAt > 0 {
			sec := createdAt
			if createdAt > 1_000_000_000_000 {
				sec = createdAt / 1000
			}
			date = time.Unix(sec, 0).UTC().Format("2006-01-02")
		}
		b := antigravityBucket(buckets, date, model, antigravityUsageSource)
		b.InputTokens += input
		b.OutputTokens += output
		b.Requests++
	}
	return rows.Err()
}

func loadAntigravityModels(db *sql.DB) map[string]string {
	out := map[string]string{}
	rows, err := db.Query(`SELECT cascade_id, COALESCE(model, '') FROM trajectory_meta`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, model string
		if rows.Scan(&id, &model) == nil && id != "" && model != "" {
			out[id] = model
		}
	}
	return out
}

func loadAntigravityDays(db *sql.DB) map[string]string {
	out := map[string]string{}
	rows, err := db.Query(`SELECT cascade_id, COALESCE(created_at, 0) FROM trajectory_meta`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var createdAt int64
		if rows.Scan(&id, &createdAt) != nil || id == "" || createdAt == 0 {
			continue
		}
		sec := createdAt
		if createdAt > 1_000_000_000_000 {
			sec = createdAt / 1000
		}
		out[id] = time.Unix(sec, 0).UTC().Format("2006-01-02")
	}
	return out
}

func parseAntigravityUsagePayload(payload []byte) (input, output int, ok bool) {
	if len(payload) == 0 {
		return 0, 0, false
	}
	// JSON object or embedded JSON with UsageMetadata.
	if hit, found := parseAntigravityUsageJSON(payload); found {
		return hit.input, hit.output, true
	}
	// Plaintext / protobuf blob with labeled token counts near field names.
	if in, out, found := parseAntigravityUsageLabels(payload); found {
		return in, out, true
	}
	return 0, 0, false
}

type antigravityTokenHit struct {
	input  int
	output int
}

func parseAntigravityUsageJSON(payload []byte) (antigravityTokenHit, bool) {
	trimmed := bytesTrimSpace(payload)
	if len(trimmed) == 0 {
		return antigravityTokenHit{}, false
	}
	candidates := [][]byte{trimmed}
	// Sometimes UsageMetadata is nested inside a larger JSON document as a string.
	if idx := indexFold(trimmed, []byte(`"usageMetadata"`)); idx >= 0 {
		candidates = append(candidates, trimmed[idx:])
	}
	if idx := indexFold(trimmed, []byte(`"usage_metadata"`)); idx >= 0 {
		candidates = append(candidates, trimmed[idx:])
	}
	for _, cand := range candidates {
		var root any
		if json.Unmarshal(cand, &root) != nil {
			// Try to locate a JSON object substring.
			if obj := extractJSONObject(cand); obj != nil {
				root = nil
				if json.Unmarshal(obj, &root) != nil {
					continue
				}
			} else {
				continue
			}
		}
		if hit, ok := findUsageInJSON(root); ok {
			return hit, true
		}
	}
	return antigravityTokenHit{}, false
}

func findUsageInJSON(v any) (antigravityTokenHit, bool) {
	switch t := v.(type) {
	case map[string]any:
		for _, keys := range usageJSONKeys {
			in := jsonInt(t, keys.input)
			out := jsonInt(t, keys.output)
			if in+out > 0 {
				return antigravityTokenHit{input: in, output: out}, true
			}
			if total := jsonInt(t, keys.total); total > 0 {
				return antigravityTokenHit{input: total, output: 0}, true
			}
		}
		for _, nestedKey := range []string{"usageMetadata", "usage_metadata", "usage", "UsageMetadata"} {
			if nested, ok := t[nestedKey]; ok {
				if hit, found := findUsageInJSON(nested); found {
					return hit, true
				}
			}
		}
		for _, nested := range t {
			if hit, found := findUsageInJSON(nested); found {
				return hit, true
			}
		}
	case []any:
		for _, nested := range t {
			if hit, found := findUsageInJSON(nested); found {
				return hit, true
			}
		}
	}
	return antigravityTokenHit{}, false
}

func parseAntigravityUsageLabels(payload []byte) (input, output int, ok bool) {
	matches := tokenNearLabelRe.FindAllSubmatch(payload, -1)
	if len(matches) == 0 {
		return 0, 0, false
	}
	for _, m := range matches {
		if len(m) < 3 {
			continue
		}
		label := strings.ToLower(string(m[1]))
		n, err := strconv.Atoi(string(m[2]))
		if err != nil || n < 0 {
			continue
		}
		switch {
		case strings.Contains(label, "prompt") || strings.Contains(label, "input"):
			input += n
			ok = true
		case strings.Contains(label, "completion") || strings.Contains(label, "candidates") || strings.Contains(label, "output"):
			output += n
			ok = true
		case strings.Contains(label, "total") && input+output == 0:
			input += n
			ok = true
		}
	}
	return input, output, ok
}

func jsonInt(m map[string]any, key string) int {
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	default:
		return 0
	}
}

func bytesTrimSpace(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

func indexFold(haystack, needle []byte) int {
	return strings.Index(strings.ToLower(string(haystack)), strings.ToLower(string(needle)))
}

func extractJSONObject(b []byte) []byte {
	start := -1
	depth := 0
	for i, c := range b {
		if c == '{' {
			if depth == 0 {
				start = i
			}
			depth++
		} else if c == '}' && depth > 0 {
			depth--
			if depth == 0 && start >= 0 {
				return b[start : i+1]
			}
		}
	}
	return nil
}
