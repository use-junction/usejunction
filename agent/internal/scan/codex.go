package scan

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/usejunction/agent/internal/config"
	"github.com/usejunction/agent/internal/types"
)

const calculationVersion = "usage-v2"

const (
	codexToolName     = "codex"
	codexWorkToolName = "codex-work"
	maxToolNameLen    = 64
	maxFlowTools      = 12
)

type tokenTuple struct {
	input, output, cacheRead, reasoning int
}

type codexSessionState struct {
	lastModel  string
	prevTotal  tokenTuple
	originator string
	toolName   string
	accountKey string
	lastDate   string
	// first-seen tool names for a discreet flow digest (names only).
	flowOrder []string
	flowSeen  map[string]bool
}

// ScanCodex walks ~/.codex/sessions (+ archived_sessions) JSONL using
// cumulative total_token_usage deltas.
// Sessions are attributed to "codex" or "codex-work" via session_meta.originator.
// When forceFull is false and no session JSONL changed since the last snapshot,
// prior aggregates are reused.
func ScanCodex(codexHome string, forceFull bool) ([]types.DailyUsage, error) {
	dirs := []string{
		filepath.Join(codexHome, "sessions"),
		filepath.Join(codexHome, "archived_sessions"),
	}
	current, keys, _ := CollectJSONLWatermarks(dirs)
	snap, _ := LoadScanSnapshot()
	if !forceFull && JSONLSourcesUnchanged(snap, dirs, current, keys) {
		if rows := AggregatesForTools(snap, codexToolName, codexWorkToolName); len(rows) > 0 || len(keys) == 0 {
			return rows, nil
		}
	}

	cacheFile := filepath.Join(config.CacheDir(), "codex.json")
	buckets := map[string]*types.DailyUsage{}
	accountFiles := snap.cloneAccountFiles()
	signedIn := SignedInAccount(codexToolName)
	for _, root := range dirs {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".jsonl") {
				return nil
			}
			processCodexFile(path, buckets, accountFiles, signedIn)
			return nil
		})
	}

	result := make([]types.DailyUsage, 0, len(buckets))
	for _, b := range buckets {
		if b.EstimatedCost == 0 && b.MetricKind != types.MetricKindProductivity {
			pricingTool := b.ToolName
			if pricingTool == codexWorkToolName {
				pricingTool = codexToolName
			}
			b.EstimatedCost = EstimateCostForTool(
				pricingTool, b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens,
			)
		}
		if b.Source == "" {
			b.Source = "local_scan"
		}
		if b.MetricKind == "" {
			b.MetricKind = types.MetricKindUsage
		}
		// Summary / rollup paths can leave tokens+cost with Requests=0. Ensure every
		// usage-kind row that carries activity reports at least one model call so
		// dashboard request KPIs are not sealed to zero while cost shows.
		if b.MetricKind != types.MetricKindProductivity &&
			b.Requests == 0 &&
			(b.InputTokens+b.OutputTokens > 0 || b.EstimatedCost > 0) {
			b.Requests = 1
		}
		if b.CostKind == "" && b.EstimatedCost > 0 {
			b.CostKind = types.CostKindEstimatedAPI
		}
		if b.TokenSemantics == "" {
			b.TokenSemantics = types.TokenSemanticsOpenAI
		}
		b.CalculationVersion = calculationVersion
		result = append(result, *b)
	}
	result = PruneAggregatesLookback(result, time.Now().UTC())

	_ = saveCache(cacheFile, result)
	_ = CommitScanSnapshotUpdate(func(snap *ScanSnapshot) {
		snap.mergeAccountFiles(accountFiles)
		snap.Aggregates = ReplaceToolNamesAggregates(snap.Aggregates, []string{codexToolName, codexWorkToolName}, result)
		if snap.Sources == nil {
			snap.Sources = map[string]SourceWatermark{}
		}
		for key, wm := range current {
			snap.Sources[key] = wm
		}
		// Drop stale jsonl watermarks under codex roots.
		for key, wm := range snap.Sources {
			if strings.HasPrefix(key, "jsonl:") && strings.Contains(wm.Path, "codex") {
				if _, ok := current[key]; !ok {
					delete(snap.Sources, key)
				}
			}
		}
	})
	return result, nil
}

