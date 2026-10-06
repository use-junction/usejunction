package scan

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/types"
)

func writeAntigravityConversationFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	conv := filepath.Join(root, "conversations")
	if err := os.MkdirAll(conv, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(conv, "session-1.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		CREATE TABLE trajectory_meta (
			cascade_id TEXT PRIMARY KEY,
			model TEXT,
			created_at INTEGER,
			source INTEGER
		);
		CREATE TABLE steps (
			id INTEGER PRIMARY KEY,
			cascade_id TEXT,
			step_type TEXT,
			status TEXT,
			created_at INTEGER,
			step_payload BLOB
		);
	`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(
		`INSERT INTO trajectory_meta (cascade_id, model, created_at, source) VALUES (?, ?, ?, ?)`,
		"cascade-1", "gemini-3.5-flash", int64(1753200000), 1,
	)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"usageMetadata":{"promptTokenCount":120,"candidatesTokenCount":40,"totalTokenCount":160}}`)
	_, err = db.Exec(
		`INSERT INTO steps (cascade_id, step_type, status, created_at, step_payload) VALUES (?, ?, ?, ?, ?)`,
		"cascade-1", "generate", "ok", int64(1753200000), payload,
	)
	if err != nil {
		t.Fatal(err)
	}
	payload2 := []byte(`prompt_token_count=80 completion_token_count=20`)
	_, err = db.Exec(
		`INSERT INTO steps (cascade_id, step_type, status, created_at, step_payload) VALUES (?, ?, ?, ?, ?)`,
		"cascade-1", "generate", "ok", int64(1753200100), payload2,
	)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func writeAntigravityGenMetadataFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	conv := filepath.Join(root, "conversations")
	if err := os.MkdirAll(conv, 0o755); err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(conv, "cli-session.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`
		CREATE TABLE gen_metadata (idx integer, data blob, size integer);
		CREATE TABLE trajectory_metadata_blob (id text, data blob);
	`)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Unix()
	blob := BuildAntigravityGenMetadataBlob("gemini-3.6-flash", "resp-1", 1132, 200, 50, 40, 10, now)
	dup := BuildAntigravityGenMetadataBlob("gemini-3.6-flash", "resp-1", 1132, 999, 0, 1, 0, now)
	second := BuildAntigravityGenMetadataBlob("gemini-3.6-flash", "resp-2", 1132, 100, 0, 20, 5, now+3600)
	_, err = db.Exec(`INSERT INTO gen_metadata (idx, data, size) VALUES (0, ?, 0), (1, ?, 0), (2, ?, 0)`, blob, dup, second)
	if err != nil {
		t.Fatal(err)
	}
	meta := BuildAntigravityTrajectoryMetaBlob(now, "file:///tmp/ws")
	_, err = db.Exec(`INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)`, meta)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestScanAntigravityConversationDB(t *testing.T) {
	root := writeAntigravityConversationFixture(t)
	prev := antigravityRootsOverride
	antigravityRootsOverride = []string{root}
	defer func() { antigravityRootsOverride = prev }()

	buckets := map[string]*types.DailyUsage{}
	dbs := antigravityConversationDBs()
	if len(dbs) != 1 {
		t.Fatalf("dbs = %#v", dbs)
	}
	if err := scanAntigravityConversationDB(dbs[0], buckets); err != nil {
		t.Fatal(err)
	}
	var found *types.DailyUsage
	for _, b := range buckets {
		found = b
		break
	}
	if found == nil {
		t.Fatal("expected usage bucket")
	}
	if found.ToolName != "antigravity" || found.Source != antigravityUsageSource {
		t.Fatalf("bucket = %#v", found)
	}
	if found.Model != "gemini-3.5-flash" {
		t.Fatalf("model = %q", found.Model)
	}
	if found.InputTokens != 200 || found.OutputTokens != 60 {
		t.Fatalf("tokens in=%d out=%d", found.InputTokens, found.OutputTokens)
	}
	if found.Requests != 2 {
		t.Fatalf("requests = %d", found.Requests)
	}
}

func TestScanAntigravityGenMetadataDB(t *testing.T) {
	root := writeAntigravityGenMetadataFixture(t)
	prev := antigravityRootsOverride
	antigravityRootsOverride = []string{root}
	defer func() { antigravityRootsOverride = prev }()

	rows, err := ScanAntigravityLocal(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %#v", rows)
	}
	row := rows[0]
	if row.Source != antigravityUsageSource {
		t.Fatalf("source = %q", row.Source)
	}
	if row.Model != "gemini-3.6-flash" {
		t.Fatalf("model = %q", row.Model)
	}
	// resp-1: 1132+200 in, 40 out, 50 cache, 10 reasoning; resp-2: 1132+100 in, 20 out, 5 reasoning
	if row.InputTokens != 2564 || row.OutputTokens != 60 || row.CacheReadTokens != 50 || row.ReasoningTokens != 15 {
		t.Fatalf("tokens = in=%d out=%d cache=%d reason=%d", row.InputTokens, row.OutputTokens, row.CacheReadTokens, row.ReasoningTokens)
	}
	if row.Requests != 2 {
		t.Fatalf("requests = %d (dedupe failed?)", row.Requests)
	}
	if row.EstimatedCost <= 0 || row.CostKind != types.CostKindEstimatedAPI {
		t.Fatalf("expected estimated cost, got cost=%v kind=%q", row.EstimatedCost, row.CostKind)
	}
}

func TestParseAntigravityUsagePayloadJSON(t *testing.T) {
	in, out, ok := parseAntigravityUsagePayload([]byte(`{"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}`))
	if !ok || in != 10 || out != 5 {
		t.Fatalf("got %d/%d ok=%v", in, out, ok)
	}
}

