import { randomBytes } from "crypto";
import { Prisma, prisma } from "@usejunction/db";
import { logServerError } from "@/lib/errors/public";
import { CALCULATION_VERSION, PRICING_VERSION } from "@/lib/metrics/source-priority";

export const ORG_DAY_SNAPSHOT_VERSION = `org-day-snap-v2:${CALCULATION_VERSION}:${PRICING_VERSION}`;
export const ORG_DAY_WATERMARK_KIND = "org_usage_day";

/** Prevent parallel ensure/materialize races for the same org (current+previous windows). */
const orgMaterializeLocks = new Map<string, Promise<void>>();

/** Avoid Slack spam if recovery keeps failing for the same org. */
const failsafeAlertAt = new Map<string, number>();
const FAILSAFE_ALERT_COOLDOWN_MS = 15 * 60_000;

function alertSnapshotFailsafe(
  scope: string,
  orgId: string,
  error: unknown,
  details?: Record<string, unknown>,
) {
  const now = Date.now();
  const last = failsafeAlertAt.get(orgId) ?? 0;
  if (now - last < FAILSAFE_ALERT_COOLDOWN_MS) {
    if (details) console.error(`[${scope}]`, error, details);
    else console.error(`[${scope}]`, error);
    return;
  }
  failsafeAlertAt.set(orgId, now);
  logServerError(scope, error, { orgId, ...details });
}

function newId() {
  return `c${randomBytes(12).toString("hex")}`;
}

function utcDay(date: Date | string): Date {
  if (typeof date === "string") return new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDayInclusive(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let cursor = utcDay(from).getTime(); cursor <= utcDay(to).getTime(); cursor += 86_400_000) {
    days.push(new Date(cursor));
  }
  return days;
}

async function withOrgLock(orgId: string, work: () => Promise<void>): Promise<void> {
  const previous = orgMaterializeLocks.get(orgId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate);
  orgMaterializeLocks.set(orgId, next);
  await previous;
  try {
    await work();
  } finally {
    release();
    if (orgMaterializeLocks.get(orgId) === next) orgMaterializeLocks.delete(orgId);
  }
}

/** Mark calendar days dirty so the next materialize pass recomputes only those days. */
export async function markOrgUsageDaysDirty(
  orgId: string,
  dates: Array<Date | string>,
  metricVersion: string = ORG_DAY_SNAPSHOT_VERSION,
): Promise<string[]> {
  const unique = [...new Set(dates.map((d) => isoDay(utcDay(d))))].sort();
  if (!unique.length) return [];

  await prisma.analyticsDirtyDay.createMany({
    data: unique.map((day) => ({
      id: newId(),
      orgId,
      date: utcDay(day),
      metricVersion,
    })),
    skipDuplicates: true,
  });
  return unique;
}

type RangeAggregateRow = {
  date: Date;
  toolName: string;
  developerId: string;
  modelName: string;
  accountKey: string;
  isDayTotal: number;
  isDeveloperGrain: number;
  isModelGrain: number;
  requests: number;
  sessions: number;
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
  reasoningTokens: bigint;
  suggestedLines: number;
  acceptedLines: number;
  addedLines: number;
  deletedLines: number;
  commits: number;
  verifiedUsageCostMicros: bigint;
  estimatedApiCostMicros: bigint;
  actualSpendCostMicros: bigint;
  activeDevelopers: number;
  activeDeveloperIds: unknown;
  sourceObservedThrough: Date | null;
};

function parseDeveloperIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Steady-state CTE width once the hot tip has been sealed. */
const MATERIALIZE_CHUNK_DAYS = 14;

/**
 * Newest-first escalating widths so today seals in the first CTE, then history
 * widens (1 → 2 → 4 → 7 → 14) for efficient backfill under a deadline.
 */
const MATERIALIZE_ESCALATING_CHUNK_DAYS = [1, 2, 4, 7, MATERIALIZE_CHUNK_DAYS] as const;

async function withOrgDbLock(orgId: string, work: () => Promise<void>): Promise<void> {
  // In-process serialization. Cross-instance races are bounded by upsert/skipDuplicates
  // and Sync now / cron ownership of rematerialize (read path no longer rematerializes).
  await withOrgLock(orgId, work);
}

/**
 * Materialize an entire [from, to] window (chunked CTEs), then replace snapshot
 * rows for those days. Used by cron / Sync now.
 */
