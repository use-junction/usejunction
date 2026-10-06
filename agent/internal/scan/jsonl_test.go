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

func TestForEachJSONLLineSkipsOversizedAndContinues(t *testing.T) {
	var b strings.Builder
	b.WriteString("{\"ok\":1}\n")
	b.WriteString(strings.Repeat("x", (1<<20)+100))
	b.WriteString("\n")
	b.WriteString("{\"ok\":2}\n")

	var got []string
	err := forEachJSONLLine(strings.NewReader(b.String()), 1<<20, func(line []byte) error {
		got = append(got, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("forEachJSONLLine: %v", err)
	}
	if len(got) != 2 || got[0] != `{"ok":1}` || got[1] != `{"ok":2}` {
		t.Fatalf("expected two small lines, got %#v", got)
	}
}

func TestForEachJSONLLineFinalLineWithoutNewline(t *testing.T) {
	var got []string
	err := forEachJSONLLine(strings.NewReader(`{"ok":1}`), defaultJSONLMaxKeep, func(line []byte) error {
		got = append(got, string(line))
		return nil
	})
	if err != nil {
		t.Fatalf("forEachJSONLLine: %v", err)
	}
	if len(got) != 1 || got[0] != `{"ok":1}` {
		t.Fatalf("expected final line, got %#v", got)
	}
}

func TestProcessCodexFileKeepsUsageAfterOversizedLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.jsonl")

	tokenCount := func(ts string, input, output int) string {
		row := map[string]any{
			"type":      "event_msg",
			"timestamp": ts,
			"payload": map[string]any{
				"type":  "token_count",
				"model": "gpt-5.2",
				"info": map[string]any{
					"total_token_usage": map[string]any{
						"input_tokens":  float64(input),
						"output_tokens": float64(output),
					},
				},
			},
		}
		raw, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}

	var buf bytes.Buffer
	buf.WriteString(tokenCount("2026-07-17T10:00:00Z", 100, 10))
	buf.WriteByte('\n')
	buf.WriteString(strings.Repeat("z", (1<<20)+64))
	buf.WriteByte('\n')
	buf.WriteString(tokenCount("2026-07-17T11:00:00Z", 150, 20))
	buf.WriteByte('\n')

	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	buckets := map[string]*types.DailyUsage{}
	processCodexFile(path, buckets, map[string]string{}, "acct-test")

	totalReq, totalIn, totalOut := 0, 0, 0
	for _, b := range buckets {
		totalReq += b.Requests
		totalIn += b.InputTokens
		totalOut += b.OutputTokens
	}
	// First event: 100/10, second cumulative delta: 50/10 → totals 150/20 across 2 requests.
	if totalReq != 2 || totalIn != 150 || totalOut != 20 {
		t.Fatalf("expected both deltas kept (2 req, 150 in, 20 out), got req=%d in=%d out=%d buckets=%#v",
			totalReq, totalIn, totalOut, buckets)
	}
}
