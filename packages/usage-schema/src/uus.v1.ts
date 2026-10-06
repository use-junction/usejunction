/** UseJunction Usage Schema v1 — aggregate-first daily usage record. */

export const UUS_SCHEMA_VERSION = "1.0.0" as const;

export type UusCostKind = "verified_usage" | "estimated_api" | "actual_spend";
export type UusMetricKind = "usage" | "productivity";
export type UusTokenSemantics =
  | "openai_subset_cache"
  | "anthropic_additive_cache"
  | "vendor_reported";

export type UusRepository = {
  host: string;
  owner: string;
  name: string;
};

export type UusCost = {
  amountMicros?: number;
  amountUsd?: number;
  kind?: UusCostKind;
};

/** Namespaced long-tail attributes. Additive without schema migration. */
export type UusExtensions = {
  "code.suggested_lines"?: number;
  "code.accepted_lines"?: number;
  "code.added_lines"?: number;
  "code.deleted_lines"?: number;
  "vcs.commits"?: number;
  ai_percent?: number | null;
  [key: string]: unknown;
};

/**
 * Canonical UUS v1 record. Wire payloads may use camelCase aliases
 * (`toolName`, `inputTokens`, …); normalize before classification.
 */
export type UusV1Record = {
  schemaVersion: typeof UUS_SCHEMA_VERSION;
  date: string;
  /** OTel GenAI: provider / system. Optional on wire; server classifies. */
  "gen_ai.system"?: string;
  tool: string;
  "gen_ai.request.model"?: string;
  model?: string;
  source: string;
  repository?: UusRepository | null;
  accountKey?: string;
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;
  "gen_ai.usage.cache_read_tokens"?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  /** Legacy camelCase aliases accepted on wire. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  requests?: number;
  cost?: UusCost;
  estimatedCost?: number;
  verified?: boolean;
  metricKind?: UusMetricKind;
  costKind?: UusCostKind;
  tokenSemantics?: UusTokenSemantics;
  calculationVersion?: string;
  extensions?: UusExtensions;
  suggestedLines?: number;
  acceptedLines?: number;
  addedLines?: number;
  deletedLines?: number;
  commits?: number;
  aiPercent?: number | null;
  metadata?: Record<string, unknown>;
  /** Legacy alias for tool. */
  toolName?: string;
};

/** Partition key for sync manifests / fingerprints (UUS grain). */
export function uusPartitionKey(row: {
  date: string;
  tool: string;
  accountKey?: string;
  model: string;
  source: string;
  repository?: UusRepository | null;
}): string {
  const repo = row.repository
    ? `${row.repository.host}/${row.repository.owner}/${row.repository.name}`
    : "";
  return `${row.date}|${row.tool}|${String(row.accountKey ?? "").trim()}|${row.model}|${row.source}|${repo}`;
}

