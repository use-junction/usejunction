package scan

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/types"
)

func writeSessionLog(t *testing.T, path string, modified time.Time, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	body := ""
	for _, line := range lines {
		body += line + "\n"
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modified, modified); err != nil {
		t.Fatal(err)
	}
}

func TestScanClaudeEventsReadsOneEventPerResponse(t *testing.T) {
	root := filepath.Join(t.TempDir(), "projects")
	recent := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	project := filepath.Join(root, "-Users-sam-work-billing")

	answer := `{"type":"assistant","timestamp":"2026-11-14T09:10:00.000Z","sessionId":"sess-a","requestId":"req-1","cwd":"/Users/sam/work/billing","message":{"id":"msg-1","model":"claude-opus-4-5-20251101","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}`
	writeSessionLog(t, filepath.Join(project, "sess-a.jsonl"), recent,
		// A prompt has no usage and its text is never decoded.
		`{"type":"user","timestamp":"2026-11-14T09:09:00.000Z","sessionId":"sess-a","message":{"role":"user","content":"what does \"usage\" mean for an \"assistant\"?"}}`,
		answer,
		// Written twice by the tool: counted once.
		answer,
		// No input or output: nothing to price.
		`{"type":"assistant","timestamp":"2026-11-14T09:11:00.000Z","sessionId":"sess-a","requestId":"req-2","message":{"id":"msg-2","model":"claude-opus-4-5-20251101","usage":{"input_tokens":0,"output_tokens":0}}}`,
		`not json at all`,
	)
	// A resumed session copies the earlier response into its own file.
	writeSessionLog(t, filepath.Join(project, "sess-b.jsonl"), recent,
		answer,
		`{"type":"assistant","timestamp":"2026-11-14T08:00:00.000Z","requestId":"req-3","message":{"id":"msg-3","model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":20}}}`,
	)
	// Untouched since before the cutoff: never opened.
	writeSessionLog(t, filepath.Join(project, "old.jsonl"), recent.AddDate(0, 0, -40),
		`{"type":"assistant","timestamp":"2026-10-01T08:00:00.000Z","sessionId":"old","requestId":"req-9","message":{"id":"msg-9","model":"claude-opus-4-5-20251101","usage":{"input_tokens":10,"output_tokens":20}}}`,
	)

	// The same folder listed twice must not double the events.
	events := ScanClaudeEvents([]string{root, root, filepath.Join(root, "missing")}, recent.AddDate(0, 0, -7))
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2: %+v", len(events), events)
	}

	first, second := events[0], events[1]
	if first.SessionID != "sess-b" || first.Project != "billing" || first.Model != "claude-sonnet-4-5" {
		t.Errorf("oldest event = %+v; with no sessionId or cwd on the line, the file and folder name stand in", first)
	}
	if second.SessionID != "sess-a" || second.Project != "billing" {
		t.Errorf("second event = %+v", second)
	}
	if second.Input != 100 || second.Output != 50 || second.CacheRead != 1000 || second.CacheWrite != 200 {
		t.Errorf("tokens = %+v", second)
	}
	if want := EstimateCostForTool("claude", "claude-opus-4-5-20251101", 100, 50, 1000, 200); second.Cost != want || want <= 0 {
		t.Errorf("cost = %v, want the same estimate the daily scan makes (%v)", second.Cost, want)
	}
	if !second.Time.Equal(time.Date(2026, 11, 14, 9, 10, 0, 0, time.UTC)) {
		t.Errorf("time = %v", second.Time)
	}
}

// Claude Code can log one response over several lines. The early lines carry a
// partial output count and the same cache tokens as the final line, so counting
// each of them doubles the cache tokens.
func partialResponseLines() []string {
	line := func(clock string, output int, stop string) string {
		return `{"type":"assistant","timestamp":"2026-11-10T05:43:` + clock + `Z","sessionId":"sess-a","requestId":"req-7","cwd":"/Users/sam/work/billing","message":{"id":"msg-7","model":"claude-opus-4-5-20251101","stop_reason":` + stop + `,"usage":{"input_tokens":2,"output_tokens":` + strconv.Itoa(output) + `,"cache_read_input_tokens":5631,"cache_creation_input_tokens":10621}}}`
	}
	return []string{
		line("15.336", 5, "null"),
		line("15.642", 5, "null"),
		line("16.052", 230, `"tool_use"`),
		// A stale partial line arriving after the final one changes nothing.
		line("16.100", 5, "null"),
	}
}

func TestScanClaudeEventsKeepsTheMostCompleteLineOfAResponse(t *testing.T) {
	root := filepath.Join(t.TempDir(), "projects")
	recent := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	writeSessionLog(t, filepath.Join(root, "-Users-sam-work-billing", "sess-a.jsonl"), recent, partialResponseLines()...)

	events := ScanClaudeEvents([]string{root}, recent.AddDate(0, 0, -1))
	if len(events) != 1 {
		t.Fatalf("events = %d, want the response counted once: %+v", len(events), events)
	}
	if got := events[0]; got.Output != 230 || got.CacheRead != 5631 || got.CacheWrite != 10621 || got.Input != 2 {
		t.Errorf("event = %+v, want the final line's numbers", got)
	}
}

func TestDailyScanKeepsTheMostCompleteLineOfAResponse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects", "-Users-sam-work-billing", "sess-a.jsonl")
	writeSessionLog(t, path, time.Now(), partialResponseLines()...)

	buckets := map[string]*types.DailyUsage{}
	processFile(path, "claude", parseClaudeLine, buckets, map[string]*countedUsage{}, map[string]string{}, "")
	if len(buckets) != 1 {
		t.Fatalf("buckets = %d, want 1", len(buckets))
	}
	for _, day := range buckets {
		if day.OutputTokens != 230 || day.CacheReadTokens != 5631 || day.CacheWriteTokens != 10621 || day.InputTokens != 2 || day.Requests != 1 {
			t.Errorf("day = %+v, want one request with the final line's numbers", *day)
		}
	}
}