export async function materializeOrgUsageRange(
  orgId: string,
  from: Date | string,
  to: Date | string,
  metricVersion: string = ORG_DAY_SNAPSHOT_VERSION,
  options: { deadlineMs?: number } = {},
): Promise<number> {
  const fromDay = utcDay(from);
  const toDay = utcDay(to);
  if (toDay.getTime() < fromDay.getTime()) return 0;

  let total = 0;
  await withOrgDbLock(orgId, async () => {
    total = await materializeOrgUsageRangeChunks(orgId, fromDay, toDay, metricVersion, options.deadlineMs);
  });
  return total;
}

/** Split [fromDay, toDay] into newest-first escalating chunks. Exported for tests. */
export function planMaterializeChunks(fromDay: Date, toDay: Date): Array<{ from: Date; to: Date }> {
  const fromMs = utcDay(fromDay).getTime();
  const toMs = utcDay(toDay).getTime();
  if (toMs < fromMs) return [];

  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = toMs;
  let stepIdx = 0;
  while (cursor >= fromMs) {
    const width = MATERIALIZE_ESCALATING_CHUNK_DAYS[
      Math.min(stepIdx, MATERIALIZE_ESCALATING_CHUNK_DAYS.length - 1)
    ]!;
    const chunkTo = new Date(cursor);
    const chunkFromMs = Math.max(fromMs, cursor - (width - 1) * 86_400_000);
    chunks.push({ from: new Date(chunkFromMs), to: chunkTo });
    cursor = chunkFromMs - 86_400_000;
    stepIdx += 1;
  }
  return chunks;
}

async function materializeOrgUsageRangeChunks(
  orgId: string,
  fromDay: Date,
  toDay: Date,
  metricVersion: string,
  deadlineMs?: number,
): Promise<number> {
  let total = 0;
  for (const chunk of planMaterializeChunks(fromDay, toDay)) {
    if (typeof deadlineMs === "number" && Date.now() >= deadlineMs) break;
    total += await materializeOrgUsageRangeUnlocked(orgId, chunk.from, chunk.to, metricVersion);
  }
  return total;
}

