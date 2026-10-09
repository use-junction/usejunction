import { prisma } from "@usejunction/db";
import {
  verdictHint,
  verdictLabel,
  type PlanVerdictCode,
} from "@/lib/billing/plan-utilization-policy";
import { readQuotas } from "@/lib/insights/readers/quotas";
import { buildMemberPlanBoard } from "@/lib/quotas/plan-board";
import { attachQuotaHistory } from "@/lib/quotas/history";
import { mapQuotaSnapshots } from "@/lib/quotas/plan-utilization-policy";
import type { QuotaPaceCode } from "@/lib/quotas/pace";
import {
  addLocalDays,
  localDateString,
  normalizeTimeZone,
  weekRangeEndingOnOrBefore,
} from "@/lib/timezone";
import {
  getWowWeekStrip,
  wowStripToSeries,
  type WowWeekStripV1,
} from "@/lib/reports/wow-week-strip";
import { readCanonicalReportUsage } from "@/lib/reports/canonical-usage";
import {
  isReportDeltaComparable,
  maybeCaptureDailyReportUsageSnapshot,
  readDailyReportUsageSnapshot,
} from "@/lib/reports/send-time-snapshot";
import { attachCyclePlanPercentToTools } from "@/lib/reports/day-plan-usage";

/**
 * Agent ingest stores `usageDaily.date` as the local calendar YYYY-MM-DD
 * (UTC midnight of that calendar day). Never spill into adjacent days —
 * that reattributes yesterday as "today" when today's key is still empty.
 */
export function usageDateKeysForLocalDates(localDates: string[]): Date[] {
  const unique = new Map<string, Date>();
  for (const localDate of localDates) {
    const date = dateOnlyUtc(new Date(`${localDate}T00:00:00.000Z`));
    unique.set(date.toISOString(), date);
  }
  return [...unique.values()];
}

export type DailyReportKind = "personal" | "org";
export type DailyReportPeriod = "day" | "week";
export type { WowWeekStripV1 };

export type DailyReportSeriesPoint = {
  label: string;
  requests: number;
  tokens: number;
  cost: number;
};

/** Chart series metric — tokens preferred so the curve reads as activity, not a rising bill. */
export type ReportChartMetric = "tokens" | "cost" | "requests";

export type DailyReportToolRow = {
  toolName: string;
  displayName: string;
  requests: number;
  tokens: number;
  cost: number;
  /** Share of period spend, 0–100. */
  sharePercent: number;
  /** Share of period tokens, 0–100. */
  tokenSharePercent: number;
  /**
   * Billing-cycle plan used % for this tool (same signal as dashboard “Your plans”).
   * Null when the tool has no live quota reading.
   */
  planUsedPercent?: number | null;
  /** Pace-aware plan status for this tool (Near limit / Within allowance / …). */
  planStatusLabel?: string | null;
  /**
   * Projected date the cycle allowance runs out at current burn.
   * Shown especially when the tool is not already near limit.
   */
  planExhaustDateLabel?: string | null;
};

export type DailyReportPlanTool = {
  toolName: string;
  displayName: string;
  usedPercent: number | null;
  statusLabel: string;
  withinAllowance: boolean | null;
  /** Projected exhaustion date label, e.g. "Aug 20". */
  exhaustDateLabel?: string | null;
};

export type DailyReportPlanStatus = {
  /** Avg primary-window utilization across tools with signal, 0–100+. */
  usedPercent: number | null;
  /** Plan allowance status: Within allowance / Near limit / Over quota / … */
  statusLabel: string;
  /** true = within included allowance, false = near limit or over, null = unknown/stale. */
  withinAllowance: boolean | null;
  hint: string | null;
  tools: DailyReportPlanTool[];
};

export type DailyReportPayload = {
  kind: DailyReportKind;
  /** day = personal/today; week = team weekly rollup */
  period: DailyReportPeriod;
  localDate: string;
  /** Inclusive Mon–Sun bounds when period is week (`localDate` is the Sunday end). */
  weekStart?: string;
  weekEnd?: string;
  timeZone: string;
  title: string;
  subtitle: string;
  kpis: {
    requests: number;
    tokens: number;
    cost: number;
    tools: number;
    requestsDeltaPct: number | null;
    tokensDeltaPct: number | null;
    costDeltaPct: number | null;
    /** @deprecated Prefer `plan.usedPercent` — kept for API compat. */
    planUsedPercent: number | null;
    /**
     * Accepted / suggested lines from productivity ingest (0–100).
     * Closest proxy we have for “productive effectivity.”
     */
    acceptancePercent: number | null;
  };
  /** Live provider quota + plan-allowance verdict (primary windows only). */
  plan: DailyReportPlanStatus | null;
  series: DailyReportSeriesPoint[];
  /** Mon–Sun intensity strip with week-over-week deltas (preferred chart). */
  wowStrip: WowWeekStripV1 | null;
  topTools: DailyReportToolRow[];
  membersActive?: number;
};