/** Normalize wire aliases into a consistent UUS v1 shape. */
export function normalizeUusWireRecord(input: Record<string, unknown>): UusV1Record | null {
  const date = typeof input.date === "string" ? input.date.slice(0, 10) : "";
  const tool =
    (typeof input.tool === "string" && input.tool) ||
    (typeof input.toolName === "string" && input.toolName) ||
    "";
  const source = typeof input.source === "string" && input.source ? input.source : "local_scan";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !tool) return null;

  const model =
    (typeof input["gen_ai.request.model"] === "string" && input["gen_ai.request.model"]) ||
    (typeof input.model === "string" ? input.model : "") ||
    "";

  const repository =
    input.repository && typeof input.repository === "object" && !Array.isArray(input.repository)
      ? normalizeRepo(input.repository as Record<string, unknown>)
      : null;

  const extensions: UusExtensions = {
    ...((input.extensions && typeof input.extensions === "object"
      ? (input.extensions as UusExtensions)
      : {}) as UusExtensions),
  };
  if (typeof input.suggestedLines === "number") extensions["code.suggested_lines"] = input.suggestedLines;
  if (typeof input.acceptedLines === "number") extensions["code.accepted_lines"] = input.acceptedLines;
  if (typeof input.addedLines === "number") extensions["code.added_lines"] = input.addedLines;
  if (typeof input.deletedLines === "number") extensions["code.deleted_lines"] = input.deletedLines;
  if (typeof input.commits === "number") extensions["vcs.commits"] = input.commits;
  if ("aiPercent" in input) extensions.ai_percent = typeof input.aiPercent === "number" ? input.aiPercent : null;

  return {
    schemaVersion: UUS_SCHEMA_VERSION,
    date,
    "gen_ai.system": typeof input["gen_ai.system"] === "string" ? input["gen_ai.system"] : undefined,
    tool,
    "gen_ai.request.model": model,
    model,
    source,
    repository,
    accountKey: typeof input.accountKey === "string" ? input.accountKey.trim() : "",
    "gen_ai.usage.input_tokens": num(input["gen_ai.usage.input_tokens"] ?? input.inputTokens),
    "gen_ai.usage.output_tokens": num(input["gen_ai.usage.output_tokens"] ?? input.outputTokens),
    "gen_ai.usage.cache_read_tokens": num(input["gen_ai.usage.cache_read_tokens"] ?? input.cacheReadTokens),
    cache_write_tokens: num(input.cache_write_tokens ?? input.cacheWriteTokens),
    reasoning_tokens: num(input.reasoning_tokens ?? input.reasoningTokens),
    inputTokens: num(input.inputTokens ?? input["gen_ai.usage.input_tokens"]),
    outputTokens: num(input.outputTokens ?? input["gen_ai.usage.output_tokens"]),
    cacheReadTokens: num(input.cacheReadTokens ?? input["gen_ai.usage.cache_read_tokens"]),
    cacheWriteTokens: num(input.cacheWriteTokens ?? input.cache_write_tokens),
    reasoningTokens: num(input.reasoningTokens ?? input.reasoning_tokens),
    requests: num(input.requests),
    cost: normalizeCost(input.cost, input.estimatedCost, input.costKind),
    estimatedCost: typeof input.estimatedCost === "number" ? Math.max(0, input.estimatedCost) : undefined,
    verified: Boolean(input.verified),
    metricKind: input.metricKind === "productivity" || input.metricKind === "usage" ? input.metricKind : undefined,
    costKind:
      input.costKind === "verified_usage" ||
      input.costKind === "estimated_api" ||
      input.costKind === "actual_spend"
        ? input.costKind
        : undefined,
    tokenSemantics:
      input.tokenSemantics === "openai_subset_cache" ||
      input.tokenSemantics === "anthropic_additive_cache" ||
      input.tokenSemantics === "vendor_reported"
        ? input.tokenSemantics
        : undefined,
    calculationVersion: typeof input.calculationVersion === "string" ? input.calculationVersion : undefined,
    extensions,
    suggestedLines: num(input.suggestedLines ?? extensions["code.suggested_lines"]),
    acceptedLines: num(input.acceptedLines ?? extensions["code.accepted_lines"]),
    addedLines: num(input.addedLines ?? extensions["code.added_lines"]),
    deletedLines: num(input.deletedLines ?? extensions["code.deleted_lines"]),
    commits: num(input.commits ?? extensions["vcs.commits"]),
    aiPercent:
      typeof extensions.ai_percent === "number"
        ? extensions.ai_percent
        : typeof input.aiPercent === "number"
          ? input.aiPercent
          : null,
    metadata:
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? (input.metadata as Record<string, unknown>)
        : undefined,
  };
}

function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeRepo(input: Record<string, unknown>): UusRepository | null {
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const owner = typeof input.owner === "string" ? input.owner.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!host || !owner || !name) return null;
  return { host: host.toLowerCase(), owner, name };
}

function normalizeCost(
  cost: unknown,
  estimatedCost: unknown,
  costKind: unknown,
): UusCost | undefined {
  if (cost && typeof cost === "object" && !Array.isArray(cost)) {
    const c = cost as Record<string, unknown>;
    return {
      amountMicros: typeof c.amountMicros === "number" ? Math.max(0, Math.round(c.amountMicros)) : undefined,
      amountUsd: typeof c.amountUsd === "number" ? Math.max(0, c.amountUsd) : undefined,
      kind:
        c.kind === "verified_usage" || c.kind === "estimated_api" || c.kind === "actual_spend"
          ? c.kind
          : undefined,
    };
  }
  if (typeof estimatedCost === "number" && estimatedCost > 0) {
    return {
      amountUsd: estimatedCost,
      amountMicros: Math.round(estimatedCost * 1_000_000),
      kind:
        costKind === "verified_usage" || costKind === "estimated_api" || costKind === "actual_spend"
          ? costKind
          : "estimated_api",
    };
  }
  return undefined;
}

/** Content hash inputs for a partition (absolute totals). */
export function uusContentFingerprint(row: UusV1Record): string {
  const cost = row.cost?.amountMicros ?? Math.round((row.estimatedCost ?? 0) * 1_000_000);
  return [
    `in:${row.inputTokens ?? row["gen_ai.usage.input_tokens"] ?? 0}`,
    `out:${row.outputTokens ?? row["gen_ai.usage.output_tokens"] ?? 0}`,
    `cr:${row.cacheReadTokens ?? row["gen_ai.usage.cache_read_tokens"] ?? 0}`,
    `cw:${row.cacheWriteTokens ?? row.cache_write_tokens ?? 0}`,
    `r:${row.reasoningTokens ?? row.reasoning_tokens ?? 0}`,
    `req:${row.requests ?? 0}`,
    `cost:${cost}`,
    `sug:${row.suggestedLines ?? 0}`,
    `acc:${row.acceptedLines ?? 0}`,
    `add:${row.addedLines ?? 0}`,
    `del:${row.deletedLines ?? 0}`,
    `com:${row.commits ?? 0}`,
    `ai:${row.aiPercent ?? ""}`,
    `v:${row.verified ? 1 : 0}`,
    `mk:${row.metricKind ?? ""}`,
  ].join(",");
}
