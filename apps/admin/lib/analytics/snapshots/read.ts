import { prisma } from "@usejunction/db";
import type { MetricWindow } from "@/lib/analytics/contracts/time-window";
import {
  ORG_DAY_SNAPSHOT_VERSION,
  ensureOrgUsageDaySnapshots,
  snapshotEachDay,
  snapshotIsoDay,
  snapshotUtcDay,
} from "./materialize";
import { loadDirtyDaysInWindow } from "./overlay";

export type SnapshotDayTotals = {
  date: string;
  requests: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  suggestedLines: number;
  acceptedLines: number;
  addedLines: number;
  deletedLines: number;
  commits: number;
  verifiedUsageCost: number;
  estimatedApiCost: number;
  actualSpendCost: number;
  activeDevelopers: number;
  activeDeveloperIds: string[];
  dataThrough: Date | null;
};

export type SnapshotToolTotals = {
  toolName: string;
  accountKey?: string;
  requests: number;
  tokens: number;
  cost: number;
  verifiedUsageCost: number;
  estimatedApiCost: number;
  actualSpendCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  activeDevelopers: number;
};

export type SnapshotToolDay = {
  date: string;
  toolName: string;
  accountKey?: string;
  requests: number;
  verifiedUsageCost: number;
  estimatedApiCost: number;
};

export type SnapshotModelTotals = {
  toolName: string;
  accountKey?: string;
  modelName: string;
  developerId: string;
  requests: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  suggestedLines: number;
  acceptedLines: number;
  addedLines: number;
  deletedLines: number;
  commits: number;
  verifiedUsageCost: number;
  estimatedApiCost: number;
  actualSpendCost: number;
};

export type SnapshotDeveloperActivity = {
  developerId: string;
  requests: number;
  cost: number;
  verifiedUsageCost: number;
  estimatedApiCost: number;
  tools: string[];
};

function microsToDollars(value: bigint | number) {
  return Number(value) / 1_000_000;
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [];
}