/** True when the report window recorded no AI usage at all — we never email these. */
export function isEmptyReport(report: Pick<DailyReportPayload, "kpis">): boolean {
  const { requests, tokens, cost } = report.kpis;
  return requests <= 0 && tokens <= 0 && cost <= 0;
}

function localDatesInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return dates;
}

function dateOnlyUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

/** Day-over-day delta vs yesterday's send-time baseline: positive when today is higher. */
export function priorDayDeltaPct(prior: number, current: number): number | null {
  return pctDelta(current, prior);
}

async function readAcceptancePercent(input: {
  orgId: string;
  developerId?: string | null;
  dates: Date[];
}): Promise<number | null> {
  if (input.dates.length === 0) return null;
  const rows = await prisma.usageDaily.findMany({
    where: {
      orgId: input.orgId,
      date: { in: input.dates },
      metricKind: "productivity",
      ...(input.developerId ? { developerId: input.developerId } : {}),
    },
    select: { suggestedLines: true, acceptedLines: true },
  });
  let suggested = 0;
  let accepted = 0;
  for (const row of rows) {
    suggested += Number(row.suggestedLines);
    accepted += Number(row.acceptedLines);
  }
  if (suggested <= 0) return null;
  return (accepted / suggested) * 100;
}

const VERDICT_RANK: Record<PlanVerdictCode, number> = {
  LIMIT_EXCEEDED: 5,
  NEAR_LIMIT: 4,
  DATA_STALE: 3,
  UNKNOWN: 2,
  LIGHT_USE: 1,
  HEALTHY: 0,
};

/** Map dashboard pace codes to the same plan verdicts the UI uses. */
function paceToPlanVerdictCode(code: QuotaPaceCode, usedPercent: number | null): PlanVerdictCode {
  if (code === "ALREADY_EXCEEDED" || (usedPercent != null && usedPercent >= 100)) {
    return "LIMIT_EXCEEDED";
  }
  if (code === "EXCESS") return "NEAR_LIMIT";
  if (code === "ON_TRACK") return "HEALTHY";
  if (code === "UNDER") return "LIGHT_USE";
  if (code === "STABLE" && usedPercent != null) {
    if (usedPercent >= 90) return "NEAR_LIMIT";
    if (usedPercent <= 25) return "LIGHT_USE";
    return "HEALTHY";
  }
  return "UNKNOWN";
}

/** Fleet-style status: HEALTHY and LIGHT_USE both count as within allowance. */
export function reportPlanStatusLabel(code: PlanVerdictCode): {
  statusLabel: string;
  withinAllowance: boolean | null;
} {
  switch (code) {
    case "LIGHT_USE":
      return { statusLabel: verdictLabel(code), withinAllowance: true };
    case "HEALTHY":
      // Match dashboard fleet badge copy for on-pace plans.
      return { statusLabel: "Within allowance", withinAllowance: true };
    case "NEAR_LIMIT":
      return { statusLabel: verdictLabel(code), withinAllowance: false };
    case "LIMIT_EXCEEDED":
      return { statusLabel: verdictLabel(code), withinAllowance: false };
    case "DATA_STALE":
      return { statusLabel: verdictLabel(code), withinAllowance: null };
    default:
      return { statusLabel: verdictLabel(code), withinAllowance: null };
  }
}

function formatExhaustDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Plan utilization — same board + pace projection as dashboard “Your plans”.
 */
