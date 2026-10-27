import { writeFileSync } from "node:fs";
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
import { getDeveloperOverview, getMeOverview } from "@/lib/queries/me/overview";
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

export const DEFAULT_ORG_SLUG = "e2e-calculation-fixture";
export const DEFAULT_AS_OF = new Date("2026-07-16T12:00:00.000Z");
export const DEFAULT_DEVELOPER_ID = "e2e-developer";

const MICROS = 1_000_000;
const DAY_MS = 86_400_000;

export type CalculationCheck = {
  surface: string;
  view: string;
  metric: string;
  expected: number | string | boolean | null;
  actual: number | string | boolean | null;
  ok: boolean;
  note?: string;
};

export type CalculationVerificationReport = {
  generatedAt: string;
  asOf: string;
  fixture: Record<string, unknown>;
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    skippedNull: number;
    views: string[];
    surfaces: string[];
  };
  failures: CalculationCheck[];
  checks: CalculationCheck[];
  pageSnapshots: Array<Record<string, unknown>>;
};

export type RunCalculationVerificationOptions = {
  orgSlug?: string;
  asOf?: Date;
  developerId?: string;
  writeReportPath?: string;
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

function inWindow(date: Date, from: Date, to: Date) {
  const t = date.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

/** Match analytics SQL: productivity lines/commits are not model-call KPIs. Free/detected usage still counts. */
function isProductivityRow(row: RawRow) {
  const source = normalizeSource(row.source);
  return (
    row.metricKind === "productivity" ||
    source === "cursor_local" ||
    row.source === "cursor_local" ||
    row.source === "opencode_local"
  );
}

/** Independently recompute org-wide usage using the same source-priority rules. */
function independentOrgUsage(rows: RawRow[], from: Date, to: Date) {
  const scoped = rows.filter((r) => inWindow(r.date, from, to));

  // Match analytics SQL: activity wins by (date, developer, provider, product, tool, model).
  // Free/detected device_observed usage counts; productivity rows never count as model activity.
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
    if (activityBest.get(key) !== activityPriority(source)) continue;
    requests += row.requests;
    tokens += row.inputTokens + row.outputTokens;
  }

  const costGroups = new Map<string, RawRow>();
  for (const row of scoped) {
    if (row.costMicros <= BigInt(0)) continue;
    const key = `${isoDay(row.date)}|${row.provider}`;
    const prev = costGroups.get(key);
    if (!prev || costPriority(normalizeSource(row.source)) < costPriority(normalizeSource(prev.source))) {
      costGroups.set(key, row);
    }
  }

  let verified = BigInt(0);
  let estimated = BigInt(0);
  let actualSpend = BigInt(0);
  for (const row of costGroups.values()) {
    const kind =
      row.costKind ??
      costKindForRow({
        verified: row.verified,
        source: normalizeSource(row.source),
        costMicros: row.costMicros,
      });
    if (kind === "verified_usage") verified += row.costMicros;
    else if (kind === "estimated_api") estimated += row.costMicros;
    else if (kind === "actual_spend") actualSpend += row.costMicros;
  }

  return {
    requests,
    tokens: Number(tokens),
    verified: money(verified),
    estimated: money(estimated),
    actualSpend: money(actualSpend),
    totalUsage: money(verified + estimated + actualSpend),
  };
}

function independentDeveloperUsage(rows: RawRow[], developerId: string, from: Date, to: Date) {
  return independentOrgUsage(
    rows.filter((r) => r.developerId === developerId),
    from,
    to,
  );
}

function independentCursorUsage(rows: RawRow[], from: Date, to: Date) {
  return independentOrgUsage(
    rows.filter((r) => r.toolName === "cursor" || r.provider === "cursor"),
    from,
    to,
  );
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

function dayOnly(value: string) {
  return value.slice(0, 10);
}

function check(
  surface: string,
  view: string,
  metric: string,
  expected: number | string | boolean | null,
  actual: number | string | boolean | null,
  note?: string,
): CalculationCheck {
  const normalizedExpected = typeof expected === "string" && /^\d{4}-\d{2}-\d{2}/.test(expected) ? dayOnly(expected) : expected;
  const normalizedActual = typeof actual === "string" && /^\d{4}-\d{2}-\d{2}/.test(actual) ? dayOnly(actual) : actual;
  const ok =
    typeof normalizedExpected === "number" && typeof normalizedActual === "number"
      ? Math.abs(normalizedExpected - normalizedActual) < 0.005
      : normalizedExpected === normalizedActual;
  return { surface, view, metric, expected: normalizedExpected, actual: normalizedActual, ok, note };
}

export async function runCalculationVerification(
  opts: RunCalculationVerificationOptions = {},
): Promise<{ checks: CalculationCheck[]; failed: CalculationCheck[]; report: CalculationVerificationReport }> {
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const now = opts.asOf ?? DEFAULT_AS_OF;
  const developerId = opts.developerId ?? DEFAULT_DEVELOPER_ID;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { slug: orgSlug },
    include: {
      developers: { select: { id: true, name: true, role: true, authUserId: true } },
      devices: { select: { id: true, hostname: true } },
    },
  });
  const owner = org.developers.find((d) => d.role === "owner")!;
  const developer = org.developers.find((d) => d.id === developerId)!;

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

  // Page loaders read snapshots only — seal usage_daily into snapshots before comparing KPIs.
  if (rawRows.length > 0) {
    const { materializeOrgUsageRange, snapshotUtcDay } = await import("@/lib/analytics/snapshots");
    let minTime = rawRows[0]!.date.getTime();
    let maxTime = rawRows[0]!.date.getTime();
    for (const row of rawRows) {
      minTime = Math.min(minTime, row.date.getTime());
      maxTime = Math.max(maxTime, row.date.getTime());
    }
    const snapshotTo = snapshotUtcDay(new Date(Math.max(maxTime, now.getTime())));
    await materializeOrgUsageRange(org.id, snapshotUtcDay(new Date(minTime)), snapshotTo);
  }

  const plans = await listSubscriptions(org.id);
  const context = {
    orgId: org.id,
    actorId: owner.authUserId ?? "verify",
    roles: ["owner" as const],
    now,
    timezone: UTC_TIMEZONE,
  };

  const views: Array<{ label: string; cycleView: CycleView; period: { kind: "preset"; days: number } | { kind: "custom"; from: string; to: string }; overviewInput: OverviewInput }> = [
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
      overviewInput: overviewInputFromRange(30, now),
    },
    {
      label: "last_14_days",
      cycleView: "last_30_days",
      period: { kind: "preset", days: 14 },
      overviewInput: overviewInputFromRange(14, now),
    },
    {
      label: "last_7_days",
      cycleView: "last_30_days",
      period: { kind: "preset", days: 7 },
      overviewInput: overviewInputFromRange(7, now),
    },
    {
      label: "custom_2026-07-01_2026-07-16",
      cycleView: "last_30_days",
      period: { kind: "custom", from: "2026-07-01", to: "2026-07-16" },
      overviewInput: overviewInputFromBounds("2026-07-01", "2026-07-16"),
    },
  ];

  const checks: CalculationCheck[] = [];
  const pageSnapshots: Array<Record<string, unknown>> = [];

  const fixture = {
    asOf: now.toISOString(),
    orgSlug,
    orgId: org.id,
    developers: org.developers.length,
    devices: org.devices.length,
    usageRows: rawRows.map((r) => ({
      date: isoDay(r.date),
      developerId: r.developerId,
      tool: r.toolName,
      provider: r.provider,
      source: r.source,
      requests: r.requests,
      tokens: Number(r.inputTokens + r.outputTokens),
      cost: money(r.costMicros),
      costKind: r.costKind,
    })),
    subscriptions: plans.map((p) => ({
      name: p.name,
      toolKey: p.toolKey,
      seatCapacity: p.seatCapacity,
      assignedSeats: p.assignedSeats,
      availableSeats: p.availableSeats,
      cycleSeatDollars: money(p.cycleSeatMicros),
      estimatedCycleDollars: money(p.estimatedCycleMicros),
      cycleStart: isoDay(p.cycle.cycleStart),
      cycleEnd: isoDay(new Date(p.cycle.cycleEnd.getTime() - 86_400_000)),
    })),
  };

  const cycleCommitment = plans.reduce((sum, p) => sum + money(p.estimatedCycleMicros), 0);
  checks.push(check("/tools subscriptions", "all", "cycleCommitment$", 40, roundMoney(cycleCommitment)));
  checks.push(check("/tools subscriptions", "all", "purchasedSeats", 2, plans.reduce((s, p) => s + p.seatCapacity, 0)));
  checks.push(check("/tools subscriptions", "all", "assignedSeats", 1, plans.reduce((s, p) => s + p.assignedSeats, 0)));
  checks.push(check("/tools subscriptions", "all", "availableSeats", 1, plans.reduce((s, p) => s + p.availableSeats, 0)));

  for (const view of views) {
    const reportWindow = reportWindowForCycleView(view.cycleView, view.period, plans, now);
    const indep = independentOrgUsage(rawRows, reportWindow.from, reportWindow.to);
    const cursorIndep = independentCursorUsage(rawRows, reportWindow.from, reportWindow.to);
    const memberIndep = independentDeveloperUsage(rawRows, developerId, reportWindow.from, reportWindow.to);

    const overview = await getOrgOverview(context, view.overviewInput);
    const d = overview.data;
    const cursorCycle = d.subscriptionCycles.find((c) => c.toolName === "cursor" || c.toolKey === "cursor");

    checks.push(
      check("/dashboard", view.label, "period.from", isoDay(reportWindow.from), d.period.from),
      check("/dashboard", view.label, "period.to", isoDay(reportWindow.to), d.period.to),
      check("/dashboard", view.label, "kpis.verifiedUsageCost", indep.verified, d.kpis.verifiedUsageCost.value, "org-wide scope=team"),
      check("/dashboard", view.label, "kpis.estimatedApiCost", indep.estimated, d.kpis.estimatedApiCost.value, "org-wide scope=team"),
      check("/dashboard", view.label, "kpis.tokens", indep.tokens, d.kpis.tokens.value, "org-wide input+output scope=team"),
      check(
        "/dashboard",
        view.label,
        "kpis.actualSpend$",
        roundMoney(independentCommitment(plans, view.cycleView, reportWindow)),
        roundMoney(d.kpis.actualSpend.value),
        view.cycleView === "last_30_days" ? "overlap-prorated seat commitment" : "full cycle seatCapacity×price",
      ),
    );

    if (view.label === "previous_cycles") {
      checks.push(
        check("/dashboard", view.label, "cursor.cycleSpend$", 40, cursorCycle?.cycleSpend ?? null),
        check("/dashboard", view.label, "cursor.verified$", 0, cursorCycle?.verifiedUsageCost ?? null, "no June usage in seed"),
        check("/dashboard", view.label, "cursor.modelCalls", 0, cursorCycle?.modelCalls ?? null),
      );
    } else {
      const expectedCursorSpend = roundMoney(independentCommitment(plans, view.cycleView, reportWindow));
      checks.push(
        check("/dashboard", view.label, "cursor.cycleSpend$", expectedCursorSpend, roundMoney(cursorCycle?.cycleSpend ?? NaN)),
        check("/dashboard", view.label, "cursor.verified$", cursorIndep.verified, cursorCycle?.verifiedUsageCost ?? null),
        check("/dashboard", view.label, "cursor.estimated$", cursorIndep.estimated, cursorCycle?.estimatedApiCost ?? null),
        check("/dashboard", view.label, "cursor.modelCalls", cursorIndep.requests, cursorCycle?.modelCalls ?? null),
      );
    }

    const activity = await getDashboardUsage(org.id, reportWindow);
    checks.push(
      check("/activity", view.label, "modelCalls", indep.requests, activity.kpis.modelCalls, "scope=team"),
      check("/activity", view.label, "verifiedUsageCost", indep.verified, activity.kpis.verifiedUsageCost, "scope=team"),
      check("/activity", view.label, "estimatedApiCost", indep.estimated, activity.kpis.estimatedApiCost, "scope=team"),
      check("/activity", view.label, "tokens", indep.tokens, activity.kpis.inputTokens + activity.kpis.outputTokens, "scope=team"),
    );

    // Owner/admin You scope: metrics for the owner's linked developer (may be zero in fixture).
    const ownerIndep = independentDeveloperUsage(rawRows, owner.id, reportWindow.from, reportWindow.to);
    if (owner.authUserId) {
      const ownerMe = await getMeOverview(org.id, owner.authUserId, "owner", { reportWindow });
      checks.push(
        check("/dashboard scope=you", view.label, "requests", ownerIndep.requests, ownerMe.usage30d.requests),
        check("/dashboard scope=you", view.label, "verified$", ownerIndep.verified, ownerMe.usage30d.verifiedUsageCost),
        check("/activity scope=you", view.label, "estimated$", ownerIndep.estimated, ownerMe.usage30d.estimatedApiCost),
        check(
          "/activity scope=you",
          view.label,
          "tokens",
          ownerIndep.tokens,
          Number(ownerMe.usage30d.inputTokens) + Number(ownerMe.usage30d.outputTokens),
        ),
      );
    }

    const tools = await getDashboardTools(org.id, reportWindow);
    const cursorTool = tools.tools.find((t) => t.toolName === "cursor");
    checks.push(
      check("/tools activity", view.label, "cursor.requests", cursorIndep.requests, cursorTool?.requests ?? null),
      check("/tools activity", view.label, "cursor.cost$", cursorIndep.totalUsage, cursorTool?.cost ?? null),
      check("/tools activity", view.label, "cursor.tokens", cursorIndep.tokens, cursorTool?.tokens ?? null),
    );

    const detail = await getToolDetail(org.id, "cursor", reportWindow);
    checks.push(
      check("/tools/cursor", view.label, "usageCost$", cursorIndep.totalUsage, detail?.kpis.usageCost ?? null),
      check("/tools/cursor", view.label, "requests", cursorIndep.requests, detail?.kpis.requests ?? null),
      check("/tools/cursor", view.label, "tokens", cursorIndep.tokens, detail?.kpis.tokens ?? null),
      check("/tools/cursor", view.label, "seatsPurchased", 2, detail?.kpis.seatsPurchased ?? null),
      check("/tools/cursor", view.label, "seatsAssigned", 1, detail?.kpis.seatsAssigned ?? null),
      check("/tools/cursor", view.label, "devices", 1, detail?.kpis.devices ?? null),
    );

    const roster = await getDeveloperRoster(org.id, { reportWindow });
    const rosterDev = roster.developers.find((x) => x.id === developerId);
    checks.push(
      check("/team", view.label, "memberCount", 2, roster.developers.length),
      check("cross-page", view.label, "dashboard.people == team.roster", roster.developers.length, d.coverage.developers),
      check("cross-page", view.label, "dashboard.activePeople <= dashboard.people", true, d.coverage.activeDevelopers <= d.coverage.developers),
      check("/team", view.label, "e2e-developer.requests", memberIndep.requests, rosterDev?.requests ?? null),
    );

    const member = await getDeveloperOverview(org.id, developerId, { reportWindow });
    checks.push(
      check("/team/e2e-developer", view.label, "verified$", memberIndep.verified, member.usage30d.verifiedUsageCost),
      check("/team/e2e-developer", view.label, "estimated$", memberIndep.estimated, member.usage30d.estimatedApiCost),
      check("/team/e2e-developer", view.label, "requests", memberIndep.requests, member.usage30d.requests),
      check(
        "/team/e2e-developer",
        view.label,
        "tokens",
        memberIndep.tokens,
        Number(member.usage30d.inputTokens) + Number(member.usage30d.outputTokens),
      ),
    );

    const planUsage = await getPlanUsage(context, { reportWindow });
    checks.push(
      check("/team plan-usage", view.label, "subscriptionCount", 1, planUsage.data.subscriptions.length),
      check("/team plan-usage", view.label, "developersWithAssignments", 1, planUsage.data.developers.length),
    );

    const workFilters = {
      from: isoDay(reportWindow.from),
      to: isoDay(reportWindow.to),
    };
    const workOverview = await getWorkOverview(context, workFilters);
    const workActivity = await getWorkActivity(context, { ...workFilters, limit: 50 });
    const workOverviewEnabled = Boolean((workOverview.data as { enabled?: boolean }).enabled);
    const workActivityEnabled = Boolean((workActivity.data as { enabled?: boolean }).enabled);
    const workSessions =
      typeof (workOverview.data as { sessions?: unknown }).sessions === "number"
        ? (workOverview.data as { sessions: number }).sessions
        : Array.isArray((workOverview.data as { sessions?: unknown[] }).sessions)
          ? (workOverview.data as { sessions: unknown[] }).sessions.length
          : 0;
    checks.push(
      check("/signals", view.label, "enabled", false, workOverviewEnabled, "scope=team"),
      check("/signals/activity", view.label, "enabled", false, workActivityEnabled, "scope=team"),
      check("/signals", view.label, "sessions", 0, workSessions, "work extraction off scope=team"),
    );

    const workYouOverview = await getWorkOverview(context, { ...workFilters, developerId: owner.id });
    const workYouActivity = await getWorkActivity(context, { ...workFilters, developerId: owner.id, limit: 50 });
    const workYouEnabled = Boolean((workYouOverview.data as { enabled?: boolean }).enabled);
    const workYouSessions =
      typeof (workYouOverview.data as { sessions?: unknown }).sessions === "number"
        ? (workYouOverview.data as { sessions: number }).sessions
        : Array.isArray((workYouOverview.data as { sessions?: unknown[] }).sessions)
          ? (workYouOverview.data as { sessions: unknown[] }).sessions.length
          : 0;
    const workYouActivityEnabled = Boolean((workYouActivity.data as { enabled?: boolean }).enabled);
    checks.push(
      check("/signals scope=you", view.label, "enabled", false, workYouEnabled, "owner self filter"),
      check("/signals/activity scope=you", view.label, "enabled", false, workYouActivityEnabled, "owner self filter"),
      check("/signals scope=you", view.label, "sessions", 0, workYouSessions, "owner has no work sessions in fixture"),
    );

    pageSnapshots.push({
      view: view.label,
      window: { from: isoDay(reportWindow.from), to: isoDay(reportWindow.to) },
      independent: { org: indep, cursor: cursorIndep, member: memberIndep },
      dashboard: {
        cycleView: d.cycleView,
        period: d.period,
        kpis: {
          commitment: d.kpis.actualSpend.value,
          verified: d.kpis.verifiedUsageCost.value,
          estimated: d.kpis.estimatedApiCost.value,
          tokens: d.kpis.tokens.value,
        },
        coverage: d.coverage,
        subscriptionCycles: d.subscriptionCycles,
        tools: d.tools,
        hasActivity: d.hasActivity,
        observation: d.observation,
      },
      activity: {
        modelCalls: activity.kpis.modelCalls,
        verified: activity.kpis.verifiedUsageCost,
        estimated: activity.kpis.estimatedApiCost,
        tokens: activity.kpis.inputTokens + activity.kpis.outputTokens,
        byTool: activity.byTool,
      },
      toolsDetected: tools.tools.map((t) => ({
        name: t.toolName,
        requests: t.requests,
        cost: t.cost,
        tokens: t.tokens,
        installedOn: t.installedOn,
      })),
      toolCursor: detail
        ? {
            usageCost: detail.kpis.usageCost,
            requests: detail.kpis.requests,
            tokens: detail.kpis.tokens,
            devices: detail.kpis.devices,
            people: detail.kpis.people,
            seatsPurchased: detail.kpis.seatsPurchased,
            seatsAssigned: detail.kpis.seatsAssigned,
          }
        : null,
      team: {
        members: roster.developers.map((x) => ({
          id: x.id,
          name: x.name,
          requests: x.requests,
          cost: x.cost,
        })),
      },
      member: {
        verified: member.usage30d.verifiedUsageCost,
        estimated: member.usage30d.estimatedApiCost,
        requests: member.usage30d.requests,
        tokens: Number(member.usage30d.inputTokens) + Number(member.usage30d.outputTokens),
      },
      signals: {
        overviewEnabled: workOverviewEnabled,
        activityEnabled: workActivityEnabled,
      },
    });
  }

  const meWindow = reportWindowForCycleView("last_30_days", { kind: "preset", days: 30 }, plans, now);
  const me = await getMeOverview(org.id, developer.authUserId!, "user", { reportWindow: meWindow });
  const meIndep = independentDeveloperUsage(rawRows, developerId, meWindow.from, meWindow.to);
  checks.push(
    check("/dashboard (developer)", "last_30_days", "requests", meIndep.requests, me.usage30d.requests),
    check("/dashboard (developer)", "last_30_days", "verified$", meIndep.verified, me.usage30d.verifiedUsageCost),
    check("/activity (developer)", "last_30_days", "estimated$", meIndep.estimated, me.usage30d.estimatedApiCost),
    check(
      "/activity (developer)",
      "last_30_days",
      "tokens",
      meIndep.tokens,
      Number(me.usage30d.inputTokens) + Number(me.usage30d.outputTokens),
    ),
  );

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  const skipped = checks.filter((c) => c.expected === null && c.actual === null);

  const report: CalculationVerificationReport = {
    generatedAt: new Date().toISOString(),
    asOf: now.toISOString(),
    fixture,
    summary: {
      totalChecks: checks.length,
      passed,
      failed: failed.length,
      skippedNull: skipped.length,
      views: views.map((v) => v.label),
      surfaces: [...new Set(checks.map((c) => c.surface))],
    },
    failures: failed,
    checks,
    pageSnapshots,
  };

  if (opts.writeReportPath) {
    writeFileSync(opts.writeReportPath, JSON.stringify(report, null, 2));
  }

  return { checks, failed, report };
}
