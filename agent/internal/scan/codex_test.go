package scan

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/usejunction/agent/internal/types"
)

func TestParseCodexCumulativeDeltaIgnoresRepeatedSnapshots(t *testing.T) {
	state := &codexSessionState{}
	row1 := map[string]any{
		"type":      "event_msg",
		"timestamp": "2026-07-03T12:00:00Z",
		"payload": map[string]any{
			"type":  "token_count",
			"model": "gpt-5.2",
			"info": map[string]any{
				"total_token_usage": map[string]any{
					"input_tokens": float64(100), "output_tokens": float64(10),
				},
			},
		},
	}
	row2 := map[string]any{
		"type":      "event_msg",
		"timestamp": "2026-07-03T12:00:01Z",
		"payload": map[string]any{
			"type":  "token_count",
			"model": "gpt-5.2",
			"info": map[string]any{
				"total_token_usage": map[string]any{
					"input_tokens": float64(100), "output_tokens": float64(10),
				},
			},
		},
	}
	row3 := map[string]any{
		"type":      "event_msg",
		"timestamp": "2026-07-03T12:00:02Z",
		"payload": map[string]any{
			"type":  "token_count",
			"model": "gpt-5.2",
			"info": map[string]any{
				"total_token_usage": map[string]any{
					"input_tokens": float64(150), "output_tokens": float64(20),
				},
			},
		},
	}

	h1 := parseCodexCumulativeDelta(row1, state)
	h2 := parseCodexCumulativeDelta(row2, state)
	h3 := parseCodexCumulativeDelta(row3, state)
	if !h1.ok || h1.input != 100 || h1.output != 10 {
		t.Fatalf("first delta: %#v", h1)
	}
	if h2.ok {
		t.Fatalf("repeated snapshot should not count again: %#v", h2)
	}
	if !h3.ok || h3.input != 50 || h3.output != 10 {
		t.Fatalf("second delta: %#v", h3)
	}
}

func TestBillableInputTokensOpenAI(t *testing.T) {
	if got := BillableInputTokens("codex", 1000, 400); got != 600 {
		t.Fatalf("expected 600 uncached input, got %d", got)
	}
}

func TestEstimateCostForToolUsesUncachedInput(t *testing.T) {
	cached := EstimateCostForTool("codex", "gpt-5", 1_000_000, 0, 400_000, 0)
	doubleCharged := (float64(1_000_000)/1e6)*1.25 + (float64(400_000)/1e6)*0.125
	if cached >= doubleCharged-0.001 {
		t.Fatalf("should not bill full input plus cache read: cached=%f double=%f", cached, doubleCharged)
	}
}

func TestCodexToolNameFromOriginator(t *testing.T) {
	cases := map[string]string{
		"codex_work_desktop": codexWorkToolName,
		"Codex Desktop":      codexToolName,
		"codex_exec":         codexToolName,
		"":                   codexToolName,
	}
	for originator, want := range cases {
		if got := codexToolNameFromOriginator(originator); got != want {
			t.Fatalf("originator %q: got %q want %q", originator, got, want)
		}
	}
}

func TestSanitizeCodexToolName(t *testing.T) {
	if got := sanitizeCodexToolName("_import_document"); got != "_import_document" {
		t.Fatalf("got %q", got)
	}
	if sanitizeCodexToolName("bad name") != "" {
		t.Fatal("expected reject spaces")
	}
	if sanitizeCodexToolName(strings.Repeat("a", maxToolNameLen+1)) != "" {
		t.Fatal("expected reject oversize")
	}
}