async function readPlanStatus(input: {
  orgId: string;
  developerId?: string | null;
  now?: Date;
}): Promise<DailyReportPlanStatus | null> {
  const now = input.now ?? new Date();
  const quotaRows = await readQuotas(input.orgId, {
    developerId: input.developerId ?? undefined,
  });
  if (quotaRows.length === 0) return null;
  const mappedQuotaRows = mapQuotaSnapshots(
    quotaRows.map((row) => ({
      toolName: row.toolName,
      windowType: row.windowType,
      usedPercent: row.usedPercent,
      creditsRemaining: row.creditsRemaining,
      resetAt: row.resetAt,
      source: row.source,
      updatedAt: row.updatedAt,
      developerId: row.developerId,
      deviceId: row.deviceId,
    })),
    now,
  );
  const quotaRowsWithHistory = await attachQuotaHistory(input.orgId, mappedQuotaRows, {
    developerId: input.developerId ?? undefined,
    now,
  });

  const cards = buildMemberPlanBoard({
    snapshots: quotaRows.map((row) => ({
      toolName: row.toolName,
      windowType: row.windowType,
      usedPercent: row.usedPercent,
      creditsRemaining: row.creditsRemaining,
      resetAt: row.resetAt,
      source: row.source,
      updatedAt: row.updatedAt,
      developerId: row.developerId,
      deviceId: row.deviceId,
    })),
    quotaHistory: quotaRowsWithHistory.flatMap((row) =>
      (row.history ?? []).map((sample) => ({
        deviceId: row.deviceId ?? "",
        toolName: row.observationToolName,
        windowType: row.windowType,
        usedPercent: sample.usedPercent,
        resetAt: sample.resetAt,
        observedAt: sample.observedAt,
      })),
    ),
    now,
  });
  if (cards.length === 0) return null;

  const tools: DailyReportPlanTool[] = cards.slice(0, 6).map((card) => {
    const usedPercent = card.pace.usedPercent;
    const code = paceToPlanVerdictCode(card.pace.code, usedPercent);
    const { statusLabel, withinAllowance } = reportPlanStatusLabel(code);
    return {
      toolName: card.toolKey,
      displayName: card.toolLabel,
      usedPercent,
      statusLabel,
      withinAllowance,
      exhaustDateLabel: formatExhaustDateLabel(card.pace.exhaustAt),
    };
  });

  const withSignal = tools.filter((t) => t.usedPercent != null);
  const usedPercent =
    withSignal.length > 0
      ? withSignal.reduce((sum, t) => sum + (t.usedPercent ?? 0), 0) / withSignal.length
      : null;

  let worstCode: PlanVerdictCode = "UNKNOWN";
  for (const tool of tools) {
    const code = paceToPlanVerdictCode(
      cards.find((c) => c.toolKey === tool.toolName)?.pace.code ?? "UNKNOWN",
      tool.usedPercent,
    );
    if (VERDICT_RANK[code] > VERDICT_RANK[worstCode]) worstCode = code;
  }

  const nearLimitCount = tools.filter((t) => t.statusLabel === "Near limit").length;
  const overCount = tools.filter((t) => t.statusLabel === "Over quota").length;
  let statusLabel: string;
  let withinAllowance: boolean | null;
  if (overCount > 0) {
    statusLabel = overCount === tools.filter((t) => t.usedPercent != null).length
      ? "Over quota"
      : `${overCount} over quota`;
    withinAllowance = false;
  } else if (nearLimitCount > 0) {
    statusLabel = nearLimitCount === 1 ? "1 near limit" : `${nearLimitCount} near limit`;
    withinAllowance = false;
  } else if (withSignal.length > 0 && withSignal.every((t) => t.withinAllowance === true)) {
    statusLabel = "Within allowance";
    withinAllowance = true;
  } else {
    ({ statusLabel, withinAllowance } = reportPlanStatusLabel(worstCode));
  }

  // Prefer near-limit exhaustion; otherwise earliest projected run-out for within-pace tools.
  const excessExhaust = cards.find((c) => c.pace.code === "EXCESS")?.pace.exhaustAt ?? null;
  const withinExhaust = cards
    .filter((c) => c.pace.exhaustAt && (c.pace.code === "ON_TRACK" || c.pace.code === "UNDER"))
    .map((c) => c.pace.exhaustAt!)
    .sort()[0] ?? null;
  const expectedEndDateLabel = formatExhaustDateLabel(excessExhaust ?? withinExhaust);

  return {
    usedPercent,
    statusLabel,
    withinAllowance,
    hint: verdictHint(worstCode, { expectedEndDateLabel }),
    tools,
  };
}

async function getWeeklyOrgReportPayload(input: {
  orgId: string;
  timeZone: string;
  localDate: string;
}): Promise<DailyReportPayload> {
  const { start, end } = weekRangeEndingOnOrBefore(input.localDate);
  const prevEnd = addLocalDays(start, -1);
  const prevStart = addLocalDays(prevEnd, -6);
  const weekDates = usageDateKeysForLocalDates(localDatesInclusive(start, end));

  const [week, previous, wowStrip, org, plan, acceptancePercent] = await Promise.all([
    readCanonicalReportUsage({
      orgId: input.orgId,
      fromLocalDate: start,
      toLocalDate: end,
    }),
    readCanonicalReportUsage({
      orgId: input.orgId,
      fromLocalDate: prevStart,
      toLocalDate: prevEnd,
    }),
    getWowWeekStrip({
      orgId: input.orgId,
      localDate: end,
      timeZone: input.timeZone,
      weekStart: start,
      weekEnd: end,
      todayPartial: false,
    }),
    prisma.organization.findUnique({
      where: { id: input.orgId },
      select: { name: true },
    }),
    readPlanStatus({ orgId: input.orgId }),
    readAcceptancePercent({ orgId: input.orgId, dates: weekDates }),
  ]);

  const series = wowStripToSeries(wowStrip);

  return {
    kind: "org",
    period: "week",
    localDate: end,
    weekStart: start,
    weekEnd: end,
    timeZone: input.timeZone,
    title: "Team week.",
    subtitle: `${org?.name ?? "Team"} · ${start} – ${end} · ${input.timeZone}`,
    kpis: {
      requests: week.requests,
      tokens: week.tokens,
      cost: week.cost,
      tools: week.tools,
      requestsDeltaPct: pctDelta(week.requests, previous.requests),
      tokensDeltaPct: pctDelta(week.tokens, previous.tokens),
      costDeltaPct: pctDelta(week.cost, previous.cost),
      planUsedPercent: plan?.usedPercent ?? null,
      acceptancePercent,
    },
    plan,
    series,
    wowStrip,
    topTools: week.topTools,
    membersActive: week.activeDevelopers,
  };
}

