import { prisma } from "@usejunction/db";
import { inclusiveDayCount, usageWindowDays } from "@/lib/metrics/date-range";
import type { MetricWindow } from "@/lib/analytics/contracts/time-window";
import { readDeveloperUsageFromSnapshots } from "@/lib/analytics/snapshots";
import { getWorkspaceSyncReadiness } from "@/lib/analytics/snapshots/readiness";
import { deviceHealthState } from "@/lib/devices/health";
import { orgNeedsPlanSync } from "@/lib/queries/me/local-sync-context";
import { canonicalToolKey, findCatalogTool, isCodingTool } from "@/lib/tools/catalog";
import { monthlyMicros } from "@/lib/billing/monthly";
import type { OrganizationRole } from "@/lib/workspace-context";
import { rollupPersonalToolsUsage } from "@/lib/queries/me/tools-usage-rollup";
import {
  computePersonalSeatCommitment,
  microsToDollars,
  type SubscriptionSeatRow,
} from "@/lib/billing/actual-spend";
import type { CycleView } from "@/lib/dashboard/cycle-view";
import { reportNow } from "@/lib/report-now";
import { UTC_TIMEZONE } from "@/lib/analytics/contracts/time-window";
import { resolveModelUsageCostKind } from "@/lib/usage/classify";

export interface AiCodingMetrics {
  suggestedLines: number;
  acceptedLines: number;
  addedLines: number;
  deletedLines: number;
  commits: number;
  aiPercent: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  cost: number;
  verifiedCost: number;
}

export interface ModelUsageRow {
  toolName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  cost: number;
  requests: number;
  suggestedLines: number;
  acceptedLines: number;
  source: string;
  verified: boolean;
  costKind: string | null;
  metricKind: "usage" | "productivity";
}

export interface MeOverviewData {
  developer: {
    id: string;
    name: string;
    email: string;
    role: OrganizationRole;
    organization: { name: string; slug: string };
    devices: Array<{
      id: string;
      hostname: string;
      os: string;
      architecture: string;
      agentVersion: string;
      /** 0 means the agent predates remote sync and needs an update (same rule as Team → Fleet). */
      remoteSyncProtocol: number;
      lastSeenAt: Date;
      lastUsageSyncAt: Date | null;
      lastAccountSyncAt: Date | null;
      localEndpoint: string | null;
      tools: Array<{ toolName: string; version: string | null; lastCheckedAt: Date | null }>;
      accounts: Array<{
        toolName: string;
        email: string | null;
        plan: string | null;
        authPresent: boolean;
        updatedAt: Date;
      }>;
      quotas: Array<{
        deviceId: string;
        toolName: string;
        windowType: string;
        usedPercent: number | null;
        creditsRemaining: number | null;
        resetAt: Date | null;
        source: string;
        updatedAt: Date;
      }>;
    }>;
    quotaHistory: Array<{
      deviceId: string;
      toolName: string;
      windowType: string;
      usedPercent: number;
      resetAt: Date;
      observedAt: Date;
    }>;
    vendorSeats: Array<{
      provider: string;
      product: string;
      plan: string | null;
      status: string;
      source: string;
      lastActivityAt: Date | null;
      observedAt: Date;
    }>;
    reportedTools: Array<{ toolName: string; source: string; observedAt: Date }>;
    usageWindowPreferences: Record<string, string>;
  };
  usage30d: {
    requests: number;
    sessions: number;
    inputTokens: string;
    outputTokens: string;
    cacheReadTokens: string;
    cacheWriteTokens: string;
    costMicros: string;
    /** Vendor-verified usage dollars for the selected window. */
    verifiedUsageCost: number;
    /** Modeled API-equivalent dollars when vendor cost is missing. */
    estimatedApiCost: number;
  };
  /** Personal spend KPIs aligned with the team dashboard strip. */
  kpis: {
    subscriptionCommitment: number;
    /** Purchased seats assigned to this person. */
    seats: number;
    verifiedUsageCost: number;
    estimatedApiCost: number;
    tokens: number;
  };
  observation: {
    rangeDays: number;
  };
  toolsUsage30d: Array<{
    toolName: string;
    requests: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
    verifiedUsageCost: number;
    estimatedApiCost: number;
  }>;
  /** Active seat assignments — used to resolve billing cycle windows on plan cards. */
  planSeats: Array<{
    toolName: string;
    /** Canonical tool key for links and matching usage. */
    toolKey: string;
    planName: string;
    billingCadence: string;
    billingCycleAnchorDate: string | null;
    billingCycleDays: number | null;
    /** Full-cycle seat dollars for this assignment (seatCount × cycle seat price). */
    cycleSeatCost: number;
    /** cycleSeatCost normalised to a month, matching the Cost page. */
    monthlySeatCost: number;
  }>;
  aiCoding30d: AiCodingMetrics;
  modelUsage30d: ModelUsageRow[];
  sync: {
    lastSeenAt: string | null;
    lastUsageSyncAt: string | null;
    lastAccountSyncAt: string | null;
    hasLocalEndpoint: boolean;
    needsPlanSync: boolean;
    dashboardReady: boolean;
    dirtyDayCount: number;
    snapshotLagSeconds: number | null;
    staleDeviceCount: number;
    recoveryDevices: Array<{
      id: string;
      hostname: string;
      os: string;
      architecture: string;
      lastSeenAt: string;
      state: "repair_required";
      remoteSyncProtocol: number;
      owner: { id: string; name: string; email: string };
      isCurrentUser: boolean;
    }>;
  };
}


