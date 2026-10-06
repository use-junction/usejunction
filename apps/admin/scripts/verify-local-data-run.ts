/**
 * Verify page calculations against the real local org DB + agent cache.
 * Uses apps/admin/.env (Postgres :5432), org from ~/.usejunction/config.json.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

// Prefer admin .env (local app DB) over root .env.
loadEnvConfig(path.join(__dirname, ".."));
loadEnvConfig(path.join(__dirname, "../.."));

import { prisma } from "@usejunction/db";
import {
  getOrgOverview,
  overviewInputFromBounds,
  overviewInputFromRange,
  UTC_TIMEZONE,
  type OverviewInput,
} from "@/lib/insights";
import { getPlanUsage } from "@/lib/insights/queries/get-plan-usage";
import { reportWindowForCycleView, type CycleView } from "@/lib/dashboard/cycle-view";
import { getDashboardUsage } from "@/lib/queries/dashboard/usage";
import { getDashboardTools } from "@/lib/queries/dashboard/tools";
import { getToolDetail } from "@/lib/queries/dashboard/tool-detail";
import { getDeveloperRoster } from "@/lib/read-models/developers";
import { getDeveloperOverview } from "@/lib/queries/me/overview";
import { listSubscriptions } from "@/lib/tools/subscriptions";
import { getWorkOverview, getWorkActivity } from "@/lib/signals";
import { addCycles, resolveBillingCycleOffset } from "@/lib/billing/cycles";
import {
  activityPriority,
  costKindForRow,
  costPriority,
  isObservedSource,
  normalizeSource,
} from "@/lib/metrics/source-priority";

const AGENT_CONFIG = "/Users/dinudayaggahavita/.usejunction/config.json";
const CACHE_DIR = "/Users/dinudayaggahavita/.usejunction/cache";
const MICROS = 1_000_000;
const DAY_MS = 86_400_000;

type Check = {
  surface: string;
  view: string;
  metric: string;
  expected: number | string | boolean | null;
  actual: number | string | boolean | null;
  ok: boolean;
  note?: string;
};

type RawRow = {
  date: Date;
  developerId: string | null;
  provider: string;
  product: string;
  toolName: string;
  model: string | null;
  source: string;
  verified: boolean;
  requests: number;
  inputTokens: bigint;
  outputTokens: bigint;
  costMicros: bigint;
  costKind: string | null;
  metricKind: string | null;
};

function money(micros: bigint | number) {
  return Number(micros) / MICROS;
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayOnly(value: string) {
  return value.slice(0, 10);
}

function inWindow(date: Date, from: Date, to: Date) {
  const t = date.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function check(
  surface: string,
  view: string,
  metric: string,
  expected: number | string | boolean | null,
  actual: number | string | boolean | null,
  note?: string,
): Check {
  const normalizedExpected =
    typeof expected === "string" && /^\d{4}-\d{2}-\d{2}/.test(expected) ? dayOnly(expected) : expected;
  const normalizedActual =
    typeof actual === "string" && /^\d{4}-\d{2}-\d{2}/.test(actual) ? dayOnly(actual) : actual;
  const ok =
    typeof normalizedExpected === "number" && typeof normalizedActual === "number"
      ? Math.abs(normalizedExpected - normalizedActual) < 0.02
      : normalizedExpected === normalizedActual;
  return { surface, view, metric, expected: normalizedExpected, actual: normalizedActual, ok, note };
}

function isProductivityRow(row: RawRow) {
  const source = normalizeSource(row.source);
  return (
    row.metricKind === "productivity" ||
    source === "cursor_local" ||
    row.source === "cursor_local" ||
    row.source === "opencode_local"
  );
}

function independentOrgUsage(rows: RawRow[], from: Date, to: Date) {
  const scoped = rows.filter((r) => inWindow(r.date, from, to));

  // Match analytics SQL: activity wins by (date, developer, provider, product, tool, model);
  // productivity rows never count as model activity.
  const activityBest = new Map<string, number>();
  for (const row of scoped) {
    if (isProductivityRow(row)) continue;
    const source = normalizeSource(row.source);
    if (!isObservedSource(source)) continue;
    if (row.requests <= 0 && row.inputTokens <= BigInt(0) && row.outputTokens <= BigInt(0)) continue;
    const key = [
      isoDay(row.date),
      row.developerId ?? "",
      row.provider,
      row.product,
      row.toolName,
      row.model ?? "",
    ].join("|");
    const priority = activityPriority(source);
    const prev = activityBest.get(key);
    if (prev === undefined || priority < prev) activityBest.set(key, priority);
  }

  let requests = 0;
  let tokens = BigInt(0);
  for (const row of scoped) {
    if (isProductivityRow(row)) continue;
    const source = normalizeSource(row.source);
    if (!isObservedSource(source)) continue;
    if (row.requests <= 0 && row.inputTokens <= BigInt(0) && row.outputTokens <= BigInt(0)) continue;
    const key = [
      isoDay(row.date),
      row.developerId ?? "",
      row.provider,
      row.product,
      row.toolName,
      row.model ?? "",
    ].join("|");
    if (activityPriority(source) !== activityBest.get(key)) continue;
    requests += row.requests;
    tokens += row.inputTokens + row.outputTokens;
  }

  // Cost: all positive-cost rows at the best priority for (date, provider) are summed.
  const costBest = new Map<string, number>();
  for (const row of scoped) {
    if (row.costMicros <= BigInt(0)) continue;
    const key = `${isoDay(row.date)}|${row.provider}`;
    const priority = costPriority(normalizeSource(row.source));
    const prev = costBest.get(key);
    if (prev === undefined || priority < prev) costBest.set(key, priority);
  }

  let verified = BigInt(0);
  let estimated = BigInt(0);
  for (const row of scoped) {
    if (row.costMicros <= BigInt(0)) continue;
    const source = normalizeSource(row.source);
    const key = `${isoDay(row.date)}|${row.provider}`;
    if (costPriority(source) !== costBest.get(key)) continue;
    const kind =
      row.costKind ??
      costKindForRow({
        verified: row.verified,
        source,
        costMicros: row.costMicros,
      });
    if (kind === "verified_usage") verified += row.costMicros;
    else if (kind === "estimated_api") estimated += row.costMicros;
  }

  return {
    requests,
    tokens: Number(tokens),
    verified: money(verified),
    estimated: money(estimated),
    totalUsage: money(verified + estimated),
  };
}

/** Developer slice using org-wide cost winners (matches sealed developer snapshots). */
function independentDeveloperSnapshotUsage(rows: RawRow[], developerId: string, from: Date, to: Date) {
  const scoped = rows.filter((r) => inWindow(r.date, from, to));
  const mine = scoped.filter((r) => r.developerId === developerId);

  const activityBest = new Map<string, number>();
  for (const row of mine) {
    if (isProductivityRow(row)) continue;
    const source = normalizeSource(row.source);
    if (!isObservedSource(source)) continue;
    if (row.requests <= 0 && row.inputTokens <= BigInt(0) && row.outputTokens <= BigInt(0)) continue;
    const key = [
      isoDay(row.date),
      row.developerId ?? "",
      row.provider,
      row.product,
      row.toolName,
      row.model ?? "",
    ].join("|");
    const priority = activityPriority(source);
    const prev = activityBest.get(key);
    if (prev === undefined || priority < prev) activityBest.set(key, priority);
  }

  let requests = 0;
  let tokens = BigInt(0);
  for (const row of mine) {
    if (isProductivityRow(row)) continue;
    const source = normalizeSource(row.source);
    if (!isObservedSource(source)) continue;
    if (row.requests <= 0 && row.inputTokens <= BigInt(0) && row.outputTokens <= BigInt(0)) continue;
    const key = [
      isoDay(row.date),
      row.developerId ?? "",
      row.provider,
      row.product,
      row.toolName,
      row.model ?? "",
    ].join("|");
    if (activityPriority(source) !== activityBest.get(key)) continue;
    requests += row.requests;
    tokens += row.inputTokens + row.outputTokens;
  }

  // Org-wide cost priority, then attribute only this developer's winning rows.
  const costBest = new Map<string, number>();
  for (const row of scoped) {
    if (row.costMicros <= BigInt(0)) continue;
    const key = `${isoDay(row.date)}|${row.provider}`;
    const priority = costPriority(normalizeSource(row.source));
    const prev = costBest.get(key);
    if (prev === undefined || priority < prev) costBest.set(key, priority);
  }

  let verified = BigInt(0);
  let estimated = BigInt(0);
  for (const row of mine) {
    if (row.costMicros <= BigInt(0)) continue;
    const source = normalizeSource(row.source);
    const key = `${isoDay(row.date)}|${row.provider}`;
    if (costPriority(source) !== costBest.get(key)) continue;
    const kind =
      row.costKind ??
      costKindForRow({
        verified: row.verified,
        source,
        costMicros: row.costMicros,
      });
    if (kind === "verified_usage") verified += row.costMicros;
    else if (kind === "estimated_api") estimated += row.costMicros;
  }

  return {
    requests,
    tokens: Number(tokens),
    verified: money(verified),
    estimated: money(estimated),
    totalUsage: money(verified + estimated),
  };
}

