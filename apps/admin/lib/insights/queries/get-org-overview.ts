import { prisma, Prisma } from "@usejunction/db";
import type { MetricWindow } from "@/lib/analytics/contracts/time-window";
import { UTC_TIMEZONE } from "@/lib/analytics/contracts/time-window";
import {
  readDeveloperActivityFromSnapshots,
  readOrgUsageFromSnapshots,
  type SnapshotToolDay,
} from "@/lib/analytics/snapshots";
import {
  filterCycleCodingSubscriptions,
  microsToDollars,
  observationCoverage,
} from "@/lib/billing/actual-spend";
import { addCycles, cycleToJson, resolveBillingCycleOffset, type BillingCycle } from "@/lib/billing/cycles";
import {
  DAY_MS,
  inclusiveDayCount,
  usageExclusiveEnd,
  usageInclusiveEnd,
  usageWindowDays,
  utcDateOnly,
} from "@/lib/metrics/date-range";
import {
  assertInsightRoles,
  makeInsightEnvelope,
  type InsightContext,
  type InsightEnvelope,
} from "@/lib/insights/contracts/envelope";
import type { OrgOverviewV1, OverviewInput } from "@/lib/insights/contracts/overview.v1";
import { buildAttentionItems } from "@/lib/insights/policies/attention";
import { getPlanUsage } from "@/lib/insights/queries/get-plan-usage";
import { rollupSubscriptionCyclesByTool, enrichSubscriptionCyclesWithUtilization, filterActiveSubscriptionCycles } from "@/lib/insights/queries/rollup-subscription-cycles";
import { seatBillingCadenceForTool } from "@/lib/tools/detected-cycle";
import { mergeUsageBackedCycleSources } from "@/lib/insights/queries/usage-backed-cycle-sources";
import { readDeviceCoverage } from "@/lib/insights/readers/devices";
import { getDashboardConfigHealth } from "@/lib/queries/dashboard/config-health";
import { reportWindowForCycleOffset } from "@/lib/dashboard/cycle-view";
import { canonicalToolKey, isCodingTool, toolDisplayName, toolUsageNames } from "@/lib/tools/catalog";
import { listSubscriptions } from "@/lib/tools/subscriptions";
import { fillOverviewTrend } from "@/lib/insights/policies/overview-trend";
import { rolesFor } from "@/lib/rbac/permissions";

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Match snapshot tool names to subscription usage aliases (casing / agy / etc.). */
function toolDayMatchesUsageNames(usageNames: string[], toolName: string): boolean {
  const dayKey = canonicalToolKey(toolName);
  if (!dayKey) return false;
  return usageNames.some((name) => canonicalToolKey(name) === dayKey);
}

/** Report-window request totals keyed by canonical tool — floors cycle modelCalls. */
function requestsByCanonicalTool(toolDays: Array<{ toolName: string; requests: number }>) {
  const totals = new Map<string, number>();
  for (const day of toolDays) {
    if (day.requests <= 0) continue;
    const key = canonicalToolKey(day.toolName);
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + day.requests);
  }
  return totals;
}

function toMetricWindow(from: Date, to: Date): MetricWindow {
  return { from, to, timezone: UTC_TIMEZONE, grain: "day" };
}

/** Cached — avoids Prisma P2021 log spam when extraction_contract migration isn't applied yet. */
let providerCapabilitiesTableExists: boolean | null = null;