export async function getDailyReportPayload(input: {
  orgId: string;
  kind: DailyReportKind;
  developerId?: string | null;
  timeZone?: string | null;
  localDate?: string | null;
  now?: Date;
  /** Team/org emails and deep links use week; personal stays day. */
  period?: DailyReportPeriod;
}): Promise<DailyReportPayload> {
  const now = input.now ?? new Date();
  const timeZone = normalizeTimeZone(input.timeZone);
  const localDate = input.localDate?.trim() || localDateString(now, timeZone);

  // Team weekly rollup (Mon–Sun ending on/before localDate).
  if (input.kind === "org" && input.period === "week") {
    return getWeeklyOrgReportPayload({ orgId: input.orgId, timeZone, localDate });
  }

  const previousDate = addLocalDays(localDate, -1);
  const developerId = input.kind === "personal" ? input.developerId ?? null : null;
  const todayDates = usageDateKeysForLocalDates([localDate]);
  const deltaComparable = isReportDeltaComparable({ localDate, timeZone, now });

  const [today, priorSnapshot, org, plan, acceptancePercent] = await Promise.all([
    readCanonicalReportUsage({
      orgId: input.orgId,
      developerId,
      fromLocalDate: localDate,
      toLocalDate: localDate,
    }),
    readDailyReportUsageSnapshot({
      orgId: input.orgId,
      developerId,
      localDate: previousDate,
    }),
    prisma.organization.findUnique({
      where: { id: input.orgId },
      select: { name: true },
    }),
    readPlanStatus({ orgId: input.orgId, developerId, now }),
    readAcceptancePercent({ orgId: input.orgId, developerId, dates: todayDates }),
  ]);

  const todayPriorOverride = priorSnapshot
    ? { tokens: priorSnapshot.tokens, cost: priorSnapshot.cost, requests: priorSnapshot.requests }
    : null;
  const wowStrip = await getWowWeekStrip({
    orgId: input.orgId,
    developerId,
    localDate,
    timeZone,
    todayPartial: true,
    todayPriorOverride,
  });

  await maybeCaptureDailyReportUsageSnapshot({
    orgId: input.orgId,
    developerId,
    localDate,
    timeZone,
    totals: { tokens: today.tokens, cost: today.cost, requests: today.requests },
    now,
  });

  const requestsDeltaPct =
    deltaComparable && priorSnapshot
      ? priorDayDeltaPct(priorSnapshot.requests, today.requests)
      : null;
  const tokensDeltaPct =
    deltaComparable && priorSnapshot
      ? priorDayDeltaPct(priorSnapshot.tokens, today.tokens)
      : null;
  const costDeltaPct =
    deltaComparable && priorSnapshot
      ? priorDayDeltaPct(priorSnapshot.cost, today.cost)
      : null;

  // Prefer WOW week strip for chart series — avoids fake hourly dumps from daily totals.
  const series = wowStripToSeries(wowStrip);
  const topTools = attachCyclePlanPercentToTools({
    tools: today.topTools,
    planTools: plan?.tools ?? [],
  });

  return {
    kind: input.kind,
    period: "day",
    localDate,
    timeZone,
    title: input.kind === "personal" ? "Your day." : "Team day.",
    subtitle:
      input.kind === "personal"
        ? `${localDate} · ${timeZone}`
        : `${org?.name ?? "Team"} · ${localDate} · ${timeZone}`,
    kpis: {
      requests: today.requests,
      tokens: today.tokens,
      cost: today.cost,
      tools: today.tools,
      requestsDeltaPct,
      tokensDeltaPct,
      costDeltaPct,
      planUsedPercent: plan?.usedPercent ?? null,
      acceptancePercent,
    },
    plan,
    series,
    wowStrip,
    topTools,
    membersActive: input.kind === "org" ? today.activeDevelopers : undefined,
  };
}
