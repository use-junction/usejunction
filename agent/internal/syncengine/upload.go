// Package syncengine uploads local usage via server-tracked sync sessions.
package syncengine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/usejunction/agent/internal/client"
	"github.com/usejunction/agent/internal/scan"
	"github.com/usejunction/agent/internal/types"
	"github.com/usejunction/agent/internal/uus"
)

const (
	ChunkSize   = scan.UsageUploadBatchSize
	MaxChunks   = scan.UsageUploadMaxBatchesPerSync
	Concurrency = scan.UsageUploadConcurrency
)

// InventorySidecars are optional fingerprint-gated payloads applied on sync start.
type InventorySidecars struct {
	Tools    []client.ToolReport
	Accounts []client.AccountReport
	Quotas   []client.QuotaReport
}

// UploadOptions tunes one sync-engine pass.
type UploadOptions struct {
	// MaxChunks overrides MaxChunks (batches per pass). Zero uses the default.
	MaxChunks int
	// Progress reports cumulative uploaded rows vs the drain budget for this pass.
	Progress func(done, total int)
}

// UploadUsageSession builds a lookback manifest, asks the server for the delta,
// uploads only requested partitions, then commits. Resumable via a later start.
// inventory sidecars (tools/accounts/quotas) are applied on start when provided.
func UploadUsageSession(ctx context.Context, api *client.APIClient, rows []types.DailyUsage, inventory *InventorySidecars, opts ...UploadOptions) (uploaded int, remaining int, warnings []string, err error) {
	var opt UploadOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	maxChunks := opt.MaxChunks
	if maxChunks <= 0 {
		maxChunks = MaxChunks
	}

	now := time.Now().UTC()
	rows = scan.FilterUsageLookback(rows, now)
	hasInventory := inventory != nil && (inventory.Tools != nil || inventory.Accounts != nil || inventory.Quotas != nil)
	if len(rows) == 0 && !hasInventory {
		return 0, 0, nil, nil
	}

	manifest := uus.BuildManifest(rows)
	parts := make([]client.SyncManifestPartition, 0, len(manifest))
	for _, m := range manifest {
		var repo *client.RepositoryReport
		if m.Repository != nil {
			repo = &client.RepositoryReport{Host: m.Repository.Host, Owner: m.Repository.Owner, Name: m.Repository.Name}
		}
		parts = append(parts, client.SyncManifestPartition{
			PartitionKey: m.PartitionKey,
			Date:         m.Date,
			Tool:         m.Tool,
			Model:        m.Model,
			Source:       m.Source,
			Repository:   repo,
			ContentHash:  m.ContentHash,
			RowCount:     m.RowCount,
		})
	}

	startOpts := &client.StartUsageSyncOptions{}
	if inventory != nil {
		if inventory.Tools != nil {
			startOpts.Tools = &client.ToolsSyncSidecar{
				ContentHash: ToolsContentHash(inventory.Tools),
				Items:       inventory.Tools,
			}
		}
		if inventory.Accounts != nil {
			startOpts.Accounts = &client.AccountsSyncSidecar{
				ContentHash: AccountsContentHash(inventory.Accounts),
				Items:       inventory.Accounts,
			}
		}
		if inventory.Quotas != nil {
			startOpts.Quotas = &client.QuotasSyncSidecar{
				ContentHash: QuotasContentHash(inventory.Quotas),
				Items:       inventory.Quotas,
			}
		}
	}

	start, err := api.StartUsageSync(ctx, parts, startOpts)
	if err != nil {
		return 0, len(rows), nil, err
	}
	if start.ToolsApplied == "failed" && start.ToolsWarning != "" {
		warnings = append(warnings, "tools: "+start.ToolsWarning)
	}
	if start.AccountsApplied == "failed" && start.AccountsWarning != "" {
		warnings = append(warnings, "accounts: "+start.AccountsWarning)
	}
	if start.QuotasApplied == "failed" && start.QuotasWarning != "" {
		warnings = append(warnings, "quotas: "+start.QuotasWarning)
	}
	if start.Status == "committed" || len(start.DeltaPartitions) == 0 {
		return 0, 0, warnings, nil
	}

	deltaSet := map[string]struct{}{}
	for _, key := range start.DeltaPartitions {
		deltaSet[key] = struct{}{}
	}

	pending := make([]types.DailyUsage, 0, len(rows))
	for _, row := range rows {
		rec := uus.FromDailyUsage(row)
		key := uus.PartitionKey(rec.Date, rec.Tool, rec.AccountKey, rec.Model, rec.Source, rec.Repository)
		if _, ok := deltaSet[key]; ok {
			pending = append(pending, row)
		}
	}
	if len(pending) == 0 {
		_, err = api.CommitUsageSync(ctx, start.SyncRunID, 0, 0)
		return 0, 0, warnings, err
	}

	scan.SortUsageNewestFirst(pending)
	batch, rest := scan.TakeUsageUploadBatch(pending, ChunkSize, maxChunks)
	chunks := scan.SplitUsageUploadBatches(batch, ChunkSize)
	remaining = len(rest)
	drainTotal := len(batch)
	if opt.Progress != nil {
		opt.Progress(0, drainTotal)
	}

	type chunkResult struct {
		upserted int
		err      error
	}
	results := make([]chunkResult, len(chunks))
	sem := make(chan struct{}, Concurrency)
	var wg sync.WaitGroup
	var doneRows atomic.Int64
	for i, chunk := range chunks {
		wg.Add(1)
		go func(idx int, rows []types.DailyUsage) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			aggs := make([]client.UsageAggregate, 0, len(rows))
			for _, row := range rows {
				aggs = append(aggs, usageToAggregate(row))
			}
			chunkID := randomChunkID()
			upserted, err := api.UploadUsageSyncChunk(ctx, start.SyncRunID, chunkID, aggs)
			results[idx] = chunkResult{upserted: upserted, err: err}
			if err == nil {
				n := doneRows.Add(int64(len(rows)))
				if opt.Progress != nil {
					opt.Progress(int(n), drainTotal)
				}
			}
		}(i, chunk)
	}
	wg.Wait()

	uploaded = 0
	for _, r := range results {
		if r.err != nil {
			warnings = append(warnings, r.err.Error())
			continue
		}
		uploaded += r.upserted
	}

	commit, commitErr := api.CommitUsageSync(ctx, start.SyncRunID, len(chunks), remaining)
	if commitErr != nil {
		return uploaded, remaining + len(pending) - uploaded, warnings, commitErr
	}
	if commit.Status != "committed" {
		warnings = append(warnings, fmt.Sprintf("sync incomplete: %d partitions missing", len(commit.MissingPartitions)))
		remaining += len(commit.MissingPartitions)
	}
	return uploaded, remaining, warnings, nil
}

