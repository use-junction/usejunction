package scan

import (
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

func workspaceStorageRoots() []string {
	return platformdirs.WorkspaceStorageRoots()
}

// ScanCopilot reads opt-in Copilot Chat agent-traces.db token spans when present.
// It never enables debug logging and never reads prompt content.
func ScanCopilot(refresh bool) ([]types.DailyUsage, error) {
	cacheFile := filepath.Join(config.CacheDir(), "copilot.json")
	if !refresh {
		if cached, err := loadCache(cacheFile); err == nil && len(cached) > 0 {
			return cached, nil
		}
	}

	buckets := map[string]*types.DailyUsage{}
	for _, root := range workspaceStorageRoots() {
		matches, _ := filepath.Glob(filepath.Join(root, "*", "GitHub.copilot-chat", "agent-traces.db"))
		for _, dbPath := range matches {
			_ = scanCopilotTracesDB(dbPath, buckets)
		}
		// Also parse compact debug JSONL metadata if present (token fields only).
		debugMatches, _ := filepath.Glob(filepath.Join(root, "*", "GitHub.copilot-chat", "debug-logs", "*.jsonl"))
		for _, path := range debugMatches {
			_ = scanCopilotDebugJSONL(path, buckets)
		}
	}

	result := make([]types.DailyUsage, 0, len(buckets))
	for _, b := range buckets {
		if b.EstimatedCost == 0 {
			b.EstimatedCost = EstimateCost(b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens)
		}
		result = append(result, *b)
	}
	prev, _ := loadCache(cacheFile)
	result = StampObservedActivity(prev, result, SignedInAccount("copilot"))
	_ = saveCache(cacheFile, result)
	return result, nil
}

func scanCopilotTracesDB(dbPath string, buckets map[string]*types.DailyUsage) error {
	db, err := sqlitedb.OpenReadonly(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	// Schema varies; try common OTel span columns.
	rows, err := db.Query(`
		SELECT COALESCE(request_model, model, '') AS model,
		       date(COALESCE(end_time_ms, start_time_ms)/1000, 'unixepoch') AS day,
		       COALESCE(SUM(input_tokens), 0),
		       COALESCE(SUM(output_tokens), 0),
		       COALESCE(SUM(cached_tokens), 0),
		       COUNT(*)
		FROM spans
		WHERE COALESCE(operation_name, '') IN ('', 'chat', 'completion')
		GROUP BY model, day
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var model, day string
		var in, out, cached, n int
		if rows.Scan(&model, &day, &in, &out, &cached, &n) != nil {
			continue
		}
		if day == "" || in+out == 0 {
			continue
		}
		if model == "" {
			model = "copilot"
		}
		key := day + "|" + model
		if buckets[key] == nil {
			buckets[key] = &types.DailyUsage{Date: day, ToolName: "copilot", Model: model, Source: "copilot_traces"}
		}
		b := buckets[key]
		b.InputTokens += in
		b.OutputTokens += out
		b.CacheReadTokens += cached
		b.Requests += n
	}
	return nil
}

func scanCopilotDebugJSONL(path string, buckets map[string]*types.DailyUsage) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	for dec.More() {
		var row map[string]any
		if dec.Decode(&row) != nil {
			continue
		}
		model, _ := row["model"].(string)
		in := intVal(row["inputTokens"])
		out := intVal(row["outputTokens"])
		cached := intVal(row["cachedTokens"])
		if in+out == 0 {
			continue
		}
		day := time.Now().Format("2006-01-02")
		if ts, ok := row["timestamp"].(string); ok && ts != "" {
			if t, err := time.Parse(time.RFC3339, ts); err == nil {
				day = t.Format("2006-01-02")
			}
		}
		if model == "" {
			model = "copilot"
		}
		key := day + "|" + model
		if buckets[key] == nil {
			buckets[key] = &types.DailyUsage{Date: day, ToolName: "copilot", Model: model, Source: "copilot_debug"}
		}
		b := buckets[key]
		b.InputTokens += in
		b.OutputTokens += out
		b.CacheReadTokens += cached
		b.Requests++
	}
	return nil
}

func globalStorageRoots() []string {
	return platformdirs.GlobalStorageRoots()
}

var clineExtensionDirs = map[string][]string{
	"cline": {"saoudrizwan.claude-dev"},
	"roo":   {"rooveterinaryinc.roo-cline", "roo.roo-cline"},
}

// ScanClineFamily walks Cline/Roo task history for token/cost metadata under
// VS Code/Cursor globalStorage extension dirs. OpenCode uses ScanOpenCode
// (standalone ~/.local/share/opencode/opencode.db).
func ScanClineFamily(tool string, refresh bool) ([]types.DailyUsage, error) {
	cacheFile := filepath.Join(config.CacheDir(), tool+".json")
	if !refresh {
		if cached, err := loadCache(cacheFile); err == nil && len(cached) > 0 {
			return cached, nil
		}
	}

	dirs := clineExtensionDirs[tool]
	if len(dirs) == 0 {
		dirs = []string{tool}
	}

	buckets := map[string]*types.DailyUsage{}
	for _, root := range globalStorageRoots() {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			match := false
			for _, d := range dirs {
				if strings.Contains(name, strings.ToLower(d)) || strings.Contains(name, tool) {
					match = true
					break
				}
			}
			if !match {
				continue
			}
			base := filepath.Join(root, e.Name())
			_ = filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
				if err != nil || info.IsDir() {
					return nil
				}
				baseName := strings.ToLower(info.Name())
				if baseName != "api_conversation_history.json" &&
					baseName != "ui_messages.json" &&
					!strings.HasSuffix(baseName, "task.json") &&
					baseName != "api_req_info.json" {
					return nil
				}
				_ = scanClineJSONFile(path, tool, buckets)
				return nil
			})
		}
	}

	result := make([]types.DailyUsage, 0, len(buckets))
	for _, b := range buckets {
		if b.EstimatedCost == 0 {
			b.EstimatedCost = EstimateCost(b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens)
		}
		result = append(result, *b)
	}
	_ = saveCache(cacheFile, result)
	return result, nil
}

func scanClineJSONFile(path, tool string, buckets map[string]*types.DailyUsage) error {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return err
	}
	var rows []map[string]any
	if json.Unmarshal(data, &rows) != nil {
		var single map[string]any
		if json.Unmarshal(data, &single) != nil {
			return nil
		}
		rows = []map[string]any{single}
	}
	day := time.Now().Format("2006-01-02")
	if info, err := os.Stat(path); err == nil {
		day = info.ModTime().Format("2006-01-02")
	}
	for _, row := range rows {
		extractClineUsage(row, tool, day, buckets)
	}
	return nil
}

func extractClineUsage(row map[string]any, tool, day string, buckets map[string]*types.DailyUsage) {
	// Common shapes: tokensIn/tokensOut/cacheReads/cost, or usage object.
	in := intVal(row["tokensIn"])
	out := intVal(row["tokensOut"])
	cacheRead := intVal(row["cacheReads"])
	if cacheRead == 0 {
		cacheRead = intVal(row["cacheReadTokens"])
	}
	cacheWrite := intVal(row["cacheWrites"])
	cost, _ := row["cost"].(float64)
	if cost == 0 {
		if c, ok := row["totalCost"].(float64); ok {
			cost = c
		}
	}
	model, _ := row["model"].(string)
	if model == "" {
		model, _ = row["modelId"].(string)
	}
	if usage, ok := row["usage"].(map[string]any); ok {
		if in == 0 {
			in = intVal(usage["input_tokens"])
			out = intVal(usage["output_tokens"])
			cacheRead = intVal(usage["cache_read_input_tokens"])
			cacheWrite = intVal(usage["cache_creation_input_tokens"])
		}
	}
	// Nested api metrics
	if api, ok := row["apiMetrics"].(map[string]any); ok {
		if in == 0 {
			in = intVal(api["tokensIn"])
			out = intVal(api["tokensOut"])
			cacheRead = intVal(api["cacheReads"])
			cacheWrite = intVal(api["cacheWrites"])
		}
		if cost == 0 {
			if c, ok := api["cost"].(float64); ok {
				cost = c
			}
		}
	}
	if in+out == 0 && cost == 0 {
		return
	}
	if model == "" {
		model = tool
	}
	key := day + "|" + model
	if buckets[key] == nil {
		buckets[key] = &types.DailyUsage{Date: day, ToolName: tool, Model: model, Source: "local_scan"}
	}
	b := buckets[key]
	b.InputTokens += in
	b.OutputTokens += out
	b.CacheReadTokens += cacheRead
	b.CacheWriteTokens += cacheWrite
	b.EstimatedCost += cost
	b.Requests++
}

// ScanContinue reads ~/.continue session history for token usage when present.
func ScanContinue(refresh bool) ([]types.DailyUsage, error) {
	cacheFile := filepath.Join(config.CacheDir(), "continue.json")
	if !refresh {
		if cached, err := loadCache(cacheFile); err == nil && len(cached) > 0 {
			return cached, nil
		}
	}
	home, _ := os.UserHomeDir()
	roots := []string{
		filepath.Join(home, ".continue", "sessions"),
		filepath.Join(home, ".continue", "index"),
		filepath.Join(home, ".continue"),
	}
	buckets := map[string]*types.DailyUsage{}
	for _, root := range roots {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			name := strings.ToLower(info.Name())
			if !strings.HasSuffix(name, ".json") && !strings.HasSuffix(name, ".jsonl") {
				return nil
			}
			if strings.Contains(name, "config") {
				return nil
			}
			_ = scanContinueFile(path, buckets)
			return nil
		})
	}
	result := make([]types.DailyUsage, 0, len(buckets))
	for _, b := range buckets {
		if b.EstimatedCost == 0 {
			b.EstimatedCost = EstimateCost(b.Model, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens)
		}
		result = append(result, *b)
	}
	_ = saveCache(cacheFile, result)
	return result, nil
}

func scanContinueFile(path string, buckets map[string]*types.DailyUsage) error {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return err
	}
	day := time.Now().Format("2006-01-02")
	if info, err := os.Stat(path); err == nil {
		day = info.ModTime().Format("2006-01-02")
	}
	// JSONL
	if strings.HasSuffix(strings.ToLower(path), ".jsonl") {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var row map[string]any
			if json.Unmarshal([]byte(line), &row) != nil {
				continue
			}
			extractContinueUsage(row, day, buckets)
		}
		return nil
	}
	var obj map[string]any
	if json.Unmarshal(data, &obj) == nil {
		extractContinueUsage(obj, day, buckets)
		if hist, ok := obj["history"].([]any); ok {
			for _, item := range hist {
				if m, ok := item.(map[string]any); ok {
					extractContinueUsage(m, day, buckets)
				}
			}
		}
	}
	return nil
}

func extractContinueUsage(row map[string]any, day string, buckets map[string]*types.DailyUsage) {
	in := intVal(row["promptTokens"])
	out := intVal(row["completionTokens"])
	if in == 0 {
		in = intVal(row["inputTokens"])
		out = intVal(row["outputTokens"])
	}
	model, _ := row["model"].(string)
	if model == "" {
		model, _ = row["modelTitle"].(string)
	}
	if in+out == 0 {
		return
	}
	if model == "" {
		model = "continue"
	}
	key := day + "|" + model
	if buckets[key] == nil {
		buckets[key] = &types.DailyUsage{Date: day, ToolName: "continue", Model: model, Source: "local_scan"}
	}
	b := buckets[key]
	b.InputTokens += in
	b.OutputTokens += out
	b.Requests++
}