func TestProcessCodexWorkFileAttributesSurfaceAndTools(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "work-session.jsonl")

	var buf bytes.Buffer
	appendRow := func(row map[string]any) {
		raw, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		buf.Write(raw)
		buf.WriteByte('\n')
	}
	appendRow(map[string]any{
		"type": "session_meta", "timestamp": "2026-07-17T10:00:00Z",
		"payload": map[string]any{
			"originator": "codex_work_desktop",
			"git":        map[string]any{"repository_url": "https://github.com/acme/demo.git"},
		},
	})
	appendRow(map[string]any{
		"type": "event_msg", "timestamp": "2026-07-17T10:00:01Z",
		"payload": map[string]any{
			"type": "token_count", "model": "gpt-5.2",
			"info": map[string]any{"total_token_usage": map[string]any{"input_tokens": float64(100), "output_tokens": float64(10)}},
		},
	})
	buf.WriteString(strings.Repeat("z", (1<<20)+64))
	buf.WriteByte('\n')
	appendRow(map[string]any{
		"type": "response_item", "timestamp": "2026-07-17T10:00:02Z",
		"payload": map[string]any{"type": "custom_tool_call", "name": "imagegen"},
	})
	appendRow(map[string]any{
		"type": "response_item", "timestamp": "2026-07-17T10:00:03Z",
		"payload": map[string]any{"type": "function_call", "name": "_import_document"},
	})
	appendRow(map[string]any{
		"type": "event_msg", "timestamp": "2026-07-17T10:00:04Z",
		"payload": map[string]any{
			"type": "token_count", "model": "gpt-5.2",
			"info": map[string]any{"total_token_usage": map[string]any{"input_tokens": float64(150), "output_tokens": float64(20)}},
		},
	})
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	buckets := map[string]*types.DailyUsage{}
	processCodexFile(path, buckets, map[string]string{}, "acct-test")

	var usage *types.DailyUsage
	toolCounts := map[string]int{}
	var flowRow *types.DailyUsage
	for _, b := range buckets {
		if b.ToolName != codexWorkToolName {
			t.Fatalf("expected toolName %q, got %#v", codexWorkToolName, b)
		}
		switch {
		case b.MetricKind == types.MetricKindUsage:
			usage = b
		case strings.HasPrefix(b.Model, "tool:"):
			toolCounts[strings.TrimPrefix(b.Model, "tool:")] = b.Requests
		case strings.HasPrefix(b.Model, "flow:"):
			flowRow = b
		}
	}
	if usage == nil || usage.Requests != 2 || usage.InputTokens != 150 || usage.OutputTokens != 20 {
		t.Fatalf("usage row: %#v", usage)
	}
	if usage.Repository == nil || usage.Repository.Owner != "acme" || usage.Repository.Name != "demo" {
		t.Fatalf("repository from session_meta: %#v", usage.Repository)
	}
	if toolCounts["imagegen"] != 1 || toolCounts["_import_document"] != 1 {
		t.Fatalf("tool counts: %#v", toolCounts)
	}
	if flowRow == nil || flowRow.Requests != 1 || !strings.Contains(flowRow.Model, "imagegen") {
		t.Fatalf("flow row: %#v", flowRow)
	}
}

func TestScanCodexForcesRequestOnTokenOnlyUsageRow(t *testing.T) {
	dir := t.TempDir()
	sessions := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(sessions, 0o755); err != nil {
		t.Fatal(err)
	}
	// Hand-build a bucket-like finalize case: tokens present, Requests left at 0
	// before ScanCodex's finalize pass (simulates summary/rollup shape).
	path := filepath.Join(sessions, "rollout.jsonl")
	var buf bytes.Buffer
	write := func(v any) {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	write(map[string]any{
		"type": "session_meta", "timestamp": "2026-09-01T10:00:00Z",
		"payload": map[string]any{"originator": "codex_cli"},
	})
	// Single cumulative total — one request after parse; then we zero Requests
	write(map[string]any{
		"type": "event_msg", "timestamp": "2026-09-01T10:00:01Z",
		"payload": map[string]any{
			"type": "token_count", "model": "gpt-5.2-codex",
			"info": map[string]any{"total_token_usage": map[string]any{
				"input_tokens": float64(5000), "output_tokens": float64(50),
			}},
		},
	})
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	rows, err := ScanCodex(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	var usage *types.DailyUsage
	for i := range rows {
		if rows[i].MetricKind == types.MetricKindUsage {
			usage = &rows[i]
			break
		}
	}
	if usage == nil {
		t.Fatal("expected usage row")
	}
	if usage.Requests < 1 {
		t.Fatalf("expected requests >= 1 for token-bearing usage row, got %#v", usage)
	}
	if usage.InputTokens < 1 || usage.EstimatedCost <= 0 {
		t.Fatalf("expected tokens+cost, got %#v", usage)
	}
}