func usageToAggregate(row types.DailyUsage) client.UsageAggregate {
	var repo *client.RepositoryReport
	if row.Repository != nil {
		repo = &client.RepositoryReport{
			Host:  row.Repository.Host,
			Owner: row.Repository.Owner,
			Name:  row.Repository.Name,
		}
	}
	return client.UsageAggregate{
		Date:               row.Date,
		ToolName:           row.ToolName,
		AccountKey:         row.AccountKey,
		Model:              row.Model,
		InputTokens:        row.InputTokens,
		OutputTokens:       row.OutputTokens,
		CacheReadTokens:    row.CacheReadTokens,
		CacheWriteTokens:   row.CacheWriteTokens,
		ReasoningTokens:    row.ReasoningTokens,
		EstimatedCost:      row.EstimatedCost,
		SuggestedLines:     row.SuggestedLines,
		AcceptedLines:      row.AcceptedLines,
		AddedLines:         row.AddedLines,
		DeletedLines:       row.DeletedLines,
		Commits:            row.Commits,
		AiPercent:          row.AiPercent,
		Requests:           row.Requests,
		Source:             row.Source,
		Verified:           row.Verified,
		MetricKind:         string(row.MetricKind),
		CostKind:           string(row.CostKind),
		TokenSemantics:     string(row.TokenSemantics),
		CalculationVersion: row.CalculationVersion,
		Repository:         repo,
		Metadata:           row.Metadata,
	}
}

func randomChunkID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