async function hasProviderCapabilitiesTable() {
  if (providerCapabilitiesTableExists !== null) return providerCapabilitiesTableExists;
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'provider_connection_capabilities'
    ) AS "exists"
  `);
  providerCapabilitiesTableExists = Boolean(rows[0]?.exists);
  return providerCapabilitiesTableExists;
}

async function loadProviderConnections(orgId: string) {
  if (await hasProviderCapabilitiesTable()) {
    return prisma.providerConnection.findMany({
      where: { orgId },
      select: {
        provider: true,
        product: true,
        status: true,
        lastSyncedAt: true,
        capabilities: {
          select: { capability: true, status: true, dataThrough: true },
          orderBy: { capability: "asc" },
        },
      },
    });
  }
  const rows = await prisma.providerConnection.findMany({
    where: { orgId },
    select: { provider: true, product: true, status: true, lastSyncedAt: true },
  });
  return rows.map((row) => ({ ...row, capabilities: [] }));
}

async function readProviderAnalytics(orgId: string, from: Date, to: Date): Promise<OrgOverviewV1["providerCards"]> {
  const [usage, seats, connections] = await Promise.all([
    prisma.$queryRaw<Array<{ provider: string; product: string; requests: bigint; spendMicros: bigint; activeDevelopers: number }>>(Prisma.sql`
      SELECT provider, product,
        COALESCE(SUM(requests), 0)::bigint AS requests,
        COALESCE(SUM(cost_micros), 0)::bigint AS "spendMicros",
        COUNT(DISTINCT developer_id)::int AS "activeDevelopers"
      FROM usage_daily
      WHERE org_id = ${orgId} AND date >= ${from}::date AND date <= ${to}::date
      GROUP BY provider, product
    `),
    prisma.$queryRaw<Array<{ provider: string; product: string; activeSeats: number; matchedSeats: number }>>(Prisma.sql`
      SELECT provider, product,
        COUNT(*) FILTER (WHERE status = 'active')::int AS "activeSeats",
        COUNT(*) FILTER (WHERE status = 'active' AND developer_id IS NOT NULL)::int AS "matchedSeats"
      FROM seat_assignments
      WHERE org_id = ${orgId}
      GROUP BY provider, product
    `),
    loadProviderConnections(orgId),
  ]);

  const keys = new Set([...usage, ...seats, ...connections].map((row) => `${row.provider}:${row.product}`));
  return [...keys].sort().map((key) => {
    const [provider, product] = key.split(":");
    const usageRow = usage.find((row) => row.provider === provider && row.product === product);
    const seatRow = seats.find((row) => row.provider === provider && row.product === product);
    const connection = connections.find((row) => row.provider === provider && row.product === product);
    const activeSeats = seatRow?.activeSeats ?? 0;
    const activeDevelopers = usageRow?.activeDevelopers ?? 0;
    const unusedSeats = Math.max(0, activeSeats - activeDevelopers);
    const capabilities = (connection?.capabilities ?? []).map((capability) => ({
      name: capability.capability,
      status: capability.status,
      dataThrough: capability.dataThrough?.toISOString() ?? null,
    }));
    const actions: string[] = [];
    if (unusedSeats > 0) actions.push(`${unusedSeats} active seats have no activity in this window`);
    if ((seatRow?.activeSeats ?? 0) > 0 && (seatRow?.matchedSeats ?? 0) < (seatRow?.activeSeats ?? 0)) actions.push("Review unmatched provider identities");
    if (connection?.status === "degraded" || connection?.status === "error") actions.push("Repair provider connection");
    if (capabilities.some((capability) => capability.status !== "available")) actions.push("Review unavailable provider capabilities");
    return {
      provider,
      product,
      status: connection?.status ?? "unconnected",
      activeSeats,
      matchedSeats: seatRow?.matchedSeats ?? 0,
      activeDevelopers,
      unusedSeats,
      requests: Number(usageRow?.requests ?? 0),
      spend: Number(usageRow?.spendMicros ?? 0) / 1_000_000,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      dataThrough: capabilities.reduce<string | null>((latest, capability) => capability.dataThrough && (!latest || capability.dataThrough > latest) ? capability.dataThrough : latest, null),
      capabilities,
      actions,
    };
  });
}

async function readOverviewUsage(
  orgId: string,
  window: MetricWindow,
  includeTools: boolean,
  filters: { toolNames?: string[]; ensure?: boolean; includeModels?: boolean } = {},
) {
  const snapshot = await readOrgUsageFromSnapshots(orgId, window, {
    includeTools,
    includeModels: filters.includeModels,
    toolNames: filters.toolNames,
    ensure: filters.ensure,
  });
  const models = snapshot.models
    .filter((row) => row.developerId === "")
    .map((row) => {
      const cost = row.verifiedUsageCost + row.estimatedApiCost;
      return {
        toolName: row.toolName || "unknown",
        model: row.modelName || "unknown",
        requests: row.requests,
        tokens: row.inputTokens + row.outputTokens,
        cost,
      };
    })
    .filter((row) => row.requests > 0 || row.tokens > 0 || row.cost > 0)
    .sort(
      (a, b) =>
        b.requests - a.requests ||
        b.tokens - a.tokens ||
        b.cost - a.cost ||
        a.model.localeCompare(b.model),
    );
  return {
    dataThrough: snapshot.dataThrough,
    kpis: snapshot.kpis,
    trend: snapshot.trend,
    tools: snapshot.tools.map((tool) => ({
      toolName: tool.toolName || "unknown",
      modelCalls: tool.requests,
      cost: tool.cost,
      activeDevelopers: tool.activeDevelopers,
    })),
    models,
    activeDevelopers: snapshot.activeDevelopers,
    toolDays: snapshot.toolDays,
  };
}

type CycleView = OverviewInput["cycleView"];

type SubscriptionCycleSource = {
  id: string;
  name: string;
  toolName: string;
  toolKey: string | null;
  usageToolNames: string[];
  billingCadence: string;
  billingCycleAnchorDate: Date | null;
  billingCycleDays: number | null;
  cycleSeatMicros: bigint;
  seatCount: number;
  startDate: Date;
  endDate: Date | null;
};

type SubscriptionSlice = {
  id: string;
  subscriptionId: string;
  name: string;
  toolName: string;
  toolKey: string | null;
  usageToolNames: string[];
  billingCadence: string;
  cycle: BillingCycle;
  windowFrom: Date;
  windowTo: Date;
  allocationRatio: number;
  seatCount: number;
  spendMicros: bigint;
};

function overlapDays(fromInclusive: Date, toExclusive: Date, otherFromInclusive: Date, otherToExclusive: Date) {
  const start = new Date(Math.max(fromInclusive.getTime(), otherFromInclusive.getTime()));
  const end = new Date(Math.min(toExclusive.getTime(), otherToExclusive.getTime()));
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

function prorateMicros(value: bigint, ratio: number) {
  return BigInt(Math.round(Number(value) * ratio));
}

function sliceWindow(cycle: BillingCycle, rangeStart: Date, rangeEndExclusive: Date) {
  const from = new Date(Math.max(cycle.cycleStart.getTime(), rangeStart.getTime()));
  const toExclusive = new Date(Math.min(cycle.cycleEnd.getTime(), rangeEndExclusive.getTime()));
  const days = overlapDays(cycle.cycleStart, cycle.cycleEnd, from, toExclusive);
  return { from, toExclusive, days };
}

function usageToolKey(toolNames: string[]) {
  return [...new Set(toolNames)].sort().join("\u0001");
}

function buildSubscriptionSlices(input: {
  subscriptions: SubscriptionCycleSource[];
  view: CycleView;
  now: Date;
  last30: { from: Date; toExclusive: Date };
}) {
  const slices: SubscriptionSlice[] = [];
  for (const subscription of input.subscriptions) {
    const billingCadence = seatBillingCadenceForTool(
      subscription.toolKey ?? subscription.toolName,
      subscription.billingCadence,
    );
    const cycleSource = { ...subscription, billingCadence };
    const baseCycle =
      input.view === "previous_cycles"
        ? resolveBillingCycleOffset(cycleSource, input.now, -1)
        : resolveBillingCycleOffset(cycleSource, input.now, 0);

    const cycles =
      input.view !== "last_30_days"
        ? [baseCycle]
        : (() => {
            const rows: BillingCycle[] = [];
            let cursor = resolveBillingCycleOffset(cycleSource, input.last30.from, 0);
            while (cursor.cycleStart < input.last30.toExclusive) {
              if (overlapDays(cursor.cycleStart, cursor.cycleEnd, input.last30.from, input.last30.toExclusive) > 0) {
                rows.push(cursor);
              }
              const nextStart = cursor.cycleEnd;
              const nextEnd = addCycles(nextStart, billingCadence, 1, subscription.billingCycleDays);
              cursor = {
                cycleStart: nextStart,
                cycleEnd: nextEnd,
                nextRenewalDate: nextEnd,
                elapsedPercent: 1,
                remainingDays: 0,
                totalDays: Math.max(1, Math.round((nextEnd.getTime() - nextStart.getTime()) / DAY_MS)),
              };
            }
            return rows;
          })();

    for (const cycle of cycles) {
      const window =
        input.view === "last_30_days"
          ? sliceWindow(cycle, input.last30.from, input.last30.toExclusive)
          : { from: cycle.cycleStart, toExclusive: cycle.cycleEnd, days: cycle.totalDays };
      if (window.days <= 0) continue;
      const allocationRatio = input.view === "last_30_days" ? window.days / cycle.totalDays : 1;
      const fullSpend = subscription.cycleSeatMicros * BigInt(subscription.seatCount);
      const spendMicros = input.view === "last_30_days" ? prorateMicros(fullSpend, allocationRatio) : fullSpend;
      slices.push({
        id: `${subscription.id}:${cycle.cycleStart.toISOString().slice(0, 10)}`,
        subscriptionId: subscription.id,
        name: subscription.name,
        toolName: subscription.toolName,
        toolKey: subscription.toolKey,
        usageToolNames: subscription.usageToolNames,
        billingCadence,
        cycle,
        windowFrom: window.from,
        windowTo: new Date(window.toExclusive.getTime() - DAY_MS),
        allocationRatio,
        seatCount: subscription.seatCount,
        spendMicros,
      });
    }
  }
  return slices;
}

async function readAllocatedCycleUsage(
  slices: SubscriptionSlice[],
  view: CycleView,
  toolDays: SnapshotToolDay[],
) {
  const usageBySlice = new Map<string, { modelCalls: number; verifiedUsageCost: number; estimatedApiCost: number }>();
  for (const slice of slices) {
    usageBySlice.set(slice.id, { modelCalls: 0, verifiedUsageCost: 0, estimatedApiCost: 0 });
  }

  if (view !== "last_30_days") {
    const groups = new Map<string, { slices: SubscriptionSlice[]; totalSeats: number; toolNames: string[]; from: Date; to: Date }>();
    for (const slice of slices) {
      const key = `${usageToolKey(slice.usageToolNames)}:${isoDay(slice.windowFrom)}:${isoDay(slice.windowTo)}`;
      const group = groups.get(key) ?? {
        slices: [],
        totalSeats: 0,
        toolNames: slice.usageToolNames,
        from: slice.windowFrom,
        to: slice.windowTo,
      };
      group.slices.push(slice);
      group.totalSeats += Math.max(1, slice.seatCount);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const fromKey = isoDay(group.from);
      const toKey = isoDay(group.to);
      let modelCalls = 0;
      let verifiedUsageCost = 0;
      let estimatedApiCost = 0;
      for (const day of toolDays) {
        if (!toolDayMatchesUsageNames(group.toolNames, day.toolName)) continue;
        if (day.date < fromKey || day.date > toKey) continue;
        modelCalls += day.requests;
        verifiedUsageCost += day.verifiedUsageCost;
        estimatedApiCost += day.estimatedApiCost;
      }
      for (const slice of group.slices) {
        const share = Math.max(1, slice.seatCount) / Math.max(1, group.totalSeats);
        usageBySlice.set(slice.id, {
          modelCalls: modelCalls * share,
          verifiedUsageCost: verifiedUsageCost * share,
          estimatedApiCost: estimatedApiCost * share,
        });
      }
    }
    return usageBySlice;
  }

  const groups = new Map<string, { toolNames: string[]; slices: SubscriptionSlice[] }>();
  for (const slice of slices) {
    const key = usageToolKey(slice.usageToolNames);
    const group = groups.get(key) ?? { toolNames: slice.usageToolNames, slices: [] };
    group.slices.push(slice);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const toolSlices = group.slices;
    const daily = new Map<string, { modelCalls: number; verifiedUsageCost: number; estimatedApiCost: number }>();
    for (const day of toolDays) {
      if (!toolDayMatchesUsageNames(group.toolNames, day.toolName)) continue;
      const existing = daily.get(day.date) ?? { modelCalls: 0, verifiedUsageCost: 0, estimatedApiCost: 0 };
      existing.modelCalls += day.requests;
      existing.verifiedUsageCost += day.verifiedUsageCost;
      existing.estimatedApiCost += day.estimatedApiCost;
      daily.set(day.date, existing);
    }

    for (const [day, usage] of daily) {
      const date = new Date(`${day}T00:00:00.000Z`);
      const active = toolSlices.filter((slice) => slice.windowFrom <= date && date <= slice.windowTo);
      const totalSeats = active.reduce((sum, slice) => sum + Math.max(1, slice.seatCount), 0);
      for (const slice of active) {
        const share = Math.max(1, slice.seatCount) / Math.max(1, totalSeats);
        const current = usageBySlice.get(slice.id) ?? { modelCalls: 0, verifiedUsageCost: 0, estimatedApiCost: 0 };
        current.modelCalls += usage.modelCalls * share;
        current.verifiedUsageCost += usage.verifiedUsageCost * share;
        current.estimatedApiCost += usage.estimatedApiCost * share;
        usageBySlice.set(slice.id, current);
      }
    }
  }
  return usageBySlice;
}

export type OrgOverviewShellData = {
  coverage: {
    developers: number;
    devices: number;
    configuredTools: number;
    trackedTools: number;
  };
  health: Awaited<ReturnType<typeof getDashboardConfigHealth>>;
  detectedInstallations: Array<{ toolName: string; count: number }>;
};

function mapSubscriptionCycleSources(
  subscriptionRows: Awaited<ReturnType<typeof listSubscriptions>>,
): SubscriptionCycleSource[] {
  return filterCycleCodingSubscriptions(subscriptionRows, isCodingTool).map((plan) => ({
    id: plan.id,
    name: plan.name,
    toolKey: plan.toolKey,
    toolName: plan.toolName,
    usageToolNames: toolUsageNames(plan.toolKey ?? plan.toolName),
    billingCadence: plan.billingCadence,
    billingCycleAnchorDate: plan.billingCycleAnchorDate,
    billingCycleDays: plan.billingCycleDays,
    cycleSeatMicros: plan.cycleSeatMicros,
    seatCount: plan.seatCapacity,
    startDate: plan.createdAt,
    endDate: null as Date | null,
  }));
}

/** Static org metadata — no usage windows or snapshot reads. */
export async function getOrgOverviewShell(orgId: string): Promise<OrgOverviewShellData> {
  const [totalDevelopers, deviceCoverage, configuredTools, trackedTools, health, detectedInstallations] =
    await Promise.all([
      prisma.developer.count({ where: { orgId } }),
      readDeviceCoverage(orgId),
      prisma.toolInstallation.count({ where: { orgId, detected: true, configured: true } }),
      prisma.toolInstallation.count({ where: { orgId, detected: true } }),
      getDashboardConfigHealth(orgId),
      prisma.toolInstallation.groupBy({
        by: ["toolName"],
        where: { orgId, detected: true },
        _count: { id: true },
      }),
    ]);

  return {
    coverage: {
      developers: totalDevelopers,
      devices: deviceCoverage.devices,
      configuredTools,
      trackedTools,
    },
    health,
    detectedInstallations: detectedInstallations.map((row) => ({
      toolName: row.toolName,
      count: row._count.id,
    })),
  };
}

export type OrgOverviewMetricsData = Omit<OrgOverviewV1, "coverage" | "hasActivity"> & {
  coverage: Pick<OrgOverviewV1["coverage"], "activeDevelopers">;
  /** Usage-only activity signal; client merges shell.detectedInstallations for empty-state. */
  hasUsageActivity: boolean;
};

function mergeOverviewShell(
  shell: OrgOverviewShellData,
  metrics: OrgOverviewMetricsData,
): OrgOverviewV1 {
  return {
    ...metrics,
    hasActivity:
      metrics.hasUsageActivity ||
      metrics.tools.some((tool) => tool.requests > 0) ||
      shell.detectedInstallations.length > 0,
    coverage: {
      ...shell.coverage,
      activeDevelopers: metrics.coverage.activeDevelopers,
    },
  };
}

export async function getOrgOverviewMetrics(
  context: InsightContext,
  input: OverviewInput,
  options: {
    subscriptions: Awaited<ReturnType<typeof listSubscriptions>>;
    shell?: OrgOverviewShellData;
  },
): Promise<InsightEnvelope<OrgOverviewV1 | OrgOverviewMetricsData>> {
  assertInsightRoles(context, rolesFor("org_overview"));

  const orgId = context.orgId;
  const cycleView: CycleView = input.cycleView;
  const { shell } = options;
  const subscriptionRows = options.subscriptions;
  const subscriptions = mapSubscriptionCycleSources(subscriptionRows);

  let reportWindow: MetricWindow;
  let previousWindow: MetricWindow;
  if (input.cycleView === "last_30_days") {
    reportWindow = input.reportWindow;
    previousWindow = input.previousWindow;
  } else {
    const offset = cycleView === "previous_cycles" ? -1 : 0;
    reportWindow = reportWindowForCycleOffset(subscriptions, offset, context.now);
    previousWindow = reportWindowForCycleOffset(subscriptions, offset - 1, context.now);
  }

  const range = inclusiveDayCount(reportWindow.from, reportWindow.to);
  const dates = {
    from: utcDateOnly(reportWindow.from),
    to: usageInclusiveEnd(reportWindow.to),
    toExclusive: usageExclusiveEnd(reportWindow.to),
    previousFrom: utcDateOnly(previousWindow.from),
    previousTo: usageInclusiveEnd(previousWindow.to),
    previousToExclusive: usageExclusiveEnd(previousWindow.to),
  };
  const providerCards = await readProviderAnalytics(orgId, dates.from, dates.to);

  // Page reads never ensure/rematerialize — sync commit + cron own freshness.
  const [currentUsage, previousUsage, failures, planUsage] = await Promise.all([
    readOverviewUsage(orgId, reportWindow, true, { ensure: false, includeModels: true }),
    readOverviewUsage(orgId, previousWindow, false, { ensure: false }),
    prisma.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        developer: string | null;
        toolName: string | null;
        model: string | null;
        latencyMs: number;
        status: string;
      }>
    >`
      SELECT r.id, r.created_at AS "createdAt", d.name AS developer,
             r.tool_name AS "toolName", r.model, r.latency_ms AS "latencyMs", r.status
      FROM request_metadata r
      LEFT JOIN users d ON d.id = r.user_id
      WHERE r.org_id = ${orgId} AND r.created_at >= ${dates.from} AND r.created_at < ${dates.toExclusive}
        AND r.status <> 'success'
      ORDER BY r.created_at DESC LIMIT 5
    `,
    getPlanUsage(context, { reportWindow }, { subscriptions: subscriptionRows }),
  ]);

  const previousKpis = previousUsage.kpis;
  const usageKpis = currentUsage.kpis;
  const currentTrend = currentUsage.trend;
  const previousTrend = previousUsage.trend;
  const toolRows = currentUsage.tools;

  // Surface coding tools with traffic even without a billing_plan_template
  // (free / detected / $0 plans included). Real subscriptions win when present.
  const cycleSubscriptions = mergeUsageBackedCycleSources(
    subscriptions,
    currentUsage.toolDays,
    context.now,
  );

  const subscriptionSlices = buildSubscriptionSlices({
    subscriptions: cycleSubscriptions,
    view: cycleView,
    now: context.now,
    last30: { from: dates.from, toExclusive: dates.toExclusive },
  });

  // Allocation may need tool-day rows outside the report window (billing cycle views).
  let allocationToolDays = currentUsage.toolDays;
  if (subscriptionSlices.length > 0) {
    const allocFrom = new Date(Math.min(
      ...subscriptionSlices.map((slice) => slice.windowFrom.getTime()),
      reportWindow.from.getTime(),
    ));
    const allocTo = new Date(Math.max(
      ...subscriptionSlices.map((slice) => slice.windowTo.getTime()),
      reportWindow.to.getTime(),
    ));
    if (allocFrom.getTime() < reportWindow.from.getTime() || allocTo.getTime() > reportWindow.to.getTime()) {
      const expanded = await readOverviewUsage(orgId, toMetricWindow(allocFrom, allocTo), true, { ensure: false });
      allocationToolDays = expanded.toolDays;
    }
  }

  const allocatedUsage = await readAllocatedCycleUsage(subscriptionSlices, cycleView, allocationToolDays);
  // Floor modelCalls with report-window traffic so a seat whose own billing
  // anchor excludes recent usage (common for newly detected Ultra seats) still
  // surfaces on Current cycles when Tools already shows requests.
  const reportWindowRequests = requestsByCanonicalTool(currentUsage.toolDays);
  const cycleCommitment = subscriptionSlices.reduce(
    (sum, slice) => sum + microsToDollars(slice.spendMicros),
    0,
  );
  const seatsBySubscription = new Map<string, number>();
  for (const slice of subscriptionSlices) {
    seatsBySubscription.set(slice.subscriptionId, Math.max(0, slice.seatCount));
  }
  const seatCount = Array.from(seatsBySubscription.values()).reduce((sum, n) => sum + n, 0);

  const daysWithActivity = currentTrend.filter((row) => row.modelCalls > 0).length;
  const peopleActivity = await readDeveloperActivityFromSnapshots(orgId, reportWindow, { ensure: false });
  const activityDeveloperIds = [...new Set(peopleActivity.map((row) => row.developerId).filter(Boolean))];
  // Soft-removed members retain historical usage rows, but should not appear in the live
  // "Spend by person" ranking (they are already hidden from /team).
  const developerNames = activityDeveloperIds.length
    ? await prisma.developer.findMany({
        where: { orgId, id: { in: activityDeveloperIds }, removedAt: null },
        select: { id: true, name: true, email: true, teamId: true },
      })
    : [];
  const teamRecords = await prisma.team.findMany({ where: { orgId }, select: { id: true, name: true, color: true } });
  const nameById = new Map(
    developerNames.map((row) => [row.id, row.name?.trim() || row.email || "Unknown"]),
  );
  const people = peopleActivity
    .filter((row) => nameById.has(row.developerId))
    .map((row) => ({
      id: row.developerId,
      name: nameById.get(row.developerId) ?? "Unknown",
      requests: row.requests,
      cost: row.cost,
    }))
    .filter((row) => row.cost > 0 || row.requests > 0)
    .sort((a, b) => b.cost - a.cost || b.requests - a.requests)
    .slice(0, 8);

  // Every active person counts toward their team, not just the top eight shown above.
  const teamOf = new Map(developerNames.map((row) => [row.id, row.teamId]));
  const teamTotals = new Map<string, { id: string; name: string; color: string | null; people: number; requests: number; cost: number }>();
  if (teamRecords.length) {
    for (const team of teamRecords) teamTotals.set(team.id, { ...team, people: 0, requests: 0, cost: 0 });
    for (const row of peopleActivity) {
      if (!teamOf.has(row.developerId) || (row.cost <= 0 && row.requests <= 0)) continue;
      const key = teamOf.get(row.developerId) ?? "none";
      const entry = teamTotals.get(key) ?? { id: "none", name: "No team", color: null, people: 0, requests: 0, cost: 0 };
      entry.people += 1;
      entry.requests += row.requests;
      entry.cost += row.cost;
      teamTotals.set(key, entry);
    }
  }
  const teams = [...teamTotals.values()].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));

  const firstActivityDate = currentTrend.find((row) => row.modelCalls > 0)?.date ?? null;
  const observation = observationCoverage({
    rangeDays: range,
    daysWithActivity,
    firstActivityDate,
    from: dates.from,
  });
  const mergedTools = toolRows.map((tool) => ({
    name: tool.toolName,
    requests: tool.modelCalls,
    cost: tool.cost,
    activeDevelopers: tool.activeDevelopers,
  }));
  if (shell) {
    for (const installation of shell.detectedInstallations) {
      if (!mergedTools.some((tool) => tool.name === installation.toolName)) {
        mergedTools.push({ name: installation.toolName, requests: 0, cost: 0, activeDevelopers: 0 });
      }
    }
  }

  const planVerdicts = planUsage.data.subscriptions.map((row) => ({
    id: row.planTemplateId,
    name: `${toolDisplayName(row.toolName)} ${row.planName}`,
    verdict: row.verdict,
  }));
  const attention = buildAttentionItems({
    healthIssues: shell?.health.issues ?? [],
    planVerdicts,
  });

  const hasUsageActivity =
    usageKpis.modelCalls > 0 ||
    usageKpis.tokens > 0 ||
    mergedTools.some((tool) => tool.requests > 0);

  const metrics: OrgOverviewMetricsData = {
    range,
    cycleView,
    period: {
      from: dates.from.toISOString(),
      to: dates.to.toISOString(),
      previousFrom: dates.previousFrom.toISOString(),
      previousTo: dates.previousTo.toISOString(),
    },
    hasUsageActivity,
    partialData: Boolean(usageKpis.partialData || previousKpis.partialData),
    observation,
    kpis: {
      actualSpend: {
        value: cycleCommitment,
        previousValue: 0,
        deltaPercent: null,
        basis: subscriptionSlices.length ? ("subscriptions" as const) : ("none" as const),
      },
      seats: {
        value: seatCount,
        previousValue: 0,
        deltaPercent: null,
      },
      verifiedUsageCost: {
        value: usageKpis.verifiedUsageCost,
        previousValue: previousKpis.verifiedUsageCost,
        deltaPercent: null,
      },
      estimatedApiCost: {
        value: usageKpis.estimatedApiCost,
        previousValue: previousKpis.estimatedApiCost,
        deltaPercent: null,
      },
      tokens: {
        value: usageKpis.tokens,
        previousValue: previousKpis.tokens,
        deltaPercent: null,
      },
    },
    subscriptionCycles: filterActiveSubscriptionCycles(
      enrichSubscriptionCyclesWithUtilization(
        rollupSubscriptionCyclesByTool(
          subscriptionSlices.map((slice) => {
            const usage = allocatedUsage.get(slice.id);
            return {
              id: slice.id,
              subscriptionId: slice.subscriptionId,
              name: slice.name,
              toolName: slice.toolName,
              toolKey: slice.toolKey,
              cycleSpend: microsToDollars(slice.spendMicros),
              verifiedUsageCost: usage?.verifiedUsageCost ?? 0,
              estimatedApiCost: usage?.estimatedApiCost ?? 0,
              modelCalls: usage?.modelCalls ?? 0,
              windowFrom: isoDay(slice.windowFrom),
              windowTo: isoDay(slice.windowTo),
              billingCycle: cycleToJson(slice.cycle),
              billingCadence: slice.billingCadence,
            };
          }),
        ).map((row) => {
          const key = canonicalToolKey(row.toolKey ?? row.toolName);
          const reportCalls = reportWindowRequests.get(key) ?? 0;
          return reportCalls > row.modelCalls ? { ...row, modelCalls: reportCalls } : row;
        }),
        planUsage.data.subscriptions,
        { includeLiveQuota: cycleView !== "previous_cycles" },
      ),
    ),
    renewals: rollupSubscriptionCyclesByTool(
      subscriptionSlices.map((slice) => ({
        id: slice.id,
        subscriptionId: slice.subscriptionId,
        name: slice.name,
        toolName: slice.toolName,
        toolKey: slice.toolKey,
        cycleSpend: microsToDollars(slice.spendMicros),
        verifiedUsageCost: 0,
        estimatedApiCost: 0,
        modelCalls: 0,
        windowFrom: isoDay(slice.windowFrom),
        windowTo: isoDay(slice.windowTo),
        billingCycle: cycleToJson(slice.cycle),
        billingCadence: slice.billingCadence,
      })),
    )
      .map((row) => ({
        id: row.id,
        toolName: row.toolName,
        toolKey: row.toolKey,
        planNames: row.planNames,
        planCount: row.planCount,
        nextRenewalDate: row.billingCycle.nextRenewalDate,
        remainingDays: row.billingCycle.remainingDays,
        elapsedPercent: row.billingCycle.elapsedPercent,
      }))
      .sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate)),
    trend: fillOverviewTrend(range, dates.from, currentTrend, previousTrend, {
      align: cycleView === "last_30_days" ? "calendar" : "index",
      previousFrom: dates.previousFrom,
    }),
    attention,
    tools: mergedTools,
    models: currentUsage.models,
    providerCards,
    people,
    teams,
    coverage: {
      activeDevelopers: currentUsage.activeDevelopers,
    },
    failures: failures.map((failure) => ({
      id: failure.id,
      createdAt: new Date(failure.createdAt).toISOString(),
      developer: failure.developer ?? "Unknown developer",
      tool: failure.toolName ?? "Unknown tool",
      model: failure.model ?? "Unknown model",
      latencyMs: Number(failure.latencyMs),
      status: failure.status,
    })),
  };

  const data = shell ? mergeOverviewShell(shell, metrics) : metrics;

  return makeInsightEnvelope({
    context,
    kind: "overview",
    window: reportWindow,
    dataThrough: currentUsage.dataThrough,
    data,
  });
}

export async function getOrgOverview(
  context: InsightContext,
  input: OverviewInput,
): Promise<InsightEnvelope<OrgOverviewV1>> {
  const orgId = context.orgId;
  const [subscriptionRows, shell] = await Promise.all([
    listSubscriptions(orgId),
    getOrgOverviewShell(orgId),
  ]);
  const envelope = await getOrgOverviewMetrics(context, input, { subscriptions: subscriptionRows, shell });
  return envelope as InsightEnvelope<OrgOverviewV1>;
}

export function overviewInputFromRange(
  range: number,
  now: Date = new Date(),
): OverviewInput {
  const days = Math.max(1, Math.min(366, Math.round(range)));
  const dates = usageWindowDays(days, now);
  return {
    cycleView: "last_30_days",
    reportWindow: toMetricWindow(dates.from, dates.to),
    previousWindow: toMetricWindow(dates.previousFrom, dates.previousTo),
  };
}

export function overviewInputFromBounds(
  from: Date | string,
  to: Date | string,
): OverviewInput {
  const start = utcDateOnly(typeof from === "string" ? new Date(`${from}T00:00:00Z`) : from);
  const end = usageInclusiveEnd(typeof to === "string" ? new Date(`${to}T00:00:00Z`) : to);
  const days = inclusiveDayCount(start, end);
  const previousTo = new Date(start.getTime() - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * DAY_MS);
  return {
    cycleView: "last_30_days",
    reportWindow: toMetricWindow(start, end),
    previousWindow: toMetricWindow(previousFrom, previousTo),
  };
}
