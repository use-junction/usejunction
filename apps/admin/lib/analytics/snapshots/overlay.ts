/**
 * Dirty-day helpers for rematerialize queues. Dashboard reads no longer run
 * live CTEs for a recent horizon — sealed org_usage_day_snapshots are authoritative.
 */
import { Prisma, prisma } from "@usejunction/db";
import { ORG_DAY_SNAPSHOT_VERSION } from "./materialize";
import { syncTrailBackedSql } from "./sync-trail";

export type LiveDayTotalRow = {
  date: Date;
  toolName: string;
  developerId: string;
  /** True for (date) org rollups — not (date, developer_id) slices. */
  isDayTotal: boolean;
  /** True for developer-grain grouping sets. */
  isDeveloperGrain: boolean;
  requests: number;
  inputTokens: bigint;
  outputTokens: bigint;
  verifiedUsageCostMicros: bigint;
  estimatedApiCostMicros: bigint;
  actualSpendCostMicros: bigint;
  activeDevelopers: number;
  activeDeveloperIds: unknown;
  sourceObservedThrough: Date | null;
};

type LiveDayReadRow = Omit<LiveDayTotalRow, "isDayTotal" | "isDeveloperGrain">;

/**
 * Keep only org rollup grains from live GROUPING SETS output.
 * Kept for materialize/debug helpers — not used by dashboard reads.
 */
export function orgLiveRowsForRead(rows: LiveDayTotalRow[]): LiveDayReadRow[] {
  const out: LiveDayReadRow[] = [];
  for (const row of rows) {
    if (row.isDayTotal && !row.isDeveloperGrain) {
      const { isDayTotal: _day, isDeveloperGrain: _dev, ...rest } = row;
      out.push({ ...rest, toolName: "", developerId: "" });
      continue;
    }
    if (!row.isDayTotal && !row.isDeveloperGrain && row.toolName !== "") {
      const { isDayTotal: _day, isDeveloperGrain: _dev, ...rest } = row;
      out.push(rest);
    }
  }
  return out;
}

export function eachIsoDayInclusive(from: Date, to: Date): string[] {
  const days: string[] = [];
  const fromMs = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toMs = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let ms = fromMs; ms <= toMs; ms += 86_400_000) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Live org-day aggregates for an explicit set of dates.
 * Used by rematerialize/debug paths — not by dashboard KPI reads.
 */
export async function liveOrgDayTotalsForDates(
  orgId: string,
  dates: string[],
  options: { developerId?: string } = {},
): Promise<LiveDayTotalRow[]> {
  if (!dates.length) return [];
  const dateList = Prisma.join(dates.map((d) => Prisma.sql`${d}::date`));
  const developerFilter = options.developerId
    ? Prisma.sql`AND developer_id = ${options.developerId}`
    : Prisma.empty;

  return prisma.$queryRaw<LiveDayTotalRow[]>`
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
        AND date IN (${dateList})
        AND ${syncTrailBackedSql()}
        ${developerFilter}
    ), ranked AS (
      SELECT classified.*,
        MIN(activity_priority) FILTER (
          WHERE effective_metric_kind <> 'productivity'
            AND (requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0 OR active_seconds > 0)
        ) OVER (
          PARTITION BY date, developer_id, provider, product, tool_name, model
        ) AS best_activity_priority,
        MIN(cost_priority) FILTER (WHERE cost_micros > 0) OVER (
          PARTITION BY date, provider, tool_name, model
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
        GROUPING(COALESCE(tool_name, '')) AS is_day_total,
        CASE WHEN GROUPING(COALESCE(developer_id, '')) = 0 THEN 1 ELSE 0 END AS is_developer_grain,
        COALESCE(SUM(CASE WHEN selected_activity THEN requests ELSE 0 END), 0)::int AS requests,
        COALESCE(SUM(CASE WHEN selected_activity THEN input_tokens ELSE 0 END), 0)::bigint AS "inputTokens",
        COALESCE(SUM(CASE WHEN selected_activity THEN output_tokens ELSE 0 END), 0)::bigint AS "outputTokens",
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
        (date, COALESCE(tool_name, '')),
        (date, COALESCE(developer_id, '')),
        (date, COALESCE(tool_name, ''), COALESCE(developer_id, ''))
      )
    )
    SELECT
      date,
      tool_name_value AS "toolName",
      developer_id_value AS "developerId",
      is_day_total::int AS "isDayTotal",
      is_developer_grain::int AS "isDeveloperGrain",
      requests,
      "inputTokens",
      "outputTokens",
      "verifiedUsageCostMicros",
      "estimatedApiCostMicros",
      "actualSpendCostMicros",
      "activeDevelopers",
      "activeDeveloperIds",
      "sourceObservedThrough"
    FROM aggregates
  `;
}

export async function loadDirtyDaysInWindow(
  orgId: string,
  from: Date,
  to: Date,
  metricVersion: string = ORG_DAY_SNAPSHOT_VERSION,
): Promise<string[]> {
  const rows = await prisma.analyticsDirtyDay.findMany({
    where: {
      orgId,
      metricVersion,
      date: { gte: from, lte: to },
    },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return rows.map((row) => row.date.toISOString().slice(0, 10));
}
