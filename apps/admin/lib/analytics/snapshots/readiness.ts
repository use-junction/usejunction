import { Prisma, prisma } from "@usejunction/db";
import { ORG_DAY_SNAPSHOT_VERSION } from "./materialize";
import { syncTrailBackedSql } from "./sync-trail";

const DEFAULT_METRIC_VERSION = ORG_DAY_SNAPSHOT_VERSION;

function utcDay(date: Date | string): Date {
  if (typeof date === "string") return new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type DashboardReadiness = {
  /**
   * True when the requested window has no dirty days and no stub conflicts.
   * Dashboard KPIs read sealed snapshots only — dirty blocks readiness.
   */
  dashboardReady: boolean;
  /**
   * Full rematerialize backlog. Used for sync progress UI — do not treat
   * "Last synced" as complete while this is > 0.
   */
  dirtyDayCount: number;
  stubConflictDayCount: number;
  /** Age in seconds of the oldest dirty day; null when clean. */
  snapshotLagSeconds: number | null;
  oldestDirtyDay: string | null;
};

/**
 * Empty org-total stubs (zero metrics, no observed-through) that still have usage_daily.
 */
async function countStubConflicts(
  orgId: string,
  fromDay: Date,
  toDay: Date,
  metricVersion: string,
): Promise<number> {
  if (fromDay.getTime() > toDay.getTime()) return 0;
  const stubs = await prisma.orgUsageDaySnapshot.findMany({
    where: {
      orgId,
      metricVersion,
      toolName: "",
      developerId: "",
      date: { gte: fromDay, lte: toDay },
      sourceObservedThrough: null,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      verifiedUsageCostMicros: 0,
      estimatedApiCostMicros: 0,
      actualSpendCostMicros: 0,
    },
    select: { date: true },
  });
  if (!stubs.length) return 0;

  const days = stubs.map((row) => isoDay(row.date));
  // Same sync-trail rule as materialize, or a day with only unbacked rows would
  // read as a stub conflict forever.
  const usage = await prisma.$queryRaw<Array<{ date: Date }>>`
    SELECT DISTINCT date
    FROM usage_daily
    WHERE org_id = ${orgId}
      AND date IN (${Prisma.join(days.map((d) => Prisma.sql`${d}::date`))})
      AND ${syncTrailBackedSql()}
      AND (requests > 0 OR input_tokens > 0 OR output_tokens > 0 OR cost_micros > 0 OR sessions > 0)
  `;
  return usage.length;
}

/**
 * Freshness contract for the visible dashboard window:
 * - Upload ready = device.lastUsageSyncAt (elsewhere)
 * - Dashboard ready = sealed coverage for the window (no dirty, no stub conflicts)
 */
export async function getDashboardReadiness(
  orgId: string,
  options: { from?: Date; to?: Date; metricVersion?: string } = {},
): Promise<DashboardReadiness> {
  const metricVersion = options.metricVersion ?? DEFAULT_METRIC_VERSION;
  const toDay = utcDay(options.to ?? new Date());
  const fromDay = utcDay(options.from ?? new Date(toDay.getTime() - 89 * 86_400_000));

  const [stubConflictDayCount, pendingDirty, windowDirty] = await Promise.all([
    countStubConflicts(orgId, fromDay, toDay, metricVersion),
    prisma.analyticsDirtyDay.findMany({
      where: { orgId, metricVersion },
      orderBy: [{ createdAt: "asc" }, { date: "asc" }],
      select: { date: true, createdAt: true },
    }),
    prisma.analyticsDirtyDay.count({
      where: {
        orgId,
        metricVersion,
        date: { gte: fromDay, lte: toDay },
      },
    }),
  ]);

  const oldest = pendingDirty[0];
  const lagMs = oldest ? Math.max(0, Date.now() - oldest.createdAt.getTime()) : null;
  return {
    dashboardReady: stubConflictDayCount === 0 && windowDirty === 0,
    dirtyDayCount: pendingDirty.length,
    stubConflictDayCount,
    snapshotLagSeconds: lagMs == null ? null : Math.floor(lagMs / 1000),
    oldestDirtyDay: oldest ? isoDay(oldest.date) : null,
  };
}

/** Count remaining dirty days for an org (full backlog, not window-scoped). */
export async function countOrgDirtyDays(
  orgId: string,
  metricVersion: string = DEFAULT_METRIC_VERSION,
): Promise<number> {
  return prisma.analyticsDirtyDay.count({
    where: { orgId, metricVersion },
  });
}

export type WorkspaceSyncReadiness = Pick<
  DashboardReadiness,
  "dashboardReady" | "dirtyDayCount" | "snapshotLagSeconds"
>;

/**
 * Cheap readiness for workspace-context polling: count-only dirty backlog and
 * oldest dirty timestamp — no stub-conflict scans or full dirty-day lists.
 *
 * When `windowDays` is set, `dashboardReady` only considers dirty days in
 * [today - windowDays, yesterday] (today excluded — partial by definition and
 * rematerialize re-dirties it every pass).
 */
export async function getWorkspaceSyncReadiness(
  orgId: string,
  options:
    | string
    | {
        metricVersion?: string;
        /** When set, scope dashboardReady to the last N sealed days (excludes today). */
        windowDays?: number;
      } = {},
): Promise<WorkspaceSyncReadiness> {
  // Back-compat: previously the 2nd arg was metricVersion string.
  const opts =
    typeof options === "string"
      ? { metricVersion: options }
      : options ?? {};
  const metricVersion = opts.metricVersion ?? DEFAULT_METRIC_VERSION;
  const dirtyDayCount = await countOrgDirtyDays(orgId, metricVersion);

  let gateDirty = dirtyDayCount;
  if (typeof opts.windowDays === "number" && opts.windowDays > 0 && dirtyDayCount > 0) {
    const today = utcDay(new Date());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const fromDay = new Date(today.getTime() - opts.windowDays * 86_400_000);
    gateDirty = await prisma.analyticsDirtyDay.count({
      where: {
        orgId,
        metricVersion,
        date: { gte: fromDay, lte: yesterday },
      },
    });
  }

  if (dirtyDayCount === 0) {
    return {
      dashboardReady: true,
      dirtyDayCount: 0,
      snapshotLagSeconds: null,
    };
  }

  const oldest = await prisma.analyticsDirtyDay.findFirst({
    where: { orgId, metricVersion },
    orderBy: [{ createdAt: "asc" }, { date: "asc" }],
    select: { createdAt: true },
  });

  const lagMs = oldest ? Math.max(0, Date.now() - oldest.createdAt.getTime()) : null;
  return {
    dashboardReady: gateDirty === 0,
    dirtyDayCount,
    snapshotLagSeconds: lagMs == null ? null : Math.floor(lagMs / 1000),
  };
}