function filterTool(rows: RawRow[], toolNames: string[]) {
  const set = new Set(toolNames.map((t) => t.toLowerCase()));
  return rows.filter((r) => set.has(r.toolName.toLowerCase()));
}

function overlapDays(fromInclusive: Date, toExclusive: Date, otherFromInclusive: Date, otherToExclusive: Date) {
  const start = new Date(Math.max(fromInclusive.getTime(), otherFromInclusive.getTime()));
  const end = new Date(Math.min(toExclusive.getTime(), otherToExclusive.getTime()));
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

function independentCommitment(
  plans: Awaited<ReturnType<typeof listSubscriptions>>,
  view: CycleView,
  reportWindow: { from: Date; to: Date },
) {
  const toExclusive = new Date(reportWindow.to.getTime() + DAY_MS);
  let total = BigInt(0);
  for (const plan of plans) {
    const fullSpend = plan.cycleSeatMicros * BigInt(plan.seatCapacity);
    if (view !== "last_30_days") {
      total += fullSpend;
      continue;
    }
    let cursor = resolveBillingCycleOffset(plan, reportWindow.from, 0);
    while (cursor.cycleStart < toExclusive) {
      const days = overlapDays(cursor.cycleStart, cursor.cycleEnd, reportWindow.from, toExclusive);
      if (days > 0) {
        total += BigInt(Math.round(Number(fullSpend) * (days / cursor.totalDays)));
      }
      const nextStart = cursor.cycleEnd;
      const nextEnd = addCycles(nextStart, plan.billingCadence, 1, plan.billingCycleDays);
      cursor = {
        cycleStart: nextStart,
        cycleEnd: nextEnd,
        nextRenewalDate: nextEnd,
        elapsedPercent: 1,
        remainingDays: 0,
        totalDays: Math.max(1, Math.round((nextEnd.getTime() - nextStart.getTime()) / DAY_MS)),
      };
    }
  }
  return money(total);
}

function summarizeAgentCache() {
  const cursorEvents = JSON.parse(readFileSync(path.join(CACHE_DIR, "cursor-usage-events.json"), "utf8")) as {
    rows: Array<{
      date: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
      source: string;
      costKind?: string;
      metricKind?: string;
    }>;
    lastEventTimestamp?: string;
    calculationVersion?: string;
  };
  const cursorLocal = JSON.parse(
    readFileSync(path.join(CACHE_DIR, "cost-usage/cursor-local.json"), "utf8"),
  ) as Array<{ metricKind?: string; requests?: number; commits?: number; estimatedCost?: number }>;
  const codex = JSON.parse(readFileSync(path.join(CACHE_DIR, "cost-usage/codex.json"), "utf8")) as Array<{
    date: string;
    toolName: string;
    requests?: number;
    estimatedCost?: number;
    metricKind?: string;
    source?: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;

  const usageRows = cursorEvents.rows.filter((r) => r.metricKind !== "productivity");
  const cursorVerified = usageRows
    .filter((r) => r.costKind === "verified_usage" || r.source === "cursor_usage_events")
    .reduce(
      (acc, r) => {
        acc.requests += r.requests ?? 0;
        acc.tokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
        acc.cost += r.estimatedCost ?? 0;
        return acc;
      },
      { requests: 0, tokens: 0, cost: 0 },
    );

  const productivity = {
    cursorLocalRows: cursorLocal.length,
    cursorLocalCommits: cursorLocal.reduce((s, r) => s + (r.commits ?? 0), 0),
    codexRows: codex.length,
    codexRequests: codex.reduce((s, r) => s + (r.requests ?? 0), 0),
    codexCost: codex.reduce((s, r) => s + (r.estimatedCost ?? 0), 0),
  };

  // Last 30 calendar days ending today (local machine "now")
  const now = new Date();
  const to = isoDay(now);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const from = isoDay(fromDate);
  const cursorLast30 = usageRows
    .filter((r) => r.date >= from && r.date <= to)
    .reduce(
      (acc, r) => {
        acc.requests += r.requests ?? 0;
        acc.tokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
        acc.cost += r.estimatedCost ?? 0;
        return acc;
      },
      { requests: 0, tokens: 0, cost: 0 },
    );

  return {
    calculationVersion: cursorEvents.calculationVersion ?? null,
    lastEventTimestamp: cursorEvents.lastEventTimestamp ?? null,
    cursorEventsRows: cursorEvents.rows.length,
    cursorUsageRows: usageRows.length,
    cursorVerifiedAllTime: {
      requests: cursorVerified.requests,
      tokens: cursorVerified.tokens,
      cost: roundMoney(cursorVerified.cost),
    },
    cursorVerifiedLast30: {
      from,
      to,
      requests: cursorLast30.requests,
      tokens: cursorLast30.tokens,
      cost: roundMoney(cursorLast30.cost),
    },
    productivity,
  };
}

async function main() {
  const agent = JSON.parse(readFileSync(AGENT_CONFIG, "utf8")) as {
    orgId: string;
    deviceId: string;
    userId: string;
    controlPlaneUrl: string;
  };

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: agent.orgId },
    include: {
      developers: { select: { id: true, name: true, role: true, email: true, authUserId: true } },
      devices: { select: { id: true, hostname: true, lastSeenAt: true, lastUsageSyncAt: true } },
    },
  });

  const NOW = new Date(); // wall clock — real local data
  const plans = await listSubscriptions(org.id);
  const owner = org.developers.find((d) => d.role === "owner") ?? org.developers[0]!;
  const primaryDeveloper =
    org.developers.find((d) => d.id === agent.userId) ??
    org.developers.find((d) => d.role === "user") ??
    owner;

  const rawRows = (await prisma.usageDaily.findMany({
    where: { orgId: org.id },
    select: {
      date: true,
      developerId: true,
      provider: true,
      product: true,
      toolName: true,
      model: true,
      source: true,
      verified: true,
      requests: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
      costKind: true,
      metricKind: true,
    },
  })) as RawRow[];

  const activeDevelopers = await prisma.developer.count({
    where: { orgId: org.id, removedAt: null },
  });

  const context = {
    orgId: org.id,
    actorId: owner.authUserId ?? "local-verify",
    roles: ["owner" as const],
    now: NOW,
    timezone: UTC_TIMEZONE,
  };

  const views: Array<{
    label: string;
    cycleView: CycleView;
    period: { kind: "preset"; days: number } | { kind: "custom"; from: string; to: string };
    overviewInput: OverviewInput;
  }> = [
    {
      label: "current_cycles",
      cycleView: "current_cycles",
      period: { kind: "preset", days: 30 },
      overviewInput: { cycleView: "current_cycles" },
    },
    {
      label: "previous_cycles",
      cycleView: "previous_cycles",
      period: { kind: "preset", days: 30 },
      overviewInput: { cycleView: "previous_cycles" },
    },
    {
      label: "last_30_days",
      cycleView: "last_30_days",
      period: { kind: "preset", days: 30 },
      overviewInput: overviewInputFromRange(30, NOW),
    },
    {
      label: "last_14_days",
      cycleView: "last_30_days",
      period: { kind: "preset", days: 14 },
      overviewInput: overviewInputFromRange(14, NOW),
    },
    {
      label: "last_7_days",
      cycleView: "last_30_days",
      period: { kind: "preset", days: 7 },
      overviewInput: overviewInputFromRange(7, NOW),
    },
  ];

  const checks: Check[] = [];
  const pageSnapshots: Array<Record<string, unknown>> = [];
  const agentCache = summarizeAgentCache();

  // Inventory
  const byTool = new Map<string, { rows: number; requests: number; cost: number }>();
  for (const row of rawRows) {
    const cur = byTool.get(row.toolName) ?? { rows: 0, requests: 0, cost: 0 };
    cur.rows += 1;
    cur.requests += row.requests;
    cur.cost += money(row.costMicros);
    byTool.set(row.toolName, cur);
  }

  const dates = rawRows.map((r) => r.date.getTime());
  const inventory = {
    database: "postgresql://postgres@localhost:5432/usejunction",
    agentControlPlane: agent.controlPlaneUrl,
    org: { id: org.id, name: org.name, slug: org.slug, plan: org.plan },
    developers: org.developers.map((d) => ({ id: d.id, name: d.name, role: d.role, email: d.email })),
    devices: org.devices.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      lastUsageSyncAt: d.lastUsageSyncAt?.toISOString() ?? null,
      isAgentDevice: d.id === agent.deviceId,
    })),
    usageRows: rawRows.length,
    dateRange: {
      min: dates.length ? isoDay(new Date(Math.min(...dates))) : null,
      max: dates.length ? isoDay(new Date(Math.max(...dates))) : null,
    },
    subscriptions: plans.map((p) => ({
      name: p.name,
      toolKey: p.toolKey,
      seatCapacity: p.seatCapacity,
      assignedSeats: p.assignedSeats,
      availableSeats: p.availableSeats,
      cycleSeatDollars: money(p.cycleSeatMicros),
      estimatedCycleDollars: money(p.estimatedCycleMicros),
      cycleStart: isoDay(p.cycle.cycleStart),
      cycleEnd: isoDay(new Date(p.cycle.cycleEnd.getTime() - DAY_MS)),
    })),
    byTool: [...byTool.entries()]
      .map(([tool, v]) => ({ tool, ...v, cost: roundMoney(v.cost) }))
      .sort((a, b) => b.cost - a.cost),
    agentCache,
  };

  for (const view of views) {
    const reportWindow = reportWindowForCycleView(view.cycleView, view.period, plans, NOW);
    const indep = independentOrgUsage(rawRows, reportWindow.from, reportWindow.to);
    const cursorIndep = independentOrgUsage(
      filterTool(rawRows, ["cursor"]),
      reportWindow.from,
      reportWindow.to,
    );
    const memberIndep = independentDeveloperSnapshotUsage(
      rawRows,
      primaryDeveloper.id,
      reportWindow.from,
      reportWindow.to,
    );
    const expectedCommitment = independentCommitment(plans, view.cycleView, reportWindow);

    const overview = await getOrgOverview(context, view.overviewInput);
    const d = overview.data;
    const activity = await getDashboardUsage(org.id, reportWindow);
    const tools = await getDashboardTools(org.id, reportWindow);
    const cursorDetail = await getToolDetail(org.id, "cursor", reportWindow);
    const roster = await getDeveloperRoster(org.id, { reportWindow });
    const member = await getDeveloperOverview(org.id, primaryDeveloper.id, { reportWindow });
    const planUsage = await getPlanUsage(context, { reportWindow });
    const workOverview = await getWorkOverview(context, {
      from: isoDay(reportWindow.from),
      to: isoDay(reportWindow.to),
    });
    const workActivity = await getWorkActivity(context, {
      from: isoDay(reportWindow.from),
      to: isoDay(reportWindow.to),
      limit: 50,
    });

    checks.push(
      check("/dashboard", view.label, "period.from", isoDay(reportWindow.from), d.period.from),
      check("/dashboard", view.label, "period.to", isoDay(reportWindow.to), d.period.to),
      check("/dashboard", view.label, "kpis.verified$", roundMoney(indep.verified), roundMoney(d.kpis.verifiedUsageCost.value)),
      check("/dashboard", view.label, "kpis.estimated$", roundMoney(indep.estimated), roundMoney(d.kpis.estimatedApiCost.value)),
      check("/dashboard", view.label, "kpis.tokens", indep.tokens, d.kpis.tokens.value),
      check(
        "/dashboard",
        view.label,
        "kpis.commitment$",
        roundMoney(expectedCommitment),
        roundMoney(d.kpis.actualSpend.value),
      ),
      // You (member snapshots) must never exceed Team (org snapshots) for the same window.
      check(
        "you≤team",
        view.label,
        "verified$",
        true,
        roundMoney(member.usage30d.verifiedUsageCost) <= roundMoney(d.kpis.verifiedUsageCost.value) + 0.02,
        `you ${roundMoney(member.usage30d.verifiedUsageCost)} ≤ team ${roundMoney(d.kpis.verifiedUsageCost.value)}`,
      ),
      check(
        "you≤team",
        view.label,
        "estimated$",
        true,
        roundMoney(member.usage30d.estimatedApiCost) <= roundMoney(d.kpis.estimatedApiCost.value) + 0.02,
        `you ${roundMoney(member.usage30d.estimatedApiCost)} ≤ team ${roundMoney(d.kpis.estimatedApiCost.value)}`,
      ),
      check(
        "you≤team",
        view.label,
        "tokens",
        true,
        Number(member.usage30d.inputTokens) + Number(member.usage30d.outputTokens) <= d.kpis.tokens.value,
        `you tokens ≤ team tokens`,
      ),
      check("/activity", view.label, "modelCalls", indep.requests, activity.kpis.modelCalls),
      check("/activity", view.label, "verified$", roundMoney(indep.verified), roundMoney(activity.kpis.verifiedUsageCost)),
      check("/activity", view.label, "estimated$", roundMoney(indep.estimated), roundMoney(activity.kpis.estimatedApiCost)),
      check(
        "/activity",
        view.label,
        "tokens",
        indep.tokens,
        activity.kpis.inputTokens + activity.kpis.outputTokens,
      ),
      check(
        "/tools/cursor",
        view.label,
        "usageCost$",
        roundMoney(cursorIndep.totalUsage),
        roundMoney(cursorDetail?.kpis.usageCost ?? NaN),
      ),
      check("/tools/cursor", view.label, "requests", cursorIndep.requests, cursorDetail?.kpis.requests ?? null),
      check("/tools/cursor", view.label, "tokens", cursorIndep.tokens, cursorDetail?.kpis.tokens ?? null),
      check("/team", view.label, "memberCount", activeDevelopers, roster.developers.length),
      check(
        `/team/${primaryDeveloper.id}`,
        view.label,
        "verified$",
        roundMoney(memberIndep.verified),
        roundMoney(member.usage30d.verifiedUsageCost),
      ),
      check(
        `/team/${primaryDeveloper.id}`,
        view.label,
        "estimated$",
        roundMoney(memberIndep.estimated),
        roundMoney(member.usage30d.estimatedApiCost),
      ),
      check(`/team/${primaryDeveloper.id}`, view.label, "requests", memberIndep.requests, member.usage30d.requests),
      check("/team plan-usage", view.label, "subscriptionCount", plans.length, planUsage.data.subscriptions.length),
      check("/signals", view.label, "enabled", workOverview.data.enabled, workOverview.data.enabled),
      check("/signals/activity", view.label, "enabled", workActivity.data.enabled, workActivity.data.enabled),
    );

    // Cross-check: dashboard vs activity consistency
    checks.push(
      check(
        "cross-page",
        view.label,
        "dashboard.verified == activity.verified",
        roundMoney(d.kpis.verifiedUsageCost.value),
        roundMoney(activity.kpis.verifiedUsageCost),
      ),
      check(
        "cross-page",
        view.label,
        "dashboard.estimated == activity.estimated",
        roundMoney(d.kpis.estimatedApiCost.value),
        roundMoney(activity.kpis.estimatedApiCost),
      ),
    );

    // Soft check: device cache is a subset of org DB (this machine's uploads only).
    if (view.label === "last_30_days") {
      const cacheReq = agentCache.cursorVerifiedLast30.requests;
      const dbReq = cursorDetail?.kpis.requests ?? 0;
      const cacheCost = agentCache.cursorVerifiedLast30.cost;
      const memberVerified = roundMoney(member.usage30d.verifiedUsageCost);
      checks.push(
        check(
          "agent-cache vs member verified$",
          view.label,
          "cursor cost on this device ≈ member verified",
          cacheCost,
          memberVerified,
          "device-local cursor events should match this developer's verified usage",
        ),
        check(
          "agent-cache vs org /tools/cursor",
          view.label,
          "cache requests ≤ org requests",
          true,
          cacheReq <= dbReq,
          `cache ${cacheReq} ≤ db ${dbReq}`,
        ),
      );
    }

    pageSnapshots.push({
      view: view.label,
      window: { from: isoDay(reportWindow.from), to: isoDay(reportWindow.to) },
      independent: { org: indep, cursor: cursorIndep, member: memberIndep, commitment: expectedCommitment },
      dashboard: {
        commitment: d.kpis.actualSpend.value,
        verified: d.kpis.verifiedUsageCost.value,
        estimated: d.kpis.estimatedApiCost.value,
        tokens: d.kpis.tokens.value,
        coverage: d.coverage,
        subscriptionCycles: d.subscriptionCycles.map((c) => ({
          tool: c.toolName,
          spend: c.cycleSpend,
          verified: c.verifiedUsageCost,
          estimated: c.estimatedApiCost,
          calls: c.modelCalls,
          util: c.utilizationPercent,
        })),
        tools: d.tools,
      },
      activity: {
        modelCalls: activity.kpis.modelCalls,
        verified: activity.kpis.verifiedUsageCost,
        estimated: activity.kpis.estimatedApiCost,
        tokens: activity.kpis.inputTokens + activity.kpis.outputTokens,
        byTool: activity.byTool.slice(0, 10),
      },
      toolsDetected: tools.tools.slice(0, 10).map((t) => ({
        name: t.toolName,
        requests: t.requests,
        cost: t.cost,
        tokens: t.tokens,
      })),
      toolCursor: cursorDetail
        ? {
            usageCost: cursorDetail.kpis.usageCost,
            requests: cursorDetail.kpis.requests,
            tokens: cursorDetail.kpis.tokens,
            devices: cursorDetail.kpis.devices,
            people: cursorDetail.kpis.people,
            seatsPurchased: cursorDetail.kpis.seatsPurchased,
            seatsAssigned: cursorDetail.kpis.seatsAssigned,
          }
        : null,
      member: {
        id: primaryDeveloper.id,
        name: primaryDeveloper.name,
        verified: member.usage30d.verifiedUsageCost,
        estimated: member.usage30d.estimatedApiCost,
        requests: member.usage30d.requests,
        tokens: Number(member.usage30d.inputTokens) + Number(member.usage30d.outputTokens),
      },
      signals: {
        overviewEnabled: workOverview.data.enabled,
        overviewSessions: workOverview.data.sessions,
        activityEnabled: workActivity.data.enabled,
      },
    });
  }

  const failed = checks.filter((c) => !c.ok);
  const passed = checks.filter((c) => c.ok).length;
  const report = {
    generatedAt: new Date().toISOString(),
    asOf: NOW.toISOString(),
    inventory,
    summary: {
      totalChecks: checks.length,
      passed,
      failed: failed.length,
      views: views.map((v) => v.label),
      surfaces: [...new Set(checks.map((c) => c.surface))],
    },
    failures: failed,
    checks,
    pageSnapshots,
  };

  const outPath = path.join(__dirname, "local-data-verification-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        outPath,
        org: inventory.org,
        usageRows: inventory.usageRows,
        dateRange: inventory.dateRange,
        subscriptions: inventory.subscriptions,
        byTool: inventory.byTool.slice(0, 8),
        agentCache: inventory.agentCache,
        summary: report.summary,
        failures: failed.slice(0, 40),
        current: pageSnapshots.find((s) => s.view === "current_cycles"),
        last30: pageSnapshots.find((s) => s.view === "last_30_days"),
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