type SnapshotRow = {
  date: Date;
  toolName: string;
  accountKey: string;
  developerId: string;
  modelName: string;
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

/**
 * Read-path seal for one developer's day totals: stub missing days with zeros.
 * Does not rematerialize — Sync / cron own freshness.
 */
export async function ensureDeveloperUsageDaySnapshots(
  orgId: string,
  developerId: string,
  from: Date,
  to: Date,
  options: { metricVersion?: string } = {},
): Promise<{ stubbed: number }> {
  if (!developerId) return { stubbed: 0 };
  const metricVersion = options.metricVersion ?? ORG_DAY_SNAPSHOT_VERSION;
  const fromDay = snapshotUtcDay(from);
  const toDay = snapshotUtcDay(to);

  const existing = await prisma.orgUsageDaySnapshot.findMany({
    where: {
      orgId,
      metricVersion,
      toolName: "",
      developerId,
      modelName: "",
      date: { gte: fromDay, lte: toDay },
    },
    select: { date: true },
  });
  const have = new Set(existing.map((row) => snapshotIsoDay(row.date)));
  const missing = snapshotEachDay(fromDay, toDay).filter((day) => !have.has(snapshotIsoDay(day)));
  if (!missing.length) return { stubbed: 0 };

  const now = new Date();
  await prisma.orgUsageDaySnapshot.createMany({
    data: missing.map((day) => ({
      orgId,
      date: day,
      toolName: "",
      developerId,
      modelName: "",
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
  return { stubbed: missing.length };
}

export type SnapshotReadResult = {
  dataThrough: Date | null;
  kpis: {
    modelCalls: number;
    sessions: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    suggestedLines: number;
    acceptedLines: number;
    addedLines: number;
    deletedLines: number;
    commits: number;
    verifiedUsageCost: number;
    estimatedApiCost: number;
    actualSpendCost: number;
    partialData: boolean;
  };
  trend: Array<{ date: string; modelCalls: number; cost: number }>;
  tools: SnapshotToolTotals[];
  models: SnapshotModelTotals[];
  activeDevelopers: number;
  toolDays: SnapshotToolDay[];
  dayTotals: SnapshotDayTotals[];
};

function foldSnapshotRows(
  rows: SnapshotRow[],
  options: {
    includeTools?: boolean;
    includeModels?: boolean;
    toolNames?: string[];
    partialData?: boolean;
    importingDays?: number;
  },
): SnapshotReadResult {
  const dayTotals: SnapshotDayTotals[] = [];
  const toolAcc = new Map<string, SnapshotToolTotals>();
  const modelAcc = new Map<string, SnapshotModelTotals>();
  const toolDays: SnapshotToolDay[] = [];
  const windowDeveloperIds = new Set<string>();
  let dataThrough: Date | null = null;

  for (const row of rows) {
    const date = snapshotIsoDay(row.date);
    const verified = microsToDollars(row.verifiedUsageCostMicros);
    const estimated = microsToDollars(row.estimatedApiCostMicros);
    const actual = microsToDollars(row.actualSpendCostMicros);
    if (row.sourceObservedThrough && (!dataThrough || row.sourceObservedThrough > dataThrough)) {
      dataThrough = row.sourceObservedThrough;
    }

    // Model grain (tool + model set)
    if (row.modelName !== "") {
      if (options.toolNames?.length && !options.toolNames.includes(row.toolName)) continue;
      if (options.includeModels) {
        const key = `${row.developerId}|${row.toolName}|${row.accountKey}|${row.modelName}`;
        const existing = modelAcc.get(key) ?? {
          toolName: row.toolName,
          accountKey: row.accountKey,
          modelName: row.modelName,
          developerId: row.developerId,
          requests: 0,
          sessions: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          suggestedLines: 0,
          acceptedLines: 0,
          addedLines: 0,
          deletedLines: 0,
          commits: 0,
          verifiedUsageCost: 0,
          estimatedApiCost: 0,
          actualSpendCost: 0,
        };
        existing.requests += row.requests;
        existing.sessions += row.sessions;
        existing.inputTokens += Number(row.inputTokens);
        existing.outputTokens += Number(row.outputTokens);
        existing.cacheReadTokens += Number(row.cacheReadTokens);
        existing.cacheWriteTokens += Number(row.cacheWriteTokens);
        existing.reasoningTokens += Number(row.reasoningTokens);
        existing.suggestedLines += row.suggestedLines;
        existing.acceptedLines += row.acceptedLines;
        existing.addedLines += row.addedLines;
        existing.deletedLines += row.deletedLines;
        existing.commits += row.commits;
        existing.verifiedUsageCost += verified;
        existing.estimatedApiCost += estimated;
        existing.actualSpendCost += actual;
        modelAcc.set(key, existing);
      }
      continue;
    }

    // Day total (no tool)
    if (row.toolName === "") {
      const ids = parseIds(row.activeDeveloperIds);
      for (const id of ids) windowDeveloperIds.add(id);
      dayTotals.push({
        date,
        requests: row.requests,
        sessions: row.sessions,
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        cacheReadTokens: Number(row.cacheReadTokens),
        cacheWriteTokens: Number(row.cacheWriteTokens),
        reasoningTokens: Number(row.reasoningTokens),
        suggestedLines: row.suggestedLines,
        acceptedLines: row.acceptedLines,
        addedLines: row.addedLines,
        deletedLines: row.deletedLines,
        commits: row.commits,
        verifiedUsageCost: verified,
        estimatedApiCost: estimated,
        actualSpendCost: actual,
        activeDevelopers: row.activeDevelopers,
        activeDeveloperIds: ids,
        dataThrough: row.sourceObservedThrough,
      });
      continue;
    }

    if (options.toolNames?.length && !options.toolNames.includes(row.toolName)) continue;

    toolDays.push({
      date,
      toolName: row.toolName,
      accountKey: row.accountKey,
      requests: row.requests,
      verifiedUsageCost: verified,
      estimatedApiCost: estimated,
    });

    if (options.includeTools) {
      const toolKey = `${row.toolName}|${row.accountKey}`;
      const existing = toolAcc.get(toolKey) ?? {
        toolName: row.toolName,
        accountKey: row.accountKey,
        requests: 0,
        tokens: 0,
        cost: 0,
        verifiedUsageCost: 0,
        estimatedApiCost: 0,
        actualSpendCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        activeDevelopers: 0,
      };
      const inputTokens = Number(row.inputTokens);
      const outputTokens = Number(row.outputTokens);
      existing.requests += row.requests;
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cacheReadTokens += Number(row.cacheReadTokens);
      existing.cacheWriteTokens += Number(row.cacheWriteTokens);
      existing.tokens += inputTokens + outputTokens;
      existing.verifiedUsageCost += verified;
      existing.estimatedApiCost += estimated;
      existing.actualSpendCost += actual;
      existing.cost += verified + estimated;
      existing.activeDevelopers = Math.max(existing.activeDevelopers, row.activeDevelopers);
      toolAcc.set(toolKey, existing);
    }
  }

  if (options.includeTools) {
    const toolDevIds = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.toolName === "" || row.modelName !== "") continue;
      if (options.toolNames?.length && !options.toolNames.includes(row.toolName)) continue;
      const toolKey = `${row.toolName}|${row.accountKey}`;
      const set = toolDevIds.get(toolKey) ?? new Set<string>();
      for (const id of parseIds(row.activeDeveloperIds)) set.add(id);
      toolDevIds.set(toolKey, set);
    }
    for (const [toolKey, ids] of toolDevIds) {
      const tool = toolAcc.get(toolKey);
      if (tool && ids.size > 0) tool.activeDevelopers = ids.size;
    }
  }

  const kpis = {
    modelCalls: dayTotals.reduce((sum, row) => sum + row.requests, 0),
    sessions: dayTotals.reduce((sum, row) => sum + row.sessions, 0),
    tokens: dayTotals.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0),
    inputTokens: dayTotals.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: dayTotals.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheReadTokens: dayTotals.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    cacheWriteTokens: dayTotals.reduce((sum, row) => sum + row.cacheWriteTokens, 0),
    reasoningTokens: dayTotals.reduce((sum, row) => sum + row.reasoningTokens, 0),
    suggestedLines: dayTotals.reduce((sum, row) => sum + row.suggestedLines, 0),
    acceptedLines: dayTotals.reduce((sum, row) => sum + row.acceptedLines, 0),
    addedLines: dayTotals.reduce((sum, row) => sum + row.addedLines, 0),
    deletedLines: dayTotals.reduce((sum, row) => sum + row.deletedLines, 0),
    commits: dayTotals.reduce((sum, row) => sum + row.commits, 0),
    verifiedUsageCost: dayTotals.reduce((sum, row) => sum + row.verifiedUsageCost, 0),
    estimatedApiCost: dayTotals.reduce((sum, row) => sum + row.estimatedApiCost, 0),
    actualSpendCost: dayTotals.reduce((sum, row) => sum + row.actualSpendCost, 0),
    partialData: Boolean(options.partialData) || (options.importingDays ?? 0) > 0,
  };

  return {
    dataThrough,
    kpis,
    trend: dayTotals.map((row) => ({
      date: row.date,
      modelCalls: row.requests,
      cost: row.verifiedUsageCost + row.estimatedApiCost,
    })),
    tools: options.includeTools ? [...toolAcc.values()] : [],
    models: options.includeModels ? [...modelAcc.values()] : [],
    activeDevelopers: windowDeveloperIds.size,
    toolDays,
    dayTotals,
  };
}

async function loadSnapshotRows(
  orgId: string,
  from: Date,
  to: Date,
  options: {
    developerId?: string;
    toolNames?: string[];
    includeModels?: boolean;
  },
): Promise<SnapshotRow[]> {
  const developerFilter =
    options.developerId !== undefined ? { developerId: options.developerId } : { developerId: "" };

  // When models are not needed, exclude model grains to keep payloads small.
  const modelFilter = options.includeModels ? {} : { modelName: "" };

  return prisma.orgUsageDaySnapshot.findMany({
    where: {
      orgId,
      ...developerFilter,
      ...modelFilter,
      metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      date: { gte: from, lte: to },
      ...(options.toolNames?.length
        ? {
            OR: [
              { toolName: "", modelName: "" },
              { toolName: { in: options.toolNames } },
            ],
          }
        : {}),
    },
    orderBy: [{ date: "asc" }, { toolName: "asc" }, { modelName: "asc" }],
  });
}

/**
 * Sum sealed org-day snapshots for a window (`developerId = ""` rollups only).
 * Dirty days are reported as importing/partial — never recomputed via live CTEs.
 * Default `ensure: false` so page reads never heal inline.
 */
export async function readOrgUsageFromSnapshots(
  orgId: string,
  window: MetricWindow,
  options: {
    includeTools?: boolean;
    includeModels?: boolean;
    toolNames?: string[];
    ensure?: boolean;
  } = {},
): Promise<SnapshotReadResult> {
  const from = snapshotUtcDay(window.from);
  const to = snapshotUtcDay(window.to);

  if (options.ensure === true) {
    await ensureOrgUsageDaySnapshots(orgId, from, to);
  }

  const [rows, dirtyDays] = await Promise.all([
    loadSnapshotRows(orgId, from, to, {
      developerId: "",
      toolNames: options.toolNames,
      includeModels: options.includeModels,
    }),
    loadDirtyDaysInWindow(orgId, from, to),
  ]);

  return foldSnapshotRows(rows, {
    ...options,
    partialData: dirtyDays.length > 0,
    importingDays: dirtyDays.length,
  });
}

/**
 * Sum sealed developer-day snapshots for You / member dashboards.
 * Dirty days mark partial/importing only — no live CTE overlay.
 * Default `ensure: false` so page reads never heal inline.
 */
export async function readDeveloperUsageFromSnapshots(
  orgId: string,
  developerId: string,
  window: MetricWindow,
  options: {
    includeTools?: boolean;
    includeModels?: boolean;
    toolNames?: string[];
    ensure?: boolean;
  } = {},
): Promise<SnapshotReadResult> {
  const from = snapshotUtcDay(window.from);
  const to = snapshotUtcDay(window.to);

  if (options.ensure === true) {
    await ensureOrgUsageDaySnapshots(orgId, from, to);
    await ensureDeveloperUsageDaySnapshots(orgId, developerId, from, to);
  }

  const [rows, dirtyDays] = await Promise.all([
    loadSnapshotRows(orgId, from, to, {
      developerId,
      toolNames: options.toolNames,
      includeModels: options.includeModels,
    }),
    loadDirtyDaysInWindow(orgId, from, to),
  ]);

  return foldSnapshotRows(rows, {
    ...options,
    partialData: dirtyDays.length > 0,
    importingDays: dirtyDays.length,
  });
}

/**
 * Bulk developer activity for Team roster: day totals + used tools.
 */
export async function readDeveloperActivityFromSnapshots(
  orgId: string,
  window: MetricWindow,
  options: { developerId?: string; ensure?: boolean } = {},
): Promise<SnapshotDeveloperActivity[]> {
  const from = snapshotUtcDay(window.from);
  const to = snapshotUtcDay(window.to);

  if (options.ensure === true) {
    await ensureOrgUsageDaySnapshots(orgId, from, to);
  }

  const rows = await prisma.orgUsageDaySnapshot.findMany({
    where: {
      orgId,
      metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      date: { gte: from, lte: to },
      modelName: "",
      developerId: options.developerId
        ? options.developerId
        : { not: "" },
    },
    select: {
      developerId: true,
      toolName: true,
      requests: true,
      verifiedUsageCostMicros: true,
      estimatedApiCostMicros: true,
    },
  });

  const byDev = new Map<string, SnapshotDeveloperActivity>();
  for (const row of rows) {
    if (!row.developerId) continue;
    const existing = byDev.get(row.developerId) ?? {
      developerId: row.developerId,
      requests: 0,
      cost: 0,
      verifiedUsageCost: 0,
      estimatedApiCost: 0,
      tools: [],
    };
    if (row.toolName === "") {
      const verified = microsToDollars(row.verifiedUsageCostMicros);
      const estimated = microsToDollars(row.estimatedApiCostMicros);
      existing.requests += row.requests;
      existing.verifiedUsageCost += verified;
      existing.estimatedApiCost += estimated;
      existing.cost += verified + estimated;
    } else if (row.requests > 0) {
      existing.tools.push(row.toolName);
    }
    byDev.set(row.developerId, existing);
  }

  for (const entry of byDev.values()) {
    entry.tools = [...new Set(entry.tools)];
  }

  return [...byDev.values()];
}

/**
 * Org tool rollups with verified/estimated cost (Tools page).
 */
export async function readToolActivityFromSnapshots(
  orgId: string,
  window: MetricWindow,
  options: { toolNames?: string[]; ensure?: boolean } = {},
): Promise<SnapshotToolTotals[]> {
  const result = await readOrgUsageFromSnapshots(orgId, window, {
    includeTools: true,
    toolNames: options.toolNames,
    ensure: options.ensure,
  });
  return result.tools;
}

/**
 * Developer×tool×model rows for a tool (or all tools) — Tool detail / personal models.
 */
export async function readModelActivityFromSnapshots(
  orgId: string,
  window: MetricWindow,
  options: {
    developerId?: string;
    toolNames?: string[];
    ensure?: boolean;
  } = {},
): Promise<SnapshotModelTotals[]> {
  const from = snapshotUtcDay(window.from);
  const to = snapshotUtcDay(window.to);

  if (options.ensure === true) {
    await ensureOrgUsageDaySnapshots(orgId, from, to);
  }

  const rows = await prisma.orgUsageDaySnapshot.findMany({
    where: {
      orgId,
      metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      date: { gte: from, lte: to },
      modelName: { not: "" },
      ...(options.developerId !== undefined
        ? { developerId: options.developerId }
        : {}),
      ...(options.toolNames?.length ? { toolName: { in: options.toolNames } } : {}),
    },
  });

  const folded = foldSnapshotRows(rows, { includeModels: true, toolNames: options.toolNames });
  return folded.models;
}