func processCodexFile(path string, buckets map[string]*types.DailyUsage, accountFiles map[string]string, signedIn string) {
	state := &codexSessionState{
		toolName:   codexToolName,
		flowSeen:   map[string]bool{},
		accountKey: RememberFile(accountFiles, path, "", signedIn),
	}
	var repository *types.RepositoryIdentity

	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	_ = forEachJSONLLine(f, defaultJSONLMaxKeep, func(line []byte) error {
		var row map[string]any
		if json.Unmarshal(line, &row) != nil {
			return nil
		}

		if originator := codexOriginatorFromRow(row); originator != "" {
			state.originator = originator
			state.toolName = codexToolNameFromOriginator(originator)
		}
		if acc := AccountFromRecord(row); acc != "" {
			state.accountKey = RememberFile(accountFiles, path, acc, signedIn)
		}
		if repository == nil {
			repository = repositoryFromCodexRow(row)
		}
		if model := codexModelFromRow(row); model != "" {
			state.lastModel = model
		}

		if name := codexToolCallName(row); name != "" {
			date := parseCodexTimestamp(row)
			recordCodexToolCall(buckets, state, name, date, repository)
			if date != "" {
				state.lastDate = date
			}
		}

		hit := parseCodexCumulativeDelta(row, state)
		if !hit.ok {
			return nil
		}
		if hit.model == "" {
			hit.model = state.lastModel
		}
		if hit.model == "" {
			hit.model = "unknown"
		}
		if hit.date != "" {
			state.lastDate = hit.date
		}

		repoKey := ""
		if repository != nil {
			repoKey = repository.Host + "/" + repository.Owner + "/" + repository.Name
		}
		key := hit.date + "|" + state.toolName + "|" + hit.model + "|" + repoKey + "|" + state.accountKey
		if buckets[key] == nil {
			buckets[key] = &types.DailyUsage{
				Date: hit.date, ToolName: state.toolName, Model: hit.model, AccountKey: state.accountKey,
				Repository: repository, Source: "local_scan",
				MetricKind: types.MetricKindUsage, TokenSemantics: types.TokenSemanticsOpenAI,
				Metadata: codexSurfaceMetadata(state.originator, "usage"),
			}
		}
		b := buckets[key]
		b.InputTokens += hit.input
		b.OutputTokens += hit.output
		b.CacheReadTokens += hit.cacheRead
		b.ReasoningTokens += hit.reasoning
		b.Requests++
		return nil
	})

	emitCodexFlowDigest(buckets, state)
}

// repositoryFromCodexRow reads git.repository_url from session_meta — no second
// file pass and no git -C into the workspace (avoids TCC prompts + timeouts).
func repositoryFromCodexRow(row map[string]any) *types.RepositoryIdentity {
	typ, _ := row["type"].(string)
	if typ != "session_meta" {
		return nil
	}
	payload, _ := row["payload"].(map[string]any)
	if payload == nil {
		return nil
	}
	git, _ := payload["git"].(map[string]any)
	if git == nil {
		return nil
	}
	raw, _ := git["repository_url"].(string)
	if raw == "" {
		raw, _ = git["repo_url"].(string)
	}
	return normalizeRemote(strings.TrimSpace(raw))
}

func recordCodexToolCall(
	buckets map[string]*types.DailyUsage,
	state *codexSessionState,
	name, date string,
	repository *types.RepositoryIdentity,
) {
	if date == "" {
		return
	}
	if !state.flowSeen[name] && len(state.flowOrder) < maxFlowTools {
		state.flowSeen[name] = true
		state.flowOrder = append(state.flowOrder, name)
	}

	model := "tool:" + name
	key := date + "|" + state.toolName + "|" + model + "|" + "|" + state.accountKey
	if buckets[key] == nil {
		buckets[key] = &types.DailyUsage{
			Date: date, ToolName: state.toolName, Model: model, AccountKey: state.accountKey,
			Source: "local_scan", MetricKind: types.MetricKindProductivity,
			Metadata: codexSurfaceMetadata(state.originator, "tool_inventory"),
		}
	}
	buckets[key].Requests++
}

func emitCodexFlowDigest(buckets map[string]*types.DailyUsage, state *codexSessionState) {
	if len(state.flowOrder) == 0 || state.lastDate == "" {
		return
	}
	digest := strings.Join(state.flowOrder, ">")
	if len(digest) > 200 {
		digest = digest[:200]
	}
	model := "flow:" + digest
	key := state.lastDate + "|" + state.toolName + "|" + model + "|" + "|" + state.accountKey
	if buckets[key] == nil {
		buckets[key] = &types.DailyUsage{
			Date: state.lastDate, ToolName: state.toolName, Model: model, AccountKey: state.accountKey,
			Source: "local_scan", MetricKind: types.MetricKindProductivity,
			Metadata: codexSurfaceMetadata(state.originator, "tool_flow"),
		}
	}
	buckets[key].Requests++
}

func codexSurfaceMetadata(originator, kind string) map[string]any {
	meta := map[string]any{"kind": kind}
	if originator != "" {
		meta["originator"] = originator
	}
	return meta
}

// codexToolNameFromOriginator maps Codex runtime originators to Junction tool names.
func codexToolNameFromOriginator(originator string) string {
	o := strings.ToLower(strings.TrimSpace(originator))
	if o == "codex_work_desktop" || strings.Contains(o, "codex_work") || strings.HasPrefix(o, "codex-work") {
		return codexWorkToolName
	}
	return codexToolName
}