func TestMergeAntigravityUsagePrefersTokens(t *testing.T) {
	local := []types.DailyUsage{{
		Date: "2026-07-22", ToolName: "antigravity", Model: "gemini-3.6-flash",
		Requests: 5, Source: antigravityLocalSource,
	}}
	usage := []types.DailyUsage{{
		Date: "2026-07-22", ToolName: "antigravity", Model: "gemini-3.6-flash",
		Requests: 2, InputTokens: 1000, OutputTokens: 200, Source: antigravityUsageSource,
	}}
	merged := MergeAntigravityUsage(local, usage)
	if len(merged) != 1 {
		t.Fatalf("merged = %#v", merged)
	}
	if merged[0].Source != antigravityUsageSource {
		t.Fatalf("source = %q", merged[0].Source)
	}
	if merged[0].InputTokens != 1000 || merged[0].Requests != 2 {
		t.Fatalf("row = %#v", merged[0])
	}
	if merged[0].EstimatedCost <= 0 {
		t.Fatalf("expected cost > 0, got %v", merged[0].EstimatedCost)
	}
}

func TestScanAntigravityBrainTranscript(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "brain", "cascade-1", ".system_generated", "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcript := strings.Join([]string{
		`{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"2026-09-01T18:39:16Z","content":"<USER_SETTINGS_CHANGE>\nThe user changed setting ` + "`Model Selection`" + ` from None to Gemini 3.6 Flash (High).\n</USER_SETTINGS_CHANGE>"}`,
		`{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-09-01T18:39:16Z","tool_calls":[{"name":"list_dir"}]}`,
		`{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-09-01T18:40:00Z"}`,
	}, "\n") + "\n"
	path := filepath.Join(dir, "transcript.jsonl")
	if err := os.WriteFile(path, []byte(transcript), 0o644); err != nil {
		t.Fatal(err)
	}

	prev := antigravityRootsOverride
	antigravityRootsOverride = []string{root}
	defer func() { antigravityRootsOverride = prev }()

	rows, err := ScanAntigravityLocal(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %#v", rows)
	}
	if rows[0].Model != "gemini-3.6-flash" {
		t.Fatalf("model = %q", rows[0].Model)
	}
	if rows[0].Requests != 2 {
		t.Fatalf("requests = %d", rows[0].Requests)
	}
	if rows[0].Date != "2026-09-01" {
		t.Fatalf("date = %q", rows[0].Date)
	}
	if rows[0].Source != antigravityLocalSource {
		t.Fatalf("source = %q", rows[0].Source)
	}
	if rows[0].InputTokens != 0 {
		t.Fatalf("transcript must not invent tokens, got %d", rows[0].InputTokens)
	}
}

func TestScanAntigravityLocalEmptyRoots(t *testing.T) {
	prev := antigravityRootsOverride
	antigravityRootsOverride = []string{filepath.Join(t.TempDir(), "missing")}
	defer func() { antigravityRootsOverride = prev }()

	rows, err := ScanAntigravityLocal(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected empty, got %#v", rows)
	}
}