async function materializeOrgUsageRangeUnlocked(
  orgId: string,
  fromDay: Date,
  toDay: Date,
  metricVersion: string,
): Promise<number> {
  const fromKey = isoDay(fromDay);
  const toKey = isoDay(toDay);
  const now = new Date();
  const rangeDays = eachDayInclusive(fromDay, toDay);

  const rows = await prisma.$queryRaw<RangeAggregateRow[]>`
    WITH classified AS (
      SELECT usage_daily.*,
        CASE source
          WHEN 'local_scan' THEN 'device_observed'
          WHEN 'cursor_local' THEN 'device_observed'
          WHEN 'antigravity_local' THEN 'device_observed'
          WHEN 'antigravity_usage' THEN 'device_observed'
          WHEN 'opencode_local' THEN 'device_observed'
          WHEN 'opencode_usage' THEN 'device_observed'
          WHEN 'cursor_usage_events' THEN 'vendor_verified'
          WHEN 'cursor_plan_percent' THEN 'device_observed'
          ELSE source
        END AS normalized_source,
        CASE
          WHEN source = 'cursor_local' OR source = 'opencode_local' OR metric_kind = 'productivity' THEN 'productivity'
          ELSE COALESCE(NULLIF(metric_kind, ''), metadata->>'metricKind', 'usage')
        END AS effective_metric_kind,
        CASE
          WHEN cost_kind IS NOT NULL THEN cost_kind
          WHEN verified OR source IN ('vendor_verified', 'cursor_usage_events') THEN 'verified_usage'
          WHEN source = 'invoice_imported' THEN 'actual_spend'
          ELSE 'estimated_api'
        END AS effective_cost_kind,
        CASE
          WHEN source IN ('vendor_verified', 'cursor_usage_events') THEN 0
          WHEN source = 'otel_observed' THEN 1
          WHEN source IN ('device_observed', 'local_scan', 'cursor_local', 'antigravity_local', 'antigravity_usage', 'opencode_local', 'opencode_usage', 'cursor_plan_percent') THEN 2
          WHEN source = 'gateway_observed' THEN 3
          WHEN source = 'estimated' THEN 4
          ELSE 99
        END AS activity_priority,
        CASE
          WHEN source IN ('vendor_verified', 'cursor_usage_events', 'invoice_imported') THEN 0
          WHEN source = 'gateway_observed' THEN 1
          WHEN source IN ('estimated', 'device_observed', 'local_scan', 'cursor_local', 'antigravity_local', 'antigravity_usage', 'opencode_local', 'opencode_usage', 'cursor_plan_percent') THEN 2
          WHEN source = 'otel_observed' THEN 3
          ELSE 99
        END AS cost_priority
      FROM usage_daily
      WHERE org_id = ${orgId}
        AND date >= ${fromKey}::date
        AND date <= ${toKey}::date
    ), ranked AS (
      SELECT classified.*,
        MIN(activity_priority) FILTER (
          WHERE effective_metric_kind <> 'productivity'
            AND (requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0 OR active_seconds > 0)
        ) OVER (
          PARTITION BY date, developer_id, provider, product, tool_name, model, COALESCE(account_key, '')
        ) AS best_activity_priority,
        MIN(cost_priority) FILTER (WHERE cost_micros > 0) OVER (
          PARTITION BY date, provider, tool_name, model, COALESCE(account_key, '')
        ) AS best_cost_priority
      FROM classified
    ), canonical AS (
      SELECT ranked.*,
        effective_metric_kind <> 'productivity'
          AND normalized_source <> 'estimated'
          AND activity_priority = best_activity_priority
          AND (requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0 OR active_seconds > 0)
          AS selected_activity,
        cost_micros > 0 AND cost_priority = best_cost_priority AS selected_cost
      FROM ranked
    ), selected AS (
      SELECT * FROM canonical
      WHERE selected_activity OR selected_cost OR effective_metric_kind = 'productivity'
    ), aggregates AS (
      SELECT
        date,
        CASE WHEN GROUPING(COALESCE(tool_name, '')) = 1 THEN '' ELSE COALESCE(tool_name, '') END AS tool_name_value,
        CASE WHEN GROUPING(COALESCE(developer_id, '')) = 1 THEN '' ELSE COALESCE(developer_id, '') END AS developer_id_value,
        CASE WHEN GROUPING(COALESCE(model, '')) = 1 THEN '' ELSE COALESCE(model, '') END AS model_name_value,
        CASE WHEN GROUPING(COALESCE(account_key, '')) = 1 THEN '' ELSE COALESCE(account_key, '') END AS account_key_value,
        GROUPING(COALESCE(tool_name, '')) AS is_day_total,
        CASE WHEN GROUPING(COALESCE(developer_id, '')) = 0 THEN 1 ELSE 0 END AS is_developer_grain,
        CASE WHEN GROUPING(COALESCE(model, '')) = 0 THEN 1 ELSE 0 END AS is_model_grain,
        COALESCE(SUM(CASE WHEN selected_activity THEN requests ELSE 0 END), 0)::int AS requests,
        COALESCE(SUM(
          CASE
            WHEN selected_activity OR effective_metric_kind = 'productivity' THEN sessions
            ELSE 0
          END
        ), 0)::int AS sessions,
        COALESCE(SUM(CASE WHEN selected_activity THEN input_tokens ELSE 0 END), 0)::bigint AS "inputTokens",
        COALESCE(SUM(CASE WHEN selected_activity THEN output_tokens ELSE 0 END), 0)::bigint AS "outputTokens",
        COALESCE(SUM(
          CASE
            WHEN selected_activity OR effective_metric_kind = 'productivity' THEN cache_read_tokens
            ELSE 0
          END
        ), 0)::bigint AS "cacheReadTokens",
        COALESCE(SUM(
          CASE
            WHEN selected_activity OR effective_metric_kind = 'productivity' THEN cache_write_tokens
            ELSE 0
          END
        ), 0)::bigint AS "cacheWriteTokens",
        COALESCE(SUM(
          CASE
            WHEN selected_activity OR effective_metric_kind = 'productivity' THEN reasoning_tokens
            ELSE 0
          END
        ), 0)::bigint AS "reasoningTokens",
        COALESCE(SUM(
          CASE WHEN effective_metric_kind = 'productivity' THEN suggested_lines ELSE 0 END
        ), 0)::int AS "suggestedLines",
        COALESCE(SUM(
          CASE WHEN effective_metric_kind = 'productivity' THEN accepted_lines ELSE 0 END
        ), 0)::int AS "acceptedLines",
        COALESCE(SUM(
          CASE WHEN effective_metric_kind = 'productivity' THEN added_lines ELSE 0 END
        ), 0)::int AS "addedLines",
        COALESCE(SUM(
          CASE WHEN effective_metric_kind = 'productivity' THEN deleted_lines ELSE 0 END
        ), 0)::int AS "deletedLines",
        COALESCE(SUM(
          CASE WHEN effective_metric_kind = 'productivity' THEN commits ELSE 0 END
        ), 0)::int AS commits,
        COALESCE(SUM(CASE WHEN selected_cost AND effective_cost_kind = 'verified_usage' THEN cost_micros ELSE 0 END), 0)::bigint AS "verifiedUsageCostMicros",
        COALESCE(SUM(CASE WHEN selected_cost AND effective_cost_kind = 'estimated_api' THEN cost_micros ELSE 0 END), 0)::bigint AS "estimatedApiCostMicros",
        COALESCE(SUM(CASE WHEN selected_cost AND effective_cost_kind = 'actual_spend' THEN cost_micros ELSE 0 END), 0)::bigint AS "actualSpendCostMicros",
        COUNT(DISTINCT developer_id) FILTER (
          WHERE selected_activity
            AND (requests > 0 OR input_tokens > 0 OR output_tokens > 0 OR cost_micros > 0 OR sessions > 0 OR active_seconds > 0)
        )::int AS "activeDevelopers",
        COALESCE(
          jsonb_agg(DISTINCT developer_id) FILTER (
            WHERE selected_activity
              AND developer_id IS NOT NULL
              AND (requests > 0 OR input_tokens > 0 OR output_tokens > 0 OR cost_micros > 0 OR sessions > 0 OR active_seconds > 0)
          ),
          '[]'::jsonb
        ) AS "activeDeveloperIds",
        MAX(observed_at) AS "sourceObservedThrough"
      FROM selected
      GROUP BY GROUPING SETS (
        (date),
        (date, COALESCE(tool_name, ''), COALESCE(account_key, '')),
        (date, COALESCE(developer_id, '')),
        (date, COALESCE(developer_id, ''), COALESCE(tool_name, ''), COALESCE(account_key, '')),
        (date, COALESCE(tool_name, ''), COALESCE(model, ''), COALESCE(account_key, '')),
        (date, COALESCE(developer_id, ''), COALESCE(tool_name, ''), COALESCE(model, ''), COALESCE(account_key, ''))
      )
    )
    SELECT
      date,
      tool_name_value AS "toolName",
      developer_id_value AS "developerId",
      model_name_value AS "modelName",
      account_key_value AS "accountKey",
      is_day_total AS "isDayTotal",
      is_developer_grain AS "isDeveloperGrain",
      is_model_grain AS "isModelGrain",
      requests,
      sessions,
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "reasoningTokens",
      "suggestedLines",
      "acceptedLines",
      "addedLines",
      "deletedLines",
      commits,
      "verifiedUsageCostMicros",
      "estimatedApiCostMicros",
      "actualSpendCostMicros",
      "activeDevelopers",
      "activeDeveloperIds",
      "sourceObservedThrough"
    FROM aggregates
  `;

  const writeRows: Array<{
    orgId: string;
    date: Date;
    toolName: string;
    developerId: string;
    modelName: string;
    accountKey: string;
    metricVersion: string;
    requests: number;
    sessions: number;
    inputTokens: bigint;
    outputTokens: bigint;
    cacheReadTokens: bigint;
    cacheWriteTokens: bigint;
    reasoningTokens: bigint;
    suggestedLines: number;
    acceptedLines: number;
    addedLines: number;
    deletedLines: number;
    commits: number;
    verifiedUsageCostMicros: bigint;
    estimatedApiCostMicros: bigint;
    actualSpendCostMicros: bigint;
    activeDevelopers: number;
    activeDeveloperIds: string[];
    computedAt: Date;
    sourceObservedThrough: Date | null;
  }> = [];

  function hasSignal(row: RangeAggregateRow): boolean {
    return (
      Number(row.requests) !== 0 ||
      Number(row.sessions) !== 0 ||
      BigInt(row.verifiedUsageCostMicros) !== BigInt(0) ||
      BigInt(row.estimatedApiCostMicros) !== BigInt(0) ||
      BigInt(row.actualSpendCostMicros) !== BigInt(0) ||
      BigInt(row.inputTokens) !== BigInt(0) ||
      BigInt(row.outputTokens) !== BigInt(0) ||
      Number(row.suggestedLines) !== 0 ||
      Number(row.acceptedLines) !== 0 ||
      Number(row.addedLines) !== 0 ||
      Number(row.deletedLines) !== 0 ||
      Number(row.commits) !== 0
    );
  }

  const daysWithOrgTotal = new Set<string>();
  for (const row of rows) {
    const day = utcDay(row.date);
    const dayKey = isoDay(day);
    const isDayTotal = Number(row.isDayTotal) === 1;
    const isDeveloperGrain = Number(row.isDeveloperGrain) === 1;
    const isModelGrain = Number(row.isModelGrain) === 1;
    const toolName = isDayTotal ? "" : (row.toolName ?? "");
    const developerId = row.developerId ?? "";
    const modelName = isModelGrain ? (row.modelName ?? "") : "";
    const accountKey = toolName === "" ? "" : (row.accountKey ?? "");
    // Model grains require a tool name; day-total rows keep model empty.
    if (isModelGrain && toolName === "") continue;
    // Empty model from the model grouping set duplicates the tool rollup — skip.
    if (isModelGrain && modelName === "") continue;
    if (!isDayTotal && toolName === "" && !isDeveloperGrain) continue;
    // Null/empty developer_id costs stay on org rollups only — skip colliding developer grains.
    if (isDeveloperGrain && developerId === "") continue;
    // Skip empty developer/tool/model grains with no signal (keeps write volume down).
    if ((isDeveloperGrain || isModelGrain) && !hasSignal(row)) {
      continue;
    }
    if (!isDeveloperGrain && isDayTotal && !isModelGrain) daysWithOrgTotal.add(dayKey);
    writeRows.push({
      orgId,
      date: day,
      toolName,
      developerId: isDeveloperGrain ? developerId : "",
      modelName,
      accountKey,
      metricVersion,
      requests: Number(row.requests),
      sessions: Number(row.sessions),
      inputTokens: BigInt(row.inputTokens),
      outputTokens: BigInt(row.outputTokens),
      cacheReadTokens: BigInt(row.cacheReadTokens),
      cacheWriteTokens: BigInt(row.cacheWriteTokens),
      reasoningTokens: BigInt(row.reasoningTokens),
      suggestedLines: Number(row.suggestedLines),
      acceptedLines: Number(row.acceptedLines),
      addedLines: Number(row.addedLines),
      deletedLines: Number(row.deletedLines),
      commits: Number(row.commits),
      verifiedUsageCostMicros: BigInt(row.verifiedUsageCostMicros),
      estimatedApiCostMicros: BigInt(row.estimatedApiCostMicros),
      actualSpendCostMicros: BigInt(row.actualSpendCostMicros),
      activeDevelopers: Number(row.activeDevelopers),
      activeDeveloperIds: parseDeveloperIds(row.activeDeveloperIds),
      computedAt: now,
      sourceObservedThrough: row.sourceObservedThrough,
    });
  }

  // Seal empty org-total days so readers do not keep treating them as missing.
  for (const day of rangeDays) {
    if (daysWithOrgTotal.has(isoDay(day))) continue;
    writeRows.push({
      orgId,
      date: day,
      toolName: "",
      developerId: "",
      modelName: "",
      accountKey: "",
      metricVersion,
      requests: 0,
      sessions: 0,
      inputTokens: BigInt(0),
      outputTokens: BigInt(0),
      cacheReadTokens: BigInt(0),
      cacheWriteTokens: BigInt(0),
      reasoningTokens: BigInt(0),
      suggestedLines: 0,
      acceptedLines: 0,
      addedLines: 0,
      deletedLines: 0,
      commits: 0,
      verifiedUsageCostMicros: BigInt(0),
      estimatedApiCostMicros: BigInt(0),
      actualSpendCostMicros: BigInt(0),
      activeDevelopers: 0,
      activeDeveloperIds: [],
      computedAt: now,
      sourceObservedThrough: null,
    });
  }

  // Dedupe by unique key in case GROUPING SETS emit overlapping empty grains.
  const deduped = new Map<string, (typeof writeRows)[number]>();
  for (const row of writeRows) {
    const key = `${isoDay(row.date)}|${row.toolName}|${row.developerId}|${row.modelName}|${row.accountKey}`;
    deduped.set(key, row);
  }
  const finalRows = [...deduped.values()];

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org-snap:${orgId}`}))`;
    await tx.orgUsageDaySnapshot.deleteMany({
      where: {
        orgId,
        metricVersion,
        date: { gte: fromDay, lte: toDay },
      },
    });
    if (finalRows.length > 0) {
      // createMany has a practical bind limit; chunk large windows.
      const chunkSize = 500;
      for (let i = 0; i < finalRows.length; i += chunkSize) {
        await tx.orgUsageDaySnapshot.createMany({ data: finalRows.slice(i, i + chunkSize) });
      }
    }
    await tx.analyticsDirtyDay.deleteMany({
      where: {
        orgId,
        metricVersion,
        date: { gte: fromDay, lte: toDay },
      },
    });
    await tx.analyticsWatermark.upsert({
      where: {
        orgId_kind_metricVersion: {
          orgId,
          kind: ORG_DAY_WATERMARK_KIND,
          metricVersion,
        },
      },
      create: {
        orgId,
        kind: ORG_DAY_WATERMARK_KIND,
        metricVersion,
        cursorDate: toDay,
        status: "idle",
      },
      update: {
        cursorDate: toDay,
        status: "idle",
        lastError: null,
      },
    });
  });

  return finalRows.length;
}

