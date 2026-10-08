import type { AudienceScope } from "@/lib/audience-scope";
import type { DailyReportPayload, DailyReportSeriesPoint } from "@/lib/reports/daily-report";
import { buildWowWeekStrip, type WowDayTotals } from "@/lib/reports/wow-week-strip";
import { addLocalDays } from "@/lib/timezone";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Made-up but plausible usage per weekday, so the sample email reads like a real week. */
const CURRENT_WEEK: WowDayTotals[] = [
  { tokens: 1_240_000, cost: 18.4, requests: 212 },
  { tokens: 1_910_000, cost: 26.1, requests: 301 },
  { tokens: 1_480_000, cost: 21.7, requests: 254 },
  { tokens: 2_230_000, cost: 31.9, requests: 342 },
  { tokens: 1_620_000, cost: 23.2, requests: 268 },
  { tokens: 310_000, cost: 4.1, requests: 41 },
  { tokens: 120_000, cost: 1.6, requests: 17 },
];
const PRIOR_WEEK: WowDayTotals[] = CURRENT_WEEK.map((day) => ({
  tokens: Math.round(day.tokens * 0.82),
  cost: day.cost * 0.84,
  requests: Math.round(day.requests * 0.86),
}));

function mondayOf(localDate: string) {
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return addLocalDays(localDate, -((weekday + 6) % 7));
}

function scaled(day: WowDayTotals, factor: number): WowDayTotals {
  return { tokens: Math.round(day.tokens * factor), cost: day.cost * factor, requests: Math.round(day.requests * factor) };
}

/**
 * A sample digest for the empty Reports page: the personal daily email for "you", the team
 * weekly rollup for "team". Rendered through the real email template so it matches what lands.
 */
export function buildSampleReport(audience: AudienceScope, today = new Date()): DailyReportPayload {
  const timeZone = "UTC";
  const todayLocal = today.toISOString().slice(0, 10);
  const team = audience === "team";
  // Personal: today, part-way through the week. Team: the last full Mon–Sun week.
  const weekStart = team ? addLocalDays(mondayOf(todayLocal), -7) : mondayOf(todayLocal);
  const weekEnd = addLocalDays(weekStart, 6);
  const asOf = team ? weekEnd : todayLocal;
  const factor = team ? 6 : 1;

  const currentByDate = new Map<string, WowDayTotals>();
  const priorByDate = new Map<string, WowDayTotals>();
  const series: DailyReportSeriesPoint[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addLocalDays(weekStart, i);
    const current = date <= asOf ? scaled(CURRENT_WEEK[i], factor) : { tokens: 0, cost: 0, requests: 0 };
    currentByDate.set(date, current);
    priorByDate.set(addLocalDays(date, -7), scaled(PRIOR_WEEK[i], factor));
    series.push({ label: WEEKDAYS[i], ...current });
  }
  priorByDate.set(addLocalDays(weekStart, -1), scaled(PRIOR_WEEK[6], factor));

  const day = currentByDate.get(asOf) ?? CURRENT_WEEK[0];
  const totals = team
    ? [...currentByDate.values()].reduce(
        (sum, value) => ({
          tokens: sum.tokens + value.tokens,
          cost: sum.cost + value.cost,
          requests: sum.requests + value.requests,
        }),
        { tokens: 0, cost: 0, requests: 0 },
      )
    : day;

  return {
    kind: team ? "org" : "personal",
    period: team ? "week" : "day",
    localDate: asOf,
    ...(team ? { weekStart, weekEnd } : {}),
    timeZone,
    title: team ? "Team week." : "Your day.",
    subtitle: team ? `${weekStart} – ${weekEnd} · ${timeZone}` : `${asOf} · ${timeZone}`,
    kpis: {
      requests: totals.requests,
      tokens: totals.tokens,
      cost: totals.cost,
      tools: 3,
      requestsDeltaPct: 14,
      tokensDeltaPct: 18,
      costDeltaPct: 16,
      planUsedPercent: 46,
      acceptancePercent: 63,
    },
    plan: {
      usedPercent: 46,
      statusLabel: "Within allowance",
      withinAllowance: true,
      hint: "Usage is well within the included plan allowance",
      tools: [
        { toolName: "cursor", displayName: "Cursor", usedPercent: 52, statusLabel: "Within allowance", withinAllowance: true },
        { toolName: "claude-code", displayName: "Claude Code", usedPercent: 39, statusLabel: "Within allowance", withinAllowance: true },
      ],
    },
    series,
    wowStrip: buildWowWeekStrip({
      asOfLocalDate: asOf,
      timeZone,
      weekStart,
      weekEnd,
      currentByDate,
      priorByDate,
      topToolDisplayName: "Claude Code",
      todayPartial: !team,
    }),
    topTools: [
      { toolName: "claude-code", displayName: "Claude Code", requests: Math.round(totals.requests * 0.48), tokens: Math.round(totals.tokens * 0.55), cost: totals.cost * 0.52, sharePercent: 52, tokenSharePercent: 55 },
      { toolName: "cursor", displayName: "Cursor", requests: Math.round(totals.requests * 0.37), tokens: Math.round(totals.tokens * 0.33), cost: totals.cost * 0.36, sharePercent: 36, tokenSharePercent: 33 },
      { toolName: "chatgpt", displayName: "ChatGPT", requests: Math.round(totals.requests * 0.15), tokens: Math.round(totals.tokens * 0.12), cost: totals.cost * 0.12, sharePercent: 12, tokenSharePercent: 12 },
    ],
    ...(team ? { membersActive: 8 } : {}),
  };
}
