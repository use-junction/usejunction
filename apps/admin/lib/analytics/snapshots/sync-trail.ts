import { Prisma, prisma } from "@usejunction/db";

/**
 * Device-local sources (canonical value plus legacy aliases). Keep in step with
 * SOURCE_ALIASES in lib/metrics/source-priority.ts and the source lists in the
 * snapshot SQL.
 */
export const DEVICE_OBSERVED_SOURCES = [
  "device_observed",
  "local_scan",
  "cursor_local",
  "antigravity_local",
  "antigravity_usage",
  "opencode_local",
  "opencode_usage",
  "cursor_plan_percent",
] as const;

/**
 * The legacy /api/ingest/local-usage route was removed on 2026-07-25. Since then
 * every device row is uploaded inside a sync run, which records the window of
 * dates the device declared. Rows observed before this cutoff came through the
 * legacy route and have no sync run, so they keep counting.
 */
export const SYNC_TRAIL_REQUIRED_SINCE = "2026-07-26 00:00:00";

/**
 * WHERE fragment for queries that read `FROM usage_daily`: true when the row may
 * count toward dashboards. A device row needs a sync run from the same device
 * whose window covers the row's date; anything else was written outside the
 * sync pipeline (a script, a leaked seed, a direct database write).
 *
 * Every snapshot reader of usage_daily must use this. If materialize skips a row
 * that the corrupt-day or zero-seal checks still count, those days stay dirty
 * forever. Built per call so importing this module never touches Prisma, which
 * many tests mock.
 */
export function syncTrailBackedSql(): Prisma.Sql {
  return Prisma.sql`(
  usage_daily.source NOT IN (${Prisma.join([...DEVICE_OBSERVED_SOURCES])})
  OR usage_daily.observed_at < ${SYNC_TRAIL_REQUIRED_SINCE}::timestamp
  -- Privacy erasure deletes the device and its sync runs but keeps the spend.
  OR (usage_daily.device_id IS NULL AND usage_daily.metadata->>'erasedAt' IS NOT NULL)
  OR EXISTS (
    SELECT 1 FROM sync_runs
    WHERE sync_runs.device_id = usage_daily.device_id
      AND sync_runs.window_to >= usage_daily.date
      AND sync_runs.window_from <= usage_daily.date
  )
)`;
}

export type UnbackedDeviceRows = { rows: number; costMicros: bigint };

/** Count device rows in the range that the sync-trail rule leaves out of snapshots. */
export async function countUnbackedDeviceRows(
  orgId: string,
  fromKey: string,
  toKey: string,
): Promise<UnbackedDeviceRows> {
  const [row] = await prisma.$queryRaw<Array<{ rows: bigint; cost_micros: bigint | null }>>`
    SELECT COUNT(*)::bigint AS rows, SUM(cost_micros)::bigint AS cost_micros
    FROM usage_daily
    WHERE org_id = ${orgId}
      AND date >= ${fromKey}::date
      AND date <= ${toKey}::date
      AND NOT ${syncTrailBackedSql()}
  `;
  return { rows: Number(row?.rows ?? 0), costMicros: row?.cost_micros ?? BigInt(0) };
}
