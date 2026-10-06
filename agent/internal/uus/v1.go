// Package uus defines UseJunction Usage Schema v1 types and helpers.
package uus

import (
	"fmt"
	"math"
	"strings"

	"github.com/usejunction/agent/internal/types"
)

// SchemaVersion is the UUS v1 semver.
const SchemaVersion = "1.0.0"

// Repository is a remote git identity (no local paths).
type Repository struct {
	Host  string `json:"host"`
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

// Cost is a typed cost measure.
type Cost struct {
	AmountMicros int64   `json:"amountMicros,omitempty"`
	AmountUsd    float64 `json:"amountUsd,omitempty"`
	Kind         string  `json:"kind,omitempty"`
}

// Record is a UUS v1 aggregate-first daily usage row.
// CamelCase aliases are kept for wire compatibility with existing ingest.
type Record struct {
	SchemaVersion      string         `json:"schemaVersion"`
	Date               string         `json:"date"`
	GenAISystem        string         `json:"gen_ai.system,omitempty"`
	Tool               string         `json:"tool"`
	ToolName           string         `json:"toolName,omitempty"` // legacy
	AccountKey         string         `json:"accountKey,omitempty"`
	Model              string         `json:"model"`
	GenAIModel         string         `json:"gen_ai.request.model,omitempty"`
	Source             string         `json:"source"`
	Repository         *Repository    `json:"repository,omitempty"`
	InputTokens        int            `json:"inputTokens"`
	OutputTokens       int            `json:"outputTokens"`
	CacheRead          int            `json:"cacheReadTokens"`
	CacheWrite         int            `json:"cacheWriteTokens,omitempty"`
	Reasoning          int            `json:"reasoningTokens,omitempty"`
	Requests           int            `json:"requests,omitempty"`
	Cost               *Cost          `json:"cost,omitempty"`
	EstimatedCost      float64        `json:"estimatedCost,omitempty"`
	Verified           bool           `json:"verified,omitempty"`
	MetricKind         string         `json:"metricKind,omitempty"`
	CostKind           string         `json:"costKind,omitempty"`
	TokenSemantics     string         `json:"tokenSemantics,omitempty"`
	CalculationVersion string         `json:"calculationVersion,omitempty"`
	Extensions         map[string]any `json:"extensions,omitempty"`
	SuggestedLines     int            `json:"suggestedLines,omitempty"`
	AcceptedLines      int            `json:"acceptedLines,omitempty"`
	AddedLines         int            `json:"addedLines,omitempty"`
	DeletedLines       int            `json:"deletedLines,omitempty"`
	Commits            int            `json:"commits,omitempty"`
	AiPercent          *float64       `json:"aiPercent,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
}

// PartitionKey returns the UUS grain key for manifests / fingerprints.
func PartitionKey(date, tool, accountKey, model, source string, repo *Repository) string {
	repoKey := ""
	if repo != nil {
		repoKey = fmt.Sprintf("%s/%s/%s",
			strings.ToLower(strings.TrimSpace(repo.Host)),
			strings.TrimSpace(repo.Owner),
			strings.TrimSpace(repo.Name),
		)
	}
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s", date, tool, strings.TrimSpace(accountKey), model, source, repoKey)
}

// ContentFingerprint hashes absolute totals for delta detection.
// Must stay byte-compatible with packages/usage-schema uusContentFingerprint.
func ContentFingerprint(r Record) string {
	costMicros := int64(0)
	if r.Cost != nil && r.Cost.AmountMicros > 0 {
		costMicros = r.Cost.AmountMicros
	} else if r.EstimatedCost > 0 {
		costMicros = int64(math.Round(r.EstimatedCost * 1_000_000))
	}
	ai := ""
	if r.AiPercent != nil {
		ai = fmt.Sprintf("%v", *r.AiPercent)
	}
	verified := 0
	if r.Verified {
		verified = 1
	}
	return fmt.Sprintf(
		"in:%d,out:%d,cr:%d,cw:%d,r:%d,req:%d,cost:%d,sug:%d,acc:%d,add:%d,del:%d,com:%d,ai:%s,v:%d,mk:%s",
		r.InputTokens, r.OutputTokens, r.CacheRead, r.CacheWrite, r.Reasoning,
		r.Requests, costMicros, r.SuggestedLines, r.AcceptedLines, r.AddedLines,
		r.DeletedLines, r.Commits, ai, verified, r.MetricKind,
	)
}

// FromDailyUsage maps legacy types.DailyUsage into a UUS v1 record.
func FromDailyUsage(row types.DailyUsage) Record {
	tool := row.ToolName
	source := row.Source
	if source == "" {
		source = "local_scan"
	}
	var repo *Repository
	if row.Repository != nil {
		repo = &Repository{
			Host:  row.Repository.Host,
			Owner: row.Repository.Owner,
			Name:  row.Repository.Name,
		}
	}
	var cost *Cost
	if row.EstimatedCost > 0 || row.CostKind != "" {
		cost = &Cost{
			AmountUsd: row.EstimatedCost,
			// Keep byte-compatible with TypeScript's Math.round conversion in
			// packages/usage-schema. Truncating here made unchanged estimated-cost
			// partitions differ from the fingerprint persisted by the server.
			AmountMicros: int64(math.Round(row.EstimatedCost * 1_000_000)),
			Kind:         string(row.CostKind),
		}
	}
	ext := map[string]any{}
	if row.SuggestedLines > 0 {
		ext["code.suggested_lines"] = row.SuggestedLines
	}
	if row.AcceptedLines > 0 {
		ext["code.accepted_lines"] = row.AcceptedLines
	}
	if row.AddedLines > 0 {
		ext["code.added_lines"] = row.AddedLines
	}
	if row.DeletedLines > 0 {
		ext["code.deleted_lines"] = row.DeletedLines
	}
	if row.Commits > 0 {
		ext["vcs.commits"] = row.Commits
	}
	if row.AiPercent != nil {
		ext["ai_percent"] = *row.AiPercent
	}
	if len(ext) == 0 {
		ext = nil
	}
	return Record{
		SchemaVersion:      SchemaVersion,
		Date:               row.Date,
		Tool:               tool,
		ToolName:           tool,
		AccountKey:         row.AccountKey,
		Model:              row.Model,
		GenAIModel:         row.Model,
		Source:             source,
		Repository:         repo,
		InputTokens:        row.InputTokens,
		OutputTokens:       row.OutputTokens,
		CacheRead:          row.CacheReadTokens,
		CacheWrite:         row.CacheWriteTokens,
		Reasoning:          row.ReasoningTokens,
		Requests:           row.Requests,
		Cost:               cost,
		EstimatedCost:      row.EstimatedCost,
		Verified:           row.Verified,
		MetricKind:         string(row.MetricKind),
		CostKind:           string(row.CostKind),
		TokenSemantics:     string(row.TokenSemantics),
		CalculationVersion: row.CalculationVersion,
		Extensions:         ext,
		SuggestedLines:     row.SuggestedLines,
		AcceptedLines:      row.AcceptedLines,
		AddedLines:         row.AddedLines,
		DeletedLines:       row.DeletedLines,
		Commits:            row.Commits,
		AiPercent:          row.AiPercent,
		Metadata:           row.Metadata,
	}
}

// ManifestEntry is one partition in a sync-start lookback manifest.
type ManifestEntry struct {
	PartitionKey string      `json:"partitionKey"`
	Date         string      `json:"date"`
	Tool         string      `json:"tool"`
	Model        string      `json:"model"`
	Source       string      `json:"source"`
	Repository   *Repository `json:"repository,omitempty"`
	ContentHash  string      `json:"contentHash"`
	RowCount     int         `json:"rowCount"`
}

// BuildManifest collapses DailyUsage rows into unique partition entries.
func BuildManifest(rows []types.DailyUsage) []ManifestEntry {
	byKey := map[string]ManifestEntry{}
	order := make([]string, 0, len(rows))
	for _, row := range rows {
		rec := FromDailyUsage(row)
		source := rec.Source
		key := PartitionKey(rec.Date, rec.Tool, rec.AccountKey, rec.Model, source, rec.Repository)
		fp := ContentFingerprint(rec)
		if existing, ok := byKey[key]; ok {
			existing.ContentHash = fp
			existing.RowCount = 1
			byKey[key] = existing
			continue
		}
		byKey[key] = ManifestEntry{
			PartitionKey: key,
			Date:         rec.Date,
			Tool:         rec.Tool,
			Model:        rec.Model,
			Source:       source,
			Repository:   rec.Repository,
			ContentHash:  fp,
			RowCount:     1,
		}
		order = append(order, key)
	}
	out := make([]ManifestEntry, 0, len(order))
	for _, key := range order {
		out = append(out, byKey[key])
	}
	return out
}
