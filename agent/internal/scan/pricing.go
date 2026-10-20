package scan

import "strings"

// ModelRate is USD per million tokens for a model family.
type ModelRate struct {
	InputPer1M      float64
	OutputPer1M     float64
	CacheReadPer1M  float64
	CacheWritePer1M float64
}

const PricingVersion = "2026-10-20"

var defaultRates = ModelRate{InputPer1M: 2.5, OutputPer1M: 10.0, CacheReadPer1M: 0.25, CacheWritePer1M: 3.125}

// Known published rates (USD / 1M tokens). Matching is first-substring-wins, so
// more specific names must precede the broader prefixes they contain.
// Keep identical (content and order) to apps/admin/lib/metrics/estimate-cost.ts.
var modelRates = []struct {
	match string
	rate  ModelRate
}{
	{"composer-2.5-fast", ModelRate{3, 15, 0.2, 0}},
	{"composer-2-fast", ModelRate{3, 15, 0.2, 0}},
	{"composer-2.5", ModelRate{0.5, 2.5, 0.2, 0}},
	{"composer-1", ModelRate{1.25, 10, 0.125, 0}},
	{"composer", ModelRate{0.5, 2.5, 0.2, 0}},
	{"grok-4.5-high-fast", ModelRate{4, 18, 0.5, 0}},
	{"grok-4.5-fast", ModelRate{4, 18, 0.5, 0}},
	{"grok-4.5", ModelRate{2, 6, 0.5, 0}},
	{"claude-opus-5-5", ModelRate{4, 20, 0.2, 5}},
	{"claude-opus-5.5", ModelRate{4, 20, 0.2, 5}},
	{"claude-opus-5", ModelRate{5, 25, 0.5, 6.25}},
	{"claude-opus-4.6", ModelRate{5, 25, 0.5, 6.25}},
	{"claude-opus-4", ModelRate{5, 25, 0.5, 6.25}},
	{"claude-sonnet-5-5", ModelRate{2, 10, 0.2, 2.5}},
	{"claude-sonnet-5.5", ModelRate{2, 10, 0.2, 2.5}},
	{"claude-sonnet-5", ModelRate{2, 10, 0.2, 2.5}},
	{"claude-sonnet-4.6", ModelRate{3, 15, 0.3, 3.75}},
	{"claude-sonnet-4", ModelRate{3, 15, 0.3, 3.75}},
	{"claude-haiku-5-5", ModelRate{0.1, 0.5, 0.01, 0.125}},
	{"claude-haiku-5.5", ModelRate{0.1, 0.5, 0.01, 0.125}},
	{"claude-haiku-4", ModelRate{1, 5, 0.1, 1.25}},
	{"claude-fable", ModelRate{10, 50, 0.25, 12.5}},
	{"claude", ModelRate{3, 15, 0.3, 3.75}},
	{"gpt-6.1-sol", ModelRate{2, 10, 0.1, 0}},
	{"gpt-6-astra", ModelRate{10, 50, 1, 0}},
	{"gpt-6-sol", ModelRate{2, 10, 0.2, 0}},
	{"gpt-6-luna", ModelRate{0.1, 0.5, 0.01, 0}},
	{"gpt-5.6-sol", ModelRate{5, 30, 0.5, 6.25}},
	{"gpt-5.6-terra", ModelRate{2.5, 15, 0.25, 3.125}},
	{"gpt-5.6-luna", ModelRate{1, 6, 0.1, 1.25}},
	{"gpt-5.5", ModelRate{5, 30, 0.5, 0}},
	{"gpt-5.4", ModelRate{2.5, 15, 0.25, 0}},
	{"gpt-5.3", ModelRate{1.75, 14, 0.175, 0}},
	{"gpt-5.2", ModelRate{1.75, 14, 0.175, 0}},
	{"gpt-5.1", ModelRate{1.25, 10, 0.125, 0}},
	{"gpt-5", ModelRate{1.25, 10, 0.125, 0}},
	{"o3", ModelRate{2, 8, 0.5, 0}},
	{"o4", ModelRate{2, 8, 0.5, 0}},
	{"gemini-3.6-flash", ModelRate{1.5, 9, 0.15, 0}},
	{"gemini-3.5-flash", ModelRate{1.5, 9, 0.15, 0}},
	{"gemini-3.1-pro", ModelRate{2, 12, 0.2, 0}},
	{"gemini-3-pro", ModelRate{2, 12, 0.2, 0}},
	{"gemini-3-flash", ModelRate{0.5, 3, 0.05, 0}},
	{"gemini-2.5-flash", ModelRate{0.3, 2.5, 0.03, 0}},
	{"glm-5.2", ModelRate{1.4, 4.4, 0.26, 0}},
	{"kimi", ModelRate{0.95, 4, 0.19, 0}},
	{"auto", ModelRate{1.25, 6, 0.25, 1.25}},
}

func rateForModel(model string) ModelRate {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" || m == "default" || m == "plan" {
		return defaultRates
	}
	for _, entry := range modelRates {
		if strings.Contains(m, entry.match) {
			return entry.rate
		}
	}
	return defaultRates
}

// BillableInputTokens returns uncached input for OpenAI-style semantics.
func BillableInputTokens(tool string, input, cacheRead int) int {
	if tool == "claude" || strings.Contains(strings.ToLower(tool), "claude") {
		return input
	}
	uncached := input - cacheRead
	if uncached < 0 {
		return 0
	}
	return uncached
}

// EstimateCostForTool computes USD using provider-aware token semantics.
func EstimateCostForTool(tool, model string, input, output, cacheRead, cacheWrite int) float64 {
	r := rateForModel(model)
	billableInput := BillableInputTokens(tool, input, cacheRead)
	cost := (float64(billableInput)/1e6)*r.InputPer1M +
		(float64(output)/1e6)*r.OutputPer1M +
		(float64(cacheRead)/1e6)*r.CacheReadPer1M
	if r.CacheWritePer1M > 0 && cacheWrite > 0 {
		cost += (float64(cacheWrite) / 1e6) * r.CacheWritePer1M
	}
	return cost
}

// EstimateCost computes USD cost from token buckets using codex/openai semantics.
func EstimateCost(model string, input, output, cacheRead, cacheWrite int) float64 {
	return EstimateCostForTool("codex", model, input, output, cacheRead, cacheWrite)
}