const overviewInclude = {
  organization: { select: { name: true, slug: true } },
  devices: {
    where: { decommissionedAt: null },
    orderBy: { lastSeenAt: "desc" as const },
    include: {
      toolInstallations: {
        where: { detected: true },
        select: { toolName: true, version: true, lastCheckedAt: true },
      },
      toolAccounts: {
        select: { toolName: true, email: true, plan: true, authPresent: true, updatedAt: true },
      },
      quotaSnapshots: {
        select: {
          toolName: true,
          windowType: true,
          usedPercent: true,
          creditsRemaining: true,
          resetAt: true,
          source: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" as const },
      },
    },
  },
  seatAssignments: {
    select: {
      provider: true,
      product: true,
      plan: true,
      status: true,
      source: true,
      lastActivityAt: true,
      observedAt: true,
    },
  },
  toolClaims: { where: { enabled: true }, select: { toolName: true, source: true, observedAt: true } },
};

type OverviewDeveloper = NonNullable<
  Awaited<ReturnType<typeof prisma.developer.findFirst<{ include: typeof overviewInclude }>>>
>;

export async function getMeOverview(
  orgId: string,
  userId: string,
  role: OrganizationRole,
  options: {
    reportWindow?: MetricWindow;
    includeOrgPlanSync?: boolean;
    cycleView?: CycleView;
  } = {},
): Promise<MeOverviewData> {
  const developer = await prisma.developer.findFirst({
    where: { orgId, authUserId: userId },
    include: overviewInclude,
  });

  if (!developer) {
    throw new Error("developer profile required");
  }

  return buildMeOverview(orgId, developer, role, options.reportWindow, {
    includeOrgPlanSync: options.includeOrgPlanSync,
    cycleView: options.cycleView,
  });
}

/** Admin view of any teammate by developer id. */
export async function getDeveloperOverview(
  orgId: string,
  developerId: string,
  options: {
    reportWindow?: MetricWindow;
    cycleView?: CycleView;
    includeOrgPlanSync?: boolean;
  } = {},
): Promise<MeOverviewData | null> {
  const developer = await prisma.developer.findFirst({
    where: { orgId, id: developerId },
    include: overviewInclude,
  });
  if (!developer) return null;
  return buildMeOverview(orgId, developer, developer.role as OrganizationRole, options.reportWindow, {
    cycleView: options.cycleView,
    includeOrgPlanSync: options.includeOrgPlanSync,
  });
}

async function buildMeOverview(
  orgId: string,
  developer: OverviewDeveloper,
  role: OrganizationRole,
  reportWindow?: MetricWindow,
  options: { includeOrgPlanSync?: boolean; cycleView?: CycleView } = {},
): Promise<MeOverviewData> {
  const usage30d = reportWindow ?? usageWindowDays(30);
  const cycleView = options.cycleView ?? "last_30_days";
  const snapshotWindow: MetricWindow = {
    from: usage30d.from,
    to: usage30d.to,
    timezone: UTC_TIMEZONE,
    grain: "day",
  };
  // All usage KPIs, productivity, and model breakdowns come from sealed snapshots.
  const [snapshotUsage, planAssignments, quotaObservations] = await Promise.all([
    readDeveloperUsageFromSnapshots(orgId, developer.id, snapshotWindow, {
      includeTools: true,
      includeModels: true,
      ensure: false,
    }),
    prisma.developerPlanAssignment.findMany({
      where: {
        orgId,
        developerId: developer.id,
        active: true,
        seatStatus: "active",
      },
      select: {
        id: true,
        toolName: true,
        planName: true,
        billingCadence: true,
        billingCycleAnchorDate: true,
        billingCycleDays: true,
        cycleSeatMicros: true,
        seatCount: true,
        startDate: true,
        endDate: true,
        template: { select: { toolKey: true, usageWindowPreference: true } },
      },
    }),
    prisma.quotaObservation.findMany({
      where: { orgId, deviceId: { in: developer.devices.map((device) => device.id) }, observedAt: { gte: new Date(reportNow().getTime() - 90 * 24 * 60 * 60 * 1000) } },
      select: { deviceId: true, toolName: true, windowType: true, usedPercent: true, resetAt: true, observedAt: true },
      orderBy: { observedAt: "asc" },
    }),
  ]);

  const verifiedUsageCost = snapshotUsage.kpis.verifiedUsageCost;
  const estimatedApiCost = snapshotUsage.kpis.estimatedApiCost;
  const tokens = snapshotUsage.kpis.tokens;
  const inputTokens = snapshotUsage.kpis.inputTokens;
  const outputTokens = snapshotUsage.kpis.outputTokens;
  const rangeDays = inclusiveDayCount(usage30d.from, usage30d.to);
  const seatRows: SubscriptionSeatRow[] = planAssignments
    .filter((row) => isCodingTool(row.toolName))
    .map((row) => ({
      id: row.id,
      toolName: row.toolName,
      billingCadence: row.billingCadence,
      billingCycleAnchorDate: row.billingCycleAnchorDate,
      billingCycleDays: row.billingCycleDays,
      cycleSeatMicros: row.cycleSeatMicros,
      seatCount: row.seatCount,
      startDate: row.startDate,
      endDate: row.endDate,
    }));
  const subscriptionCommitment = computePersonalSeatCommitment({
    assignments: seatRows,
    view: cycleView,
    from: usage30d.from,
    to: usage30d.to,
  });
  const seatCount = seatRows.reduce((sum, row) => sum + Math.max(0, row.seatCount), 0);

  const detectedToolNames = developer.devices.flatMap((device) =>
    device.toolInstallations.map((tool) => tool.toolName),
  );
  const toolsUsage30d = rollupPersonalToolsUsage(
    snapshotUsage.tools.map((row) => ({
      toolName: row.toolName || "unknown",
      requests: row.requests,
      tokens: row.tokens,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      cost: row.cost,
      verifiedUsageCost: row.verifiedUsageCost,
      estimatedApiCost: row.estimatedApiCost,
    })),
    detectedToolNames,
  );
  const planSeats = planAssignments.map((row) => ({
    toolName: row.toolName,
    toolKey: canonicalToolKey(row.template?.toolKey ?? row.toolName),
    planName: row.planName,
    billingCadence: row.billingCadence,
    billingCycleAnchorDate: row.billingCycleAnchorDate
      ? row.billingCycleAnchorDate.toISOString().slice(0, 10)
      : null,
    billingCycleDays: row.billingCycleDays ?? null,
    cycleSeatCost: microsToDollars(row.cycleSeatMicros * BigInt(Math.max(0, row.seatCount))),
    monthlySeatCost: microsToDollars(
      monthlyMicros(row.cycleSeatMicros * BigInt(Math.max(0, row.seatCount)), row.billingCadence, row.billingCycleDays ?? null),
    ),
  }));

  const modelUsageRows: ModelUsageRow[] = snapshotUsage.models.flatMap((row) => {
    const cost = row.verifiedUsageCost + row.estimatedApiCost;
    const source = row.verifiedUsageCost > 0 ? "vendor_verified" : "device_observed";
    const storedCostKind =
      row.verifiedUsageCost > 0 ? "verified_usage" : cost > 0 ? "estimated_api" : null;
    const costKind = resolveModelUsageCostKind({ source, cost, storedCostKind });
    const productivity =
      row.suggestedLines > 0 || row.acceptedLines > 0 || row.commits > 0;
    const usage =
      row.requests > 0 || row.inputTokens > 0 || row.outputTokens > 0 || cost > 0;
    const common = {
      toolName: row.toolName || "unknown",
      model: row.modelName || "unknown",
      source,
    };
    const output: ModelUsageRow[] = [];
    if (usage) {
      output.push({
        ...common,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        reasoningTokens: row.reasoningTokens,
        cost,
        requests: row.requests,
        suggestedLines: 0,
        acceptedLines: 0,
        verified: costKind === "verified_usage",
        costKind,
        metricKind: "usage",
      });
    }
    if (productivity) {
      output.push({
        ...common,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        requests: 0,
        suggestedLines: row.suggestedLines,
        acceptedLines: row.acceptedLines,
        verified: false,
        costKind: null,
        metricKind: "productivity",
      });
    }
    return output;
  });

  modelUsageRows.sort(
    (a, b) =>
      b.requests - a.requests ||
      b.cost - a.cost ||
      b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
      a.toolName.localeCompare(b.toolName) ||
      a.model.localeCompare(b.model),
  );

  const aiCoding30d: AiCodingMetrics = {
    suggestedLines: snapshotUsage.kpis.suggestedLines,
    acceptedLines: snapshotUsage.kpis.acceptedLines,
    addedLines: snapshotUsage.kpis.addedLines,
    deletedLines: snapshotUsage.kpis.deletedLines,
    commits: snapshotUsage.kpis.commits,
    aiPercent: null,
    inputTokens,
    outputTokens,
    cacheReadTokens: snapshotUsage.kpis.cacheReadTokens,
    cacheWriteTokens: snapshotUsage.kpis.cacheWriteTokens,
    reasoningTokens: snapshotUsage.kpis.reasoningTokens,
    cost: verifiedUsageCost + estimatedApiCost,
    verifiedCost: verifiedUsageCost,
  };

  const primaryDevice = developer.devices[0] ?? null;
  let latestUsageSync: Date | null = null;
  let latestAccountSync: Date | null = null;
  for (const device of developer.devices) {
    if (device.lastUsageSyncAt && (!latestUsageSync || device.lastUsageSyncAt > latestUsageSync)) {
      latestUsageSync = device.lastUsageSyncAt;
    }
    if (device.lastAccountSyncAt && (!latestAccountSync || device.lastAccountSyncAt > latestAccountSync)) {
      latestAccountSync = device.lastAccountSyncAt;
    }
  }

  const allInstallations = developer.devices.flatMap((device) => device.toolInstallations);
  const allAccounts = developer.devices.flatMap((device) => device.toolAccounts);
  const personalNeedsPlanSync = allInstallations.some((installation) => {
    const toolKey = canonicalToolKey(installation.toolName);
    if (!findCatalogTool(toolKey)) return false;
    const account = allAccounts.find((row) => canonicalToolKey(row.toolName) === toolKey);
    return !account?.plan?.trim();
  });
  const needsPlanSync =
    personalNeedsPlanSync ||
    (options.includeOrgPlanSync === false ? false : await orgNeedsPlanSync(orgId));
  const readiness = await getWorkspaceSyncReadiness(orgId);
  const recoveryDevices = developer.devices
    .filter((device) => deviceHealthState(device.lastSeenAt) === "repair_required")
    .map((device) => ({
      id: device.id,
      hostname: device.hostname,
      os: device.os,
      architecture: device.architecture,
      lastSeenAt: device.lastSeenAt.toISOString(),
      state: "repair_required" as const,
      remoteSyncProtocol: device.remoteSyncProtocol,
      owner: { id: developer.id, name: developer.name, email: developer.email },
      isCurrentUser: true,
    }));

  return {
    developer: {
      id: developer.id,
      name: developer.name,
      email: developer.email,
      role,
      organization: developer.organization,
      devices: developer.devices.map((device) => ({
        id: device.id,
        hostname: device.hostname,
        os: device.os,
        architecture: device.architecture,
        agentVersion: device.agentVersion,
        remoteSyncProtocol: device.remoteSyncProtocol ?? 0,
        lastSeenAt: device.lastSeenAt,
        lastUsageSyncAt: device.lastUsageSyncAt ?? null,
        lastAccountSyncAt: device.lastAccountSyncAt ?? null,
        localEndpoint: device.localEndpoint ?? null,
        tools: device.toolInstallations,
        accounts: device.toolAccounts,
        quotas: device.quotaSnapshots.map((quota) => ({ ...quota, deviceId: device.id })),
      })),
      quotaHistory: quotaObservations,
      usageWindowPreferences: Object.fromEntries(
        planAssignments
          .filter((row) => row.template?.toolKey)
          .map((row) => [row.template!.toolKey!, row.template!.usageWindowPreference]),
      ),
      vendorSeats: developer.seatAssignments,
      reportedTools: developer.toolClaims,
    },
    usage30d: {
      requests: snapshotUsage.kpis.modelCalls,
      sessions: snapshotUsage.kpis.sessions,
      inputTokens: String(inputTokens),
      outputTokens: String(outputTokens),
      cacheReadTokens: String(snapshotUsage.kpis.cacheReadTokens),
      cacheWriteTokens: String(snapshotUsage.kpis.cacheWriteTokens),
      costMicros: String(Math.round((verifiedUsageCost + estimatedApiCost) * 1_000_000)),
      verifiedUsageCost,
      estimatedApiCost,
    },
    kpis: {
      subscriptionCommitment,
      seats: seatCount,
      verifiedUsageCost,
      estimatedApiCost,
      tokens,
    },
    observation: {
      rangeDays,
    },
    toolsUsage30d,
    planSeats,
    aiCoding30d,
    modelUsage30d: modelUsageRows,
    sync: {
      lastSeenAt: primaryDevice?.lastSeenAt?.toISOString() ?? null,
      lastUsageSyncAt: latestUsageSync?.toISOString() ?? null,
      lastAccountSyncAt: latestAccountSync?.toISOString() ?? null,
      hasLocalEndpoint: developer.devices.some((d) => Boolean(d.localEndpoint)),
      needsPlanSync,
      dashboardReady: readiness.dashboardReady,
      dirtyDayCount: readiness.dirtyDayCount,
      snapshotLagSeconds: readiness.snapshotLagSeconds,
      staleDeviceCount: developer.devices.filter((device) => deviceHealthState(device.lastSeenAt) !== "online").length,
      recoveryDevices,
    },
  };
}
