type ModelRate = {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
};

const defaultRates: ModelRate = { inputPer1M: 2.5, outputPer1M: 10, cacheReadPer1M: 0.25, cacheWritePer1M: 3.125 };

// Known published rates (USD / 1M tokens). Matching is first-substring-wins, so
// more specific names must precede the broader prefixes they contain.
// Keep identical (content and order) to agent/internal/scan/pricing.go.
const modelRates: Array<{ match: string; rate: ModelRate }> = [
  { match: "composer-2.5-fast", rate: { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "composer-2-fast", rate: { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "composer-2.5", rate: { inputPer1M: 0.5, outputPer1M: 2.5, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "composer-1", rate: { inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125, cacheWritePer1M: 0 } },
  { match: "composer", rate: { inputPer1M: 0.5, outputPer1M: 2.5, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "grok-4.5-high-fast", rate: { inputPer1M: 4, outputPer1M: 18, cacheReadPer1M: 0.5, cacheWritePer1M: 0 } },
  { match: "grok-4.5-fast", rate: { inputPer1M: 4, outputPer1M: 18, cacheReadPer1M: 0.5, cacheWritePer1M: 0 } },
  { match: "grok-4.5", rate: { inputPer1M: 2, outputPer1M: 6, cacheReadPer1M: 0.5, cacheWritePer1M: 0 } },
  { match: "claude-opus-5-5", rate: { inputPer1M: 4, outputPer1M: 20, cacheReadPer1M: 0.2, cacheWritePer1M: 5 } },
  { match: "claude-opus-5.5", rate: { inputPer1M: 4, outputPer1M: 20, cacheReadPer1M: 0.2, cacheWritePer1M: 5 } },
  { match: "claude-opus-5", rate: { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 } },
  { match: "claude-opus-4.6", rate: { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 } },
  { match: "claude-opus-4", rate: { inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 } },
  { match: "claude-sonnet-5-5", rate: { inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 2.5 } },
  { match: "claude-sonnet-5.5", rate: { inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 2.5 } },
  { match: "claude-sonnet-5", rate: { inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 2.5 } },
  { match: "claude-sonnet-4.6", rate: { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 } },
  { match: "claude-sonnet-4", rate: { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 } },
  { match: "claude-haiku-5-5", rate: { inputPer1M: 0.1, outputPer1M: 0.5, cacheReadPer1M: 0.01, cacheWritePer1M: 0.125 } },
  { match: "claude-haiku-5.5", rate: { inputPer1M: 0.1, outputPer1M: 0.5, cacheReadPer1M: 0.01, cacheWritePer1M: 0.125 } },
  { match: "claude-haiku-4", rate: { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 } },
  { match: "claude-fable", rate: { inputPer1M: 10, outputPer1M: 50, cacheReadPer1M: 0.25, cacheWritePer1M: 12.5 } },
  { match: "claude", rate: { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 } },
  { match: "gpt-6.1-sol", rate: { inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.1, cacheWritePer1M: 0 } },
  { match: "gpt-6-astra", rate: { inputPer1M: 10, outputPer1M: 50, cacheReadPer1M: 1, cacheWritePer1M: 0 } },
  { match: "gpt-6-sol", rate: { inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "gpt-6-luna", rate: { inputPer1M: 0.1, outputPer1M: 0.5, cacheReadPer1M: 0.01, cacheWritePer1M: 0 } },
  { match: "gpt-5.6-sol", rate: { inputPer1M: 5, outputPer1M: 30, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 } },
  { match: "gpt-5.6-terra", rate: { inputPer1M: 2.5, outputPer1M: 15, cacheReadPer1M: 0.25, cacheWritePer1M: 3.125 } },
  { match: "gpt-5.6-luna", rate: { inputPer1M: 1, outputPer1M: 6, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 } },
  { match: "gpt-5.5", rate: { inputPer1M: 5, outputPer1M: 30, cacheReadPer1M: 0.5, cacheWritePer1M: 0 } },
  { match: "gpt-5.4", rate: { inputPer1M: 2.5, outputPer1M: 15, cacheReadPer1M: 0.25, cacheWritePer1M: 0 } },
  { match: "gpt-5.3", rate: { inputPer1M: 1.75, outputPer1M: 14, cacheReadPer1M: 0.175, cacheWritePer1M: 0 } },
  { match: "gpt-5.2", rate: { inputPer1M: 1.75, outputPer1M: 14, cacheReadPer1M: 0.175, cacheWritePer1M: 0 } },
  { match: "gpt-5.1", rate: { inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125, cacheWritePer1M: 0 } },
  { match: "gpt-5", rate: { inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125, cacheWritePer1M: 0 } },
  { match: "o3", rate: { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5, cacheWritePer1M: 0 } },
  { match: "o4", rate: { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5, cacheWritePer1M: 0 } },
  { match: "gemini-3.6-flash", rate: { inputPer1M: 1.5, outputPer1M: 9, cacheReadPer1M: 0.15, cacheWritePer1M: 0 } },
  { match: "gemini-3.5-flash", rate: { inputPer1M: 1.5, outputPer1M: 9, cacheReadPer1M: 0.15, cacheWritePer1M: 0 } },
  { match: "gemini-3.1-pro", rate: { inputPer1M: 2, outputPer1M: 12, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "gemini-3-pro", rate: { inputPer1M: 2, outputPer1M: 12, cacheReadPer1M: 0.2, cacheWritePer1M: 0 } },
  { match: "gemini-3-flash", rate: { inputPer1M: 0.5, outputPer1M: 3, cacheReadPer1M: 0.05, cacheWritePer1M: 0 } },
  { match: "gemini-2.5-flash", rate: { inputPer1M: 0.3, outputPer1M: 2.5, cacheReadPer1M: 0.03, cacheWritePer1M: 0 } },
  { match: "glm-5.2", rate: { inputPer1M: 1.4, outputPer1M: 4.4, cacheReadPer1M: 0.26, cacheWritePer1M: 0 } },
  { match: "kimi", rate: { inputPer1M: 0.95, outputPer1M: 4, cacheReadPer1M: 0.19, cacheWritePer1M: 0 } },
  { match: "auto", rate: { inputPer1M: 1.25, outputPer1M: 6, cacheReadPer1M: 0.25, cacheWritePer1M: 1.25 } },
];

export function rateForModel(model: string): ModelRate {
  const normalized = model.trim().toLowerCase();
  if (!normalized || normalized === "default" || normalized === "plan") return defaultRates;
  for (const entry of modelRates) {
    if (normalized.includes(entry.match)) return entry.rate;
  }
  return defaultRates;
}

export const PRICING_VERSION = "2026-10-20";

function billableInput(tool: string, input: number, cacheRead: number): number {
  if (tool === "claude" || tool.includes("claude") || tool === "anthropic") return input;
  const uncached = input - cacheRead;
  return uncached > 0 ? uncached : 0;
}

export function estimateCost(
  model: string,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
  tool = "codex",
) {
  const rate = rateForModel(model);
  const billable = billableInput(tool, input, cacheRead);
  let cost =
    (billable / 1_000_000) * rate.inputPer1M +
    (output / 1_000_000) * rate.outputPer1M +
    (cacheRead / 1_000_000) * rate.cacheReadPer1M;
  if (rate.cacheWritePer1M > 0 && cacheWrite > 0) {
    cost += (cacheWrite / 1_000_000) * rate.cacheWritePer1M;
  }
  return cost;
}

export function estimateCostFromRows(
  rows: Array<{
    model: string | null;
    input: number | bigint;
    output: number | bigint;
    cacheRead?: number | bigint;
    cacheWrite?: number | bigint;
    tool?: string;
  }>,
) {
  return rows.reduce(
    (sum, row) =>
      sum +
      estimateCost(
        row.model ?? "",
        Number(row.input),
        Number(row.output),
        Number(row.cacheRead ?? 0),
        Number(row.cacheWrite ?? 0),
        row.tool ?? "codex",
      ),
    0,
  );
}
