// @vitest-environment happy-dom
import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import {
  addCycles,
  cadenceCycleDays,
  cycleAnchor,
  cycleFromNextRenewal,
  cycleToJson,
  normalizeBillingCadence,
  resolveBillingCycle,
  resolveBillingCycleOffset,
} from "../../lib/billing/cycles";
import {
  computeActualSpend,
  observationCoverage,
  subscriptionActiveInPeriod,
} from "../../lib/billing/actual-spend";
import {
  estimateCost,
  estimateCostFromRows,
} from "../../lib/metrics/estimate-cost";
import {
  inclusiveDayCount,
  usageDayFilterInclusive,
  usageExclusiveEnd,
  usageWindowDays,
  utcDateOnly,
  usageInclusiveEnd,
} from "../../lib/metrics/date-range";
import {
  DASHBOARD_PERIOD_STORAGE_KEY,
  DEFAULT_ROLLING_PERIOD,
  readRollingPeriodPrefs,
  removeSavedRollingPeriod,
  setActiveRollingPeriod,
} from "../../lib/dashboard/period-prefs";
import { quotaResetLabel, quotaWindowLabel } from "../../lib/quotas/display";
import {
  aggregateJourneys,
  aggregateTools,
  buildDailyTrend,
  buildDailyTrendPoints,
  buildWeeklyTrend,
  compatibilitySummaryFromSessions,
  summarizeWindow,
  toJourneyRows,
  toToolRows,
} from "../../lib/signals/policies/rollup";
import {
  flowKeyFromSession,
  parseFlowKey,
  sessionMatchesFlowKey,
  signalsFlow,
} from "../../lib/signals/policies/flow";
import { median, startOfUtcWeek } from "../../lib/signals/policies/aggregates";
import { resolveSignalsWindows } from "../../lib/signals/queries/windows";
import type { SignalsSessionRow } from "../../lib/signals/readers/sessions";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

test("usageWindowDays shifts with reportNow and excludes seeded July 10 outside a later wall clock", () => {
  const fixtureNow = day("2026-07-16");
  const ciNow = day("2026-08-09");
  const fixtureWindow = usageWindowDays(30, fixtureNow);
  const ciWindow = usageWindowDays(30, ciNow);
  assert.equal(fixtureWindow.from.toISOString().slice(0, 10), "2026-06-17");
  assert.equal(ciWindow.from.toISOString().slice(0, 10), "2026-07-11");
  assert.ok(fixtureWindow.from.getTime() < day("2026-07-10").getTime());
  assert.ok(ciWindow.from.getTime() > day("2026-07-10").getTime());
});

