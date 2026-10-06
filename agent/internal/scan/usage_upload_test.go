package scan

import (
	"fmt"
	"testing"
	"time"

	"github.com/usejunction/agent/internal/types"
)

func TestFilterUsageLookback(t *testing.T) {
	now := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	rows := []types.DailyUsage{
		{Date: "2026-07-21", ToolName: "cursor"},
		{Date: "2026-05-22", ToolName: "codex"},  // exactly 60 days back inclusive
		{Date: "2026-05-21", ToolName: "claude"}, // outside
	}
	got := FilterUsageLookback(rows, now)
	if len(got) != 2 {
		t.Fatalf("got %#v", got)
	}
	for _, row := range got {
		if row.ToolName == "claude" {
			t.Fatalf("lookback leaked old row: %#v", row)
		}
	}
}

func TestTakeUsageUploadBatch(t *testing.T) {
	pending := make([]types.DailyUsage, 0, 6000)
	for i := 0; i < 6000; i++ {
		pending = append(pending, types.DailyUsage{Date: "2026-07-21", ToolName: "codex", Model: string(rune('a'+(i%26))) + fmt.Sprintf("%d", i)})
	}
	batch, remaining := TakeUsageUploadBatch(pending, 50, 2)
	if len(batch) != 100 {
		t.Fatalf("batch=%d", len(batch))
	}
	if len(remaining) != 5900 {
		t.Fatalf("remaining=%d", len(remaining))
	}
	budget, rest := TakeUsageUploadBatch(pending, UsageUploadBatchSize, UsageUploadMaxBatchesPerSync)
	wantBudget := UsageUploadBatchSize * UsageUploadMaxBatchesPerSync
	if len(budget) != wantBudget {
		t.Fatalf("default budget=%d want %d", len(budget), wantBudget)
	}
	if len(rest) != 6000-wantBudget {
		t.Fatalf("default remaining=%d", len(rest))
	}
	all, none := TakeUsageUploadBatch(pending[:40], 50, 2)
	if len(all) != 40 || none != nil {
		t.Fatalf("all=%d remaining=%#v", len(all), none)
	}
	first, firstRest := TakeUsageUploadBatch(pending, UsageUploadBatchSize, UsageUploadMaxBatchesPerSyncFirst)
	wantFirst := UsageUploadBatchSize * UsageUploadMaxBatchesPerSyncFirst
	if len(first) != wantFirst {
		t.Fatalf("first-sync budget=%d want %d", len(first), wantFirst)
	}
	if len(firstRest) != 6000-wantFirst {
		t.Fatalf("first-sync remaining=%d", len(firstRest))
	}
}

func TestSplitUsageUploadBatches(t *testing.T) {
	rows := make([]types.DailyUsage, 0, 120)
	for i := 0; i < 120; i++ {
		rows = append(rows, types.DailyUsage{Date: "2026-07-21", Model: fmt.Sprintf("m%d", i)})
	}
	batches := SplitUsageUploadBatches(rows, 50)
	if len(batches) != 3 {
		t.Fatalf("batches=%d", len(batches))
	}
	if len(batches[0]) != 50 || len(batches[1]) != 50 || len(batches[2]) != 20 {
		t.Fatalf("sizes=%d,%d,%d", len(batches[0]), len(batches[1]), len(batches[2]))
	}
	if SplitUsageUploadBatches(nil, 50) != nil {
		t.Fatal("nil input should yield nil")
	}
}

func TestSortUsageNewestFirst(t *testing.T) {
	rows := []types.DailyUsage{
		{Date: "2026-07-10", ToolName: "claude"},
		{Date: "2026-07-17", ToolName: "cursor"},
		{Date: "2026-07-10", ToolName: "codex"},
	}
	SortUsageNewestFirst(rows)
	if rows[0].Date != "2026-07-17" || rows[1].ToolName != "claude" || rows[2].ToolName != "codex" {
		t.Fatalf("got %#v", rows)
	}
}