func codexOriginatorFromRow(row map[string]any) string {
	typ, _ := row["type"].(string)
	if typ != "session_meta" {
		return ""
	}
	if payload, ok := row["payload"].(map[string]any); ok {
		if originator, _ := payload["originator"].(string); originator != "" {
			return originator
		}
	}
	if originator, _ := row["originator"].(string); originator != "" {
		return originator
	}
	return ""
}

func codexToolCallName(row map[string]any) string {
	payload, _ := row["payload"].(map[string]any)
	if payload == nil {
		return ""
	}
	payloadType, _ := payload["type"].(string)
	if payloadType != "custom_tool_call" && payloadType != "function_call" {
		return ""
	}
	name, _ := payload["name"].(string)
	return sanitizeCodexToolName(name)
}

func sanitizeCodexToolName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > maxToolNameLen {
		return ""
	}
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.' || r == ':' || r == '-' {
			b.WriteRune(r)
		} else {
			return ""
		}
	}
	return b.String()
}

func parseCodexCumulativeDelta(row map[string]any, state *codexSessionState) usageHit {
	var hit usageHit
	typ, _ := row["type"].(string)
	if typ != "event_msg" {
		return hit
	}

	payload, _ := row["payload"].(map[string]any)
	if payload == nil {
		return parseCodexLegacyMsg(row)
	}
	payloadType, _ := payload["type"].(string)
	if payloadType != "token_count" {
		return hit
	}

	info, _ := payload["info"].(map[string]any)
	if info == nil {
		return hit
	}
	total := tokenTupleFromMap(info["total_token_usage"])
	if total.input+total.output == 0 {
		// Fall back to last_token_usage for older single-shot events.
		if usage, ok := info["last_token_usage"].(map[string]any); ok {
			hit.input = intVal(usage["input_tokens"])
			hit.output = intVal(usage["output_tokens"])
			hit.cacheRead = intVal(usage["cached_input_tokens"])
			hit.reasoning = intVal(usage["reasoning_output_tokens"])
			if hit.input+hit.output > 0 {
				hit.model, _ = payload["model"].(string)
				hit.date = parseCodexTimestamp(row)
				hit.ok = true
			}
		}
		return hit
	}

	delta := total
	if state.prevTotal.input+state.prevTotal.output > 0 &&
		total.input >= state.prevTotal.input && total.output >= state.prevTotal.output {
		delta = tokenTuple{
			input:     total.input - state.prevTotal.input,
			output:    total.output - state.prevTotal.output,
			cacheRead: total.cacheRead - state.prevTotal.cacheRead,
			reasoning: total.reasoning - state.prevTotal.reasoning,
		}
		if delta.input < 0 {
			delta.input = 0
		}
		if delta.output < 0 {
			delta.output = 0
		}
		if delta.cacheRead < 0 {
			delta.cacheRead = 0
		}
		if delta.reasoning < 0 {
			delta.reasoning = 0
		}
	} else if total.input < state.prevTotal.input || total.output < state.prevTotal.output {
		// Session reset — treat as fresh cumulative bucket.
		delta = total
	}
	state.prevTotal = total

	if delta.input+delta.output == 0 {
		return hit
	}

	hit.input = delta.input
	hit.output = delta.output
	hit.cacheRead = delta.cacheRead
	hit.reasoning = delta.reasoning
	hit.model, _ = payload["model"].(string)
	hit.date = parseCodexTimestamp(row)
	hit.ok = true
	return hit
}

func parseCodexLegacyMsg(row map[string]any) usageHit {
	var hit usageHit
	msg, _ := row["msg"].(map[string]any)
	if msg == nil {
		return hit
	}
	tc, _ := msg["token_count"].(map[string]any)
	if tc == nil {
		return hit
	}
	hit.input = intVal(tc["input_tokens"])
	hit.output = intVal(tc["output_tokens"])
	hit.cacheRead = intVal(tc["cached_input_tokens"])
	hit.reasoning = intVal(tc["reasoning_output_tokens"])
	if hit.input+hit.output == 0 {
		return hit
	}
	hit.model, _ = row["model"].(string)
	hit.date = parseCodexTimestamp(row)
	hit.ok = true
	return hit
}

func tokenTupleFromMap(v any) tokenTuple {
	m, _ := v.(map[string]any)
	if m == nil {
		return tokenTuple{}
	}
	return tokenTuple{
		input:     intVal(m["input_tokens"]),
		output:    intVal(m["output_tokens"]),
		cacheRead: intVal(m["cached_input_tokens"]),
		reasoning: intVal(m["reasoning_output_tokens"]),
	}
}