test("billing cadence helpers cover defaults, custom lengths, month ends, and offsets", () => {
  assert.equal(normalizeBillingCadence("unknown"), "monthly");
  assert.equal(cadenceCycleDays("weekly"), 7);
  assert.equal(cadenceCycleDays("annual"), 365);
  assert.equal(cadenceCycleDays("custom", 14.9), 14);
  assert.equal(cadenceCycleDays("custom", 0), 1);
  assert.equal(cadenceCycleDays("monthly"), null);
  assert.equal(cycleAnchor({ billingCycleAnchorDate: null, createdAt: day("2026-01-03") }).toISOString(), "2026-01-03T00:00:00.000Z");

  assert.equal(addCycles(day("2026-01-31"), "monthly", 1).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(addCycles(day("2026-01-01"), "annual", 1).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(addCycles(day("2026-01-01"), "custom", 2, 10).toISOString(), "2026-01-21T00:00:00.000Z");

  const beforeAnchor = resolveBillingCycle(
    { billingCadence: "monthly", billingCycleAnchorDate: day("2026-07-15"), createdAt: null },
    day("2026-06-01"),
  );
  assert.equal(beforeAnchor.cycleStart.toISOString(), "2026-05-15T00:00:00.000Z");
  assert.equal(resolveBillingCycleOffset(
    { billingCadence: "monthly", billingCycleAnchorDate: day("2026-07-01"), createdAt: null },
    day("2026-07-10"),
    -1,
  ).cycleStart.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(cycleFromNextRenewal({ nextRenewalDate: day("2026-08-01"), billingCadence: "monthly" }).toISOString(), "2026-07-01T00:00:00.000Z");
  assert.deepEqual(cycleToJson({ ...beforeAnchor, cycleStart: day("2026-05-15"), cycleEnd: day("2026-06-15"), nextRenewalDate: day("2026-06-15") }), {
    cycleStart: "2026-05-15",
    cycleEnd: "2026-06-15",
    nextRenewalDate: "2026-06-15",
    elapsedPercent: beforeAnchor.elapsedPercent,
    remainingDays: beforeAnchor.remainingDays,
    totalDays: beforeAnchor.totalDays,
  });
});

test("current and offset billing cycles use the same elapsed and remaining-day semantics", () => {
  const cases = [
    { billingCadence: "monthly", billingCycleAnchorDate: day("2026-07-01"), billingCycleDays: null, createdAt: null, now: day("2026-07-10") },
    { billingCadence: "annual", billingCycleAnchorDate: day("2025-07-08"), billingCycleDays: null, createdAt: null, now: day("2026-01-01") },
    { billingCadence: "weekly", billingCycleAnchorDate: day("2026-07-01"), billingCycleDays: null, createdAt: null, now: day("2026-07-10") },
    { billingCadence: "custom", billingCycleAnchorDate: day("2026-07-01"), billingCycleDays: 10, createdAt: null, now: day("2026-07-23") },
    { billingCadence: "monthly", billingCycleAnchorDate: day("2026-07-15"), billingCycleDays: null, createdAt: null, now: day("2026-06-01") },
  ];

  for (const input of cases) {
    const current = resolveBillingCycle(input, input.now);
    assert.deepEqual(resolveBillingCycleOffset(input, input.now, 0), current);

    for (const cycle of [current, resolveBillingCycleOffset(input, input.now, -1), resolveBillingCycleOffset(input, input.now, 1)]) {
      const totalDays = Math.max(1, Math.round((cycle.cycleEnd.getTime() - cycle.cycleStart.getTime()) / 86_400_000));
      const elapsedDays = Math.min(
        totalDays,
        Math.max(0, Math.floor((input.now.getTime() - cycle.cycleStart.getTime()) / 86_400_000) + 1),
      );
      assert.equal(cycle.totalDays, totalDays);
      assert.equal(cycle.elapsedPercent, elapsedDays / totalDays);
      assert.equal(cycle.remainingDays, Math.max(0, Math.ceil((cycle.cycleEnd.getTime() - input.now.getTime()) / 86_400_000)));
      assert.equal(cycle.nextRenewalDate.getTime(), cycle.cycleEnd.getTime());
    }
  }
});

test("pricing estimation handles model precedence, cache semantics, and row aggregation", () => {
  assert.equal(estimateCost("default", 1_000_000, 2_000_000), 22.5);
  assert.equal(estimateCost("composer-2.5", 1_000_000, 500_000, 250_000, 1_000_000), 1.675);
  assert.equal(estimateCost("composer-2.5-fast", 1_000_000, 500_000), 10.5);
  assert.equal(estimateCost("cursor-grok-4.5-high-fast", 1_000_000, 1_000_000), 22);
  assert.equal(estimateCost("grok-4.5", 1_000_000, 1_000_000), 8);
  assert.equal(estimateCost("claude-sonnet-4", 1_000_000, 500_000, 250_000, 1_000_000, "claude"), 14.325);
  assert.equal(estimateCost("unknown-model", 0, 0, 0, 0), 0);
  assert.equal(estimateCostFromRows([
    { model: "composer-2.5", input: 1_000_000, output: 500_000, cacheRead: 250_000 },
    { model: null, input: BigInt(0), output: BigInt(0) },
  ]), 1.675);
});

test("usage date helpers preserve inclusive boundaries and degenerate windows", () => {
  const now = day("2026-07-16");
  const oneDay = usageWindowDays(1, now);
  assert.equal(oneDay.from.toISOString(), oneDay.to.toISOString());
  assert.equal(oneDay.toExclusive.toISOString(), "2026-07-17T00:00:00.000Z");
  assert.equal(usageExclusiveEnd(now).toISOString(), "2026-07-17T00:00:00.000Z");
  assert.deepEqual(usageDayFilterInclusive(day("2026-07-10"), now), { gte: day("2026-07-10"), lte: now });
  assert.equal(inclusiveDayCount(day("2026-07-20"), day("2026-07-10")), 1);
  assert.equal(utcDateOnly() instanceof Date, true);
  assert.equal(usageInclusiveEnd() instanceof Date, true);
  assert.equal(usageExclusiveEnd() instanceof Date, true);
});

test("subscription commitment excludes invalid seats and reports partial observation windows", () => {
  const base = {
    billingCadence: "monthly",
    billingCycleAnchorDate: day("2026-07-01"),
    billingCycleDays: null,
    cycleSeatMicros: BigInt(20_000_000),
    seatCount: 2,
    startDate: day("2026-07-01"),
    endDate: null,
  };
  assert.equal(subscriptionActiveInPeriod({ ...base, seatCount: 0 }, day("2026-07-01"), day("2026-07-31")), false);
  assert.equal(subscriptionActiveInPeriod({ ...base, cycleSeatMicros: BigInt(-1) }, day("2026-07-01"), day("2026-07-31")), false);
  assert.equal(subscriptionActiveInPeriod({ ...base, endDate: day("2026-07-01") }, day("2026-07-01"), day("2026-07-31")), false);
  assert.equal(subscriptionActiveInPeriod({ ...base, seatCount: 1, cycleSeatMicros: BigInt(-1) }, day("2026-07-01"), day("2026-07-31")), false);
  assert.equal(subscriptionActiveInPeriod({ ...base, endDate: day("2026-08-01") }, day("2026-07-01"), day("2026-07-31")), true);
  assert.equal(computeActualSpend({ subscriptions: [base], from: day("2026-07-01"), to: day("2026-07-31"), now: day("2026-07-15") }).total, 40);
  assert.deepEqual(observationCoverage({ rangeDays: 30, daysWithActivity: 2, firstActivityDate: "2026-07-10", from: day("2026-07-01") }), {
    rangeDays: 30,
    daysWithActivity: 2,
    firstActivityDate: "2026-07-10",
    partialWindow: true,
  });
  assert.equal(observationCoverage({ rangeDays: 7, daysWithActivity: 7, firstActivityDate: null, from: day("2026-07-01") }).partialWindow, false);
});

test("dashboard rolling-period preferences normalize, deduplicate, and remove saved ranges", () => {
  window.localStorage.clear();
  assert.deepEqual(readRollingPeriodPrefs(), { active: DEFAULT_ROLLING_PERIOD, saved: [] });
  window.localStorage.setItem(DASHBOARD_PERIOD_STORAGE_KEY, "not-json");
  assert.deepEqual(readRollingPeriodPrefs(), { active: DEFAULT_ROLLING_PERIOD, saved: [] });

  window.localStorage.setItem(DASHBOARD_PERIOD_STORAGE_KEY, JSON.stringify({
    active: { kind: "preset", days: 60 },
    saved: [{ kind: "custom", from: "bad", to: "bad" }, { kind: "custom", from: "2026-07-01", to: "2026-07-02" }],
  }));
  assert.deepEqual(readRollingPeriodPrefs().active, DEFAULT_ROLLING_PERIOD);
  assert.equal(readRollingPeriodPrefs().saved.length, 1);

  const custom = { kind: "custom" as const, id: "custom:2026-07-01:2026-07-03", from: "2026-07-01", to: "2026-07-03" };
  window.localStorage.clear();
  assert.deepEqual(setActiveRollingPeriod(custom), { active: custom, saved: [custom] });
  assert.deepEqual(setActiveRollingPeriod(custom).saved, [custom]);
  assert.deepEqual(removeSavedRollingPeriod(custom.id), { active: DEFAULT_ROLLING_PERIOD, saved: [] });
  assert.deepEqual(setActiveRollingPeriod({ kind: "preset", days: 14 }), {
    active: { kind: "preset", days: 14 },
    saved: [],
  });
  assert.deepEqual(removeSavedRollingPeriod("missing"), {
    active: { kind: "preset", days: 14 },
    saved: [],
  });
});

function session(input: Partial<SignalsSessionRow> & Pick<SignalsSessionRow, "id" | "developerId" | "startedAt">): SignalsSessionRow {
  return {
    id: input.id,
    developerId: input.developerId,
    startedAt: input.startedAt,
    aiTool: input.aiTool ?? "cursor",
    appBefore: input.appBefore ?? "Chrome",
    domainBefore: input.domainBefore ?? "github.com",
    appAfter: input.appAfter ?? "Slack",
    domainAfter: input.domainAfter ?? "slack.com",
    flowSignature: input.flowSignature ?? "",
    durationSeconds: input.durationSeconds ?? 120,
    confidence: input.confidence ?? 0.9,
    steps: input.steps ?? [],
    developer: input.developer ?? { name: input.developerId, email: `${input.developerId}@example.com` },
  };
}

test("Signals rollups deduplicate people, retain empty weeks, and compare prior periods", () => {
  const current = [
    session({ id: "s1", developerId: "d1", startedAt: day("2026-07-13"), durationSeconds: 120 }),
    session({ id: "s2", developerId: "d1", startedAt: day("2026-07-14"), durationSeconds: 180 }),
    session({ id: "s3", developerId: "d2", startedAt: day("2026-07-20"), aiTool: "chatgpt", durationSeconds: 60 }),
  ];
  const prior = [session({ id: "p1", developerId: "d1", startedAt: day("2026-07-06"), durationSeconds: 60 })];
  const journeys = aggregateJourneys(current);
  const tools = aggregateTools(current);
  assert.equal(journeys[0]?.sessions, 2);
  assert.equal(journeys[0]?.people.size, 1);
  assert.equal(tools.find((row) => row.tool === "cursor")?.durationSeconds, 300);
  assert.equal(toJourneyRows(journeys, aggregateJourneys(prior))[0]?.changePercent, 100);
  assert.equal(toToolRows(tools, aggregateTools(prior)).find((row) => row.tool === "cursor")?.sharePercent, 67);
  assert.deepEqual(summarizeWindow([]), { sessions: 0, activePeople: 0, durationSeconds: 0, averageDurationSeconds: 0 });

  const trend = buildWeeklyTrend(current, { from: day("2026-07-13"), to: day("2026-07-31") });
  assert.ok(trend.some((point) => point.date === "2026-07-27" && point.sessions === 0));
  const daily = buildDailyTrend(current, { from: day("2026-07-13"), to: day("2026-07-16") });
  assert.equal(daily.find((point) => point.date === "2026-07-13")?.sessions, 1);
  assert.equal(daily.find((point) => point.date === "2026-07-14")?.sessions, 1);
  assert.equal(daily.find((point) => point.date === "2026-07-15")?.sessions, 0);
  assert.equal(daily.find((point) => point.date === "2026-07-16")?.sessions, 0);
  const summary = compatibilitySummaryFromSessions(30, current, prior);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.activeDevelopers, 2);
  assert.equal(summary.recentSessions[0]?.id, "s1");

  const tieJourneys = aggregateJourneys([
    session({ id: "j1", developerId: "d1", startedAt: day("2026-07-14") }),
    session({ id: "j2", developerId: "d2", startedAt: day("2026-07-14") }),
    session({
      id: "j3",
      developerId: "d3",
      startedAt: day("2026-07-14"),
      domainBefore: "linear.app",
      domainAfter: "github.com",
    }),
  ]);
  assert.equal(toJourneyRows(tieJourneys, [])[0]?.people, 2);

  const tieTools = aggregateTools([
    session({ id: "t1", developerId: "d1", startedAt: day("2026-07-14"), aiTool: "cursor" }),
    session({ id: "t2", developerId: "d2", startedAt: day("2026-07-14"), aiTool: "cursor" }),
    session({ id: "t3", developerId: "d3", startedAt: day("2026-07-14"), aiTool: "codex" }),
  ]);
  assert.equal(toToolRows(tieTools, [])[0]?.people, 2);
  assert.equal(
    buildDailyTrendPoints([{ at: day("2026-07-14"), personId: "d1" }])[0]?.durationSeconds,
    0,
  );
});

test("Signals flow keys and windows are stable for generated and invalid routes", () => {
  const generated = flowKeyFromSession({ domainBefore: "github.com", appBefore: "Chrome", aiTool: "Cursor", domainAfter: "slack.com", appAfter: "Slack" });
  assert.equal(generated, "github.com__cursor__slack.com");
  assert.deepEqual(parseFlowKey(generated), { before: "github.com", aiTool: "cursor", after: "slack.com" });
  assert.equal(parseFlowKey("bad"), null);
  assert.equal(parseFlowKey("%E0%A4%A__cursor__slack.com"), null);
  assert.equal(sessionMatchesFlowKey({ domainBefore: "github.com", appBefore: null, aiTool: "Cursor", domainAfter: "slack.com", appAfter: null }, generated), true);
  assert.equal(sessionMatchesFlowKey({ domainBefore: "github.com", appBefore: null, aiTool: "Claude", domainAfter: "slack.com", appAfter: null }, generated), false);
  assert.equal(signalsFlow({ domainBefore: null, appBefore: null, aiTool: "Cursor", domainAfter: null, appAfter: null }), "unknown -> Cursor -> unknown");

  const windows = resolveSignalsWindows(
    { days: 7, developerId: "d1", teamId: "t1", tool: "cursor" } as {
      days: number;
      developerId: string;
      teamId?: string;
      tool: string;
    },
    day("2026-07-16"),
  );
  assert.equal(windows.windowDays, 7);
  assert.deepEqual(windows.filters, { developerId: "d1", tool: "cursor" });
  assert.equal(windows.current.from.toISOString(), "2026-07-10T00:00:00.000Z");
  assert.equal(windows.prior.to.toISOString(), "2026-07-09T23:59:59.999Z");
  assert.equal(resolveSignalsWindows({}, day("2026-07-16")).windowDays, 30);
});

test("quota formatters cover recognized, fallback, date, and empty values", () => {
  assert.equal(quotaWindowLabel("seven_day"), "Weekly");
  assert.equal(quotaWindowLabel("custom_window"), "custom window");
  assert.equal(quotaResetLabel(new Date("2026-07-20T14:30:00Z")), "resets Jul 20, 2:30 PM UTC");
  assert.equal(quotaResetLabel("invalid"), null);
  assert.equal(quotaResetLabel(null), null);
});

test("small Signals aggregate helpers cover empty and Sunday boundaries", () => {
  assert.equal(median([]), 0);
  assert.equal(startOfUtcWeek(day("2026-07-19")), "2026-07-13");
});

beforeEach(() => window.localStorage.clear());