export async function materializeOrgUsageDay(
  orgId: string,
  day: Date | string,
  metricVersion: string = ORG_DAY_SNAPSHOT_VERSION,
): Promise<number> {
  return materializeOrgUsageRange(orgId, day, day, metricVersion);
}

/** Rematerialize dirty days for an org as contiguous ranges (not per-day CTEs). */
export async function materializeDirtyOrgUsageDays(
  orgId: string,
  options: {
    limit?: number;
    metricVersion?: string;
    onlyWithin?: { from: Date; to: Date };
    deadlineMs?: number;
  } = {},
): Promise<{ days: number; rows: number }> {
  const metricVersion = options.metricVersion ?? ORG_DAY_SNAPSHOT_VERSION;
  const dirty = await prisma.analyticsDirtyDay.findMany({
    where: {
      orgId,
      metricVersion,
      ...(options.onlyWithin
        ? { date: { gte: utcDay(options.onlyWithin.from), lte: utcDay(options.onlyWithin.to) } }
        : {}),
    },
    orderBy: { date: "asc" },
    take: options.limit ?? 90,
    select: { date: true },
  });
  if (!dirty.length) return { days: 0, rows: 0 };

  // Collapse dirty days into contiguous ranges, then one CTE per range.
  const ranges: Array<{ from: Date; to: Date }> = [];
  for (const entry of dirty) {
    const day = utcDay(entry.date);
    const last = ranges[ranges.length - 1];
    if (last && day.getTime() === last.to.getTime() + 86_400_000) {
      last.to = day;
    } else {
      ranges.push({ from: day, to: day });
    }
  }

  let rows = 0;
  let days = 0;
  // Newest-first so a truncated budget seals the visible window before history.
  for (const range of [...ranges].reverse()) {
    if (typeof options.deadlineMs === "number" && Date.now() >= options.deadlineMs) break;
    rows += await materializeOrgUsageRange(orgId, range.from, range.to, metricVersion, {
      deadlineMs: options.deadlineMs,
    });
    days += Math.floor((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
  }
  return { days, rows };
}

/**
 * Cron / Sync-now entry point: rematerialize dirty days, and always refresh today
 * (plus yesterday) so rolling dashboards advance without hot-path rematerialize.
 * Loops until no dirty days remain (or a safety cap) so one Sync clears backlogs.
 */
export async function rematerializeOrgSnapshots(
  orgId: string,
  options: { metricVersion?: string; includeToday?: boolean; maxDurationMs?: number } = {},
): Promise<{ dirtyDays: number; rows: number; dirtyRemaining: number }> {
  const metricVersion = options.metricVersion ?? ORG_DAY_SNAPSHOT_VERSION;
  const today = utcDay(new Date());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const deadline =
    typeof options.maxDurationMs === "number" && options.maxDurationMs > 0
      ? Date.now() + options.maxDurationMs
      : null;

  if (options.includeToday !== false) {
    await markOrgUsageDaysDirty(orgId, [yesterday, today], metricVersion);
  }

  let dirtyDays = 0;
  let rows = 0;
  // Cap passes so a runaway dirty set cannot hang Sync forever (90 days × 20 = 1800).
  for (let pass = 0; pass < 20; pass += 1) {
    if (deadline !== null && Date.now() >= deadline) break;
    const result = await materializeDirtyOrgUsageDays(orgId, {
      metricVersion,
      limit: 90,
      ...(deadline !== null ? { deadlineMs: deadline } : {}),
    });
    dirtyDays += result.days;
    rows += result.rows;
    if (result.days === 0) break;
  }
  const dirtyRemaining = await prisma.analyticsDirtyDay.count({
    where: { orgId, metricVersion },
  });
  return { dirtyDays, rows, dirtyRemaining };
}

/**
 * Org-total snapshot days that conflict with usage_daily:
 * - empty stubs (no observed-through, all zeros) with any usage signal
 * - undercounts (sealed requests=0 / $0 while usage_daily has requests / cost)
 */
async function findCorruptOrgDaySnapshots(
  orgId: string,
  fromDay: Date,
  toDay: Date,
  metricVersion: string,
): Promise<Date[]> {
  const fromKey = isoDay(fromDay);
  const toKey = isoDay(toDay);
  const rows = await prisma.$queryRaw<Array<{ date: Date }>>`
    WITH org_totals AS (
      SELECT
        date,
        requests,
        input_tokens,
        output_tokens,
        verified_usage_cost_micros,
        estimated_api_cost_micros,
        actual_spend_cost_micros,
        source_observed_through
      FROM org_usage_day_snapshots
      WHERE org_id = ${orgId}
        AND metric_version = ${metricVersion}
        AND tool_name = ''
        AND developer_id = ''
        AND model_name = ''
        AND date >= ${fromKey}::date
        AND date <= ${toKey}::date
    ),
    usage_signals AS (
      SELECT
        date,
        COALESCE(SUM(requests), 0)::int AS requests,
        COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros,
        COALESCE(SUM(sessions), 0)::int AS sessions,
        COALESCE(SUM(active_seconds), 0)::bigint AS active_seconds
      FROM usage_daily
      WHERE org_id = ${orgId}
        AND date >= ${fromKey}::date
        AND date <= ${toKey}::date
      GROUP BY date
    )
    SELECT o.date
    FROM org_totals o
    INNER JOIN usage_signals u ON u.date = o.date
    WHERE
      (
        o.requests = 0
        AND o.input_tokens = 0
        AND o.output_tokens = 0
        AND o.verified_usage_cost_micros = 0
        AND o.estimated_api_cost_micros = 0
        AND o.actual_spend_cost_micros = 0
        AND o.source_observed_through IS NULL
        AND (
          u.requests > 0
          OR u.sessions > 0
          OR u.input_tokens > 0
          OR u.output_tokens > 0
          OR u.cost_micros > 0
          OR u.active_seconds > 0
        )
      )
      OR (o.requests = 0 AND u.requests > 0)
      OR (
        o.verified_usage_cost_micros = 0
        AND o.estimated_api_cost_micros = 0
        AND o.actual_spend_cost_micros = 0
        AND u.cost_micros > 0
      )
    ORDER BY o.date ASC
  `;

  return rows.map((row) => utcDay(row.date));
}

/**
 * Read-path seal: insert empty org-total stubs for missing days that are not
 * already dirty. Corrupt sealed days (empty stubs / undercounts vs usage_daily)
 * are marked dirty and enqueued for the worker — never rematerialized inline
 * so page loads stay fast.
 */
export async function ensureOrgUsageDaySnapshots(
  orgId: string,
  from: Date,
  to: Date,
  options: { metricVersion?: string } = {},
): Promise<{ stubbed: number; hadCoverage: boolean; recovered: number; pendingDirty: number }> {
  const metricVersion = options.metricVersion ?? ORG_DAY_SNAPSHOT_VERSION;
  const fromDay = utcDay(from);
  const toDay = utcDay(to);
  let stubbed = 0;
  let hadCoverage = false;
  const recovered = 0;
  let pendingDirty = 0;

  try {
    await withOrgDbLock(orgId, async () => {
      const [existing, dirtyRows] = await Promise.all([
        prisma.orgUsageDaySnapshot.findMany({
          where: {
            orgId,
            metricVersion,
            toolName: "",
            developerId: "",
            modelName: "",
            date: { gte: fromDay, lte: toDay },
          },
          select: { date: true },
        }),
        prisma.analyticsDirtyDay.findMany({
          where: {
            orgId,
            metricVersion,
            date: { gte: fromDay, lte: toDay },
          },
          select: { date: true },
        }),
      ]);
      hadCoverage = existing.length > 0;
      const have = new Set(existing.map((row) => isoDay(row.date)));
      const dirtyKeys = new Set(dirtyRows.map((row) => isoDay(row.date)));
      pendingDirty = dirtyKeys.size;

      // Never seal authoritative zeros over dirty days — prefer gaps / "updating".
      const missing = eachDayInclusive(fromDay, toDay).filter(
        (day) => !have.has(isoDay(day)) && !dirtyKeys.has(isoDay(day)),
      );

      if (missing.length) {
        // Never seal zeros over days that already have usage_daily facts — mark
        // dirty so rematerialize fills real totals instead of authoritative stubs.
        const missingKeys = missing.map((day) => isoDay(day));
        const usageDays = await prisma.$queryRaw<Array<{ date: Date }>>`
          SELECT DISTINCT date
          FROM usage_daily
          WHERE org_id = ${orgId}
            AND date IN (${Prisma.join(missingKeys.map((d) => Prisma.sql`${d}::date`))})
            AND (
              requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0
              OR cost_micros > 0 OR active_seconds > 0
            )
        `;
        const usageKeySet = new Set(usageDays.map((row) => isoDay(row.date)));
        const toStub = missing.filter((day) => !usageKeySet.has(isoDay(day)));
        const toDirty = missing.filter((day) => usageKeySet.has(isoDay(day)));

        if (toDirty.length) {
          const marked = await markOrgUsageDaysDirty(orgId, toDirty, metricVersion);
          pendingDirty += marked.length;
          for (const day of toDirty) dirtyKeys.add(isoDay(day));
          try {
            const { enqueueMaterializationJob } = await import("./jobs");
            await enqueueMaterializationJob(orgId);
          } catch (enqueueError) {
            alertSnapshotFailsafe("analytics/snapshots_enqueue_failed", orgId, enqueueError, {
              days: toDirty.length,
              reason: "missing-days-with-usage",
            });
          }
        }

        if (toStub.length) {
          const now = new Date();
          await prisma.orgUsageDaySnapshot.createMany({
            data: toStub.map((day) => ({
              orgId,
              date: day,
              toolName: "",
              developerId: "",
              modelName: "",
              accountKey: "",
              metricVersion,
              requests: 0,
              sessions: 0,
              inputTokens: BigInt(0),
              outputTokens: BigInt(0),
              cacheReadTokens: BigInt(0),
              cacheWriteTokens: BigInt(0),
              reasoningTokens: BigInt(0),
              suggestedLines: 0,
              acceptedLines: 0,
              addedLines: 0,
              deletedLines: 0,
              commits: 0,
              verifiedUsageCostMicros: BigInt(0),
              estimatedApiCostMicros: BigInt(0),
              actualSpendCostMicros: BigInt(0),
              activeDevelopers: 0,
              activeDeveloperIds: [],
              computedAt: now,
              sourceObservedThrough: null,
            })),
            skipDuplicates: true,
          });
          stubbed = toStub.length;
        }
      }

      const corruptDays = await findCorruptOrgDaySnapshots(orgId, fromDay, toDay, metricVersion);
      if (!corruptDays.length) return;

      console.warn("[analytics/snapshots_missing] enqueueing corrupt org-day snapshots", {
        orgId,
        from: isoDay(fromDay),
        to: isoDay(toDay),
        days: corruptDays.length,
        hadCoverage,
        stubbed,
      });

      const marked = await markOrgUsageDaysDirty(orgId, corruptDays, metricVersion);
      pendingDirty += marked.length;

      try {
        const { enqueueMaterializationJob } = await import("./jobs");
        await enqueueMaterializationJob(orgId);
      } catch (enqueueError) {
        alertSnapshotFailsafe("analytics/snapshots_enqueue_failed", orgId, enqueueError, {
          days: corruptDays.length,
        });
      }
    });
  } catch (error) {
    alertSnapshotFailsafe("analytics/snapshots_inaccessible", orgId, error, {
      from: isoDay(fromDay),
      to: isoDay(toDay),
    });
    // Do not rematerialize on the read path — enqueue and surface the error.
    try {
      const { enqueueMaterializationJob } = await import("./jobs");
      await enqueueMaterializationJob(orgId);
    } catch (enqueueError) {
      alertSnapshotFailsafe("analytics/snapshots_enqueue_failed", orgId, enqueueError, {
        from: isoDay(fromDay),
        to: isoDay(toDay),
        reason: "inaccessible-fallback",
      });
    }
    throw error;
  }

  return { stubbed, hadCoverage, recovered, pendingDirty };
}

/** Mark yesterday+today dirty for orgs that have recent usage (daily seal helper). */
export async function markActiveOrgsTodayDirty(
  options: { metricVersion?: string; lookbackDays?: number } = {},
): Promise<number> {
  const metricVersion = options.metricVersion ?? ORG_DAY_SNAPSHOT_VERSION;
  const lookbackDays = options.lookbackDays ?? 7;
  const today = utcDay(new Date());
  const since = new Date(today.getTime() - lookbackDays * 86_400_000);
  const yesterday = new Date(today.getTime() - 86_400_000);

  const orgs = await prisma.usageDaily.findMany({
    where: { date: { gte: since } },
    distinct: ["orgId"],
    select: { orgId: true },
    take: 500,
  });

  for (const row of orgs) {
    await markOrgUsageDaysDirty(row.orgId, [yesterday, today], metricVersion);
  }
  return orgs.length;
}

export { utcDay as snapshotUtcDay, isoDay as snapshotIsoDay, eachDayInclusive as snapshotEachDay };
