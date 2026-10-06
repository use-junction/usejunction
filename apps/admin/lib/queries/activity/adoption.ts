import { prisma } from "@usejunction/db";
import type { MetricWindow } from "@/lib/analytics/contracts/time-window";
import { canonicalToolKey } from "@/lib/tools/catalog";

/**
 * Adoption = who uses AI tools, how regularly, and who has not started.
 * Presence only: a day counts when a person has any AI-tool usage that day.
 * Volume (requests, tokens, cost) is deliberately absent so this never becomes a leaderboard.
 */

export type AdoptionBand = "regular" | "occasional" | "not_started" | "no_data";
export type AdoptionCell = "active" | "inactive" | "before" | "no_data";

export type AdoptionPerson = {
  id: string;
  name: string;
  band: AdoptionBand;
  /** Band in the previous window of the same length; null when they were not enrolled yet. */
  previousBand: "regular" | "occasional" | "inactive" | null;
  weeks: AdoptionCell[];
  activeDays: number;
  /** UTC days with any AI-tool use in the current window, ascending. */
  activeDates: string[];
  /** First enrolled machine (UTC day); days before it are not counted against the person. */
  enrolledAt: string;
  /** Active days per 7 eligible days, one decimal. */
  daysPerWeek: number;
  tools: string[];
  seats: Array<{ toolName: string; used: boolean }>;
  lastSeenAt: string | null;
};

export type TeamAdoption = {
  from: string;
  to: string;
  weeks: Array<{ start: string; end: string }>;
  people: AdoptionPerson[];
  notEnrolled: Array<{ id: string; name: string; seats: Array<{ toolName: string; used: boolean }> }>;
  counts: {
    members: number;
    enrolled: number;
    active: number;
    previousActive: number;
    regular: number;
    occasional: number;
    notStarted: number;
    noData: number;
  };
  tools: Array<{ toolName: string; people: number; previousPeople: number }>;
  /** Paid seats (non-zero price) whose tool saw no use this period, from people whose collection is healthy. */
  idleSeats: { count: number; cycleMicros: string; tools: Array<{ toolName: string; count: number; cycleMicros: string }> };
};

export type AdoptionInput = {
  window: { from: Date; to: Date };
  developers: Array<{
    id: string;
    name: string;
    devices: Array<{ createdAt: Date; lastSeenAt: Date; decommissionedAt: Date | null }>;
  }>;
  /** One row per developer, tool, and UTC day with any usage, covering the previous and current windows. */
  activity: Array<{ developerId: string; toolName: string; date: string }>;
  plans: Array<{ developerId: string; toolName: string; cycleSeatMicros: bigint; seatCount: number }>;
};

const DAY_MS = 86_400_000;
const MAX_WEEKS = 13;
/** Active in at least this share of eligible weeks counts as regular use. */
const REGULAR_SHARE = 0.75;

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Canonical catalog key, so aliases (e.g. codex-work) and seat names match usage rows. */
function toolKey(name: string) {
  return canonicalToolKey(name.trim().toLowerCase());
}

/** Seven-day buckets ending on the window's last day, oldest first. */
export function adoptionWeeks(from: Date, to: Date) {
  const first = startOfDay(from).getTime();
  const weeks: Array<{ start: string; end: string }> = [];
  let end = startOfDay(to).getTime();
  while (end >= first && weeks.length < MAX_WEEKS) {
    const start = Math.max(first, end - 6 * DAY_MS);
    weeks.unshift({ start: dayKey(new Date(start)), end: dayKey(new Date(end)) });
    end = start - DAY_MS;
  }
  return weeks;
}

function bandFor(activeWeeks: number, eligibleWeeks: number): "regular" | "occasional" | "inactive" {
  if (activeWeeks === 0) return "inactive";
  if (eligibleWeeks >= 2 && activeWeeks >= Math.ceil(eligibleWeeks * REGULAR_SHARE)) return "regular";
  return "occasional";
}

export function buildTeamAdoption(input: AdoptionInput): TeamAdoption {
  const from = startOfDay(input.window.from);
  const to = startOfDay(input.window.to);
  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  const previousTo = new Date(from.getTime() - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (spanDays - 1) * DAY_MS);
  const weeks = adoptionWeeks(from, to);
  const previousWeeks = adoptionWeeks(previousFrom, previousTo);
  const fromKey = dayKey(from);
  const toKey = dayKey(to);
  const previousFromKey = dayKey(previousFrom);

  const daysByPerson = new Map<string, { current: Set<string>; previous: Set<string>; tools: Map<string, string>; previousTools: Set<string> }>();
  for (const row of input.activity) {
    if (row.date < previousFromKey || row.date > toKey) continue;
    const entry = daysByPerson.get(row.developerId) ?? { current: new Set(), previous: new Set(), tools: new Map(), previousTools: new Set() };
    if (row.date >= fromKey) {
      entry.current.add(row.date);
      if (row.toolName) entry.tools.set(toolKey(row.toolName), toolKey(row.toolName));
    } else {
      entry.previous.add(row.date);
      if (row.toolName) entry.previousTools.add(toolKey(row.toolName));
    }
    daysByPerson.set(row.developerId, entry);
  }

  const plansByPerson = new Map<string, AdoptionInput["plans"]>();
  for (const plan of input.plans) {
    // Free plans (student, trial, bundled) cost nothing, so they are never an unused paid seat.
    if (plan.cycleSeatMicros <= 0n) continue;
    plansByPerson.set(plan.developerId, [...(plansByPerson.get(plan.developerId) ?? []), plan]);
  }

  const people: AdoptionPerson[] = [];
  const notEnrolled: TeamAdoption["notEnrolled"] = [];
  const toolPeople = new Map<string, { name: string; people: number; previousPeople: number }>();
  const idleByTool = new Map<string, { toolName: string; count: number; micros: bigint }>();
  let previousActive = 0;

  for (const developer of input.developers) {
    const devices = developer.devices.filter((device) => !device.decommissionedAt && device.createdAt <= input.window.to);
    const usage = daysByPerson.get(developer.id);
    const currentTools = usage?.tools ?? new Map<string, string>();
    const seatsFor = (countable: boolean) =>
      (plansByPerson.get(developer.id) ?? []).map((plan) => {
        const used = currentTools.has(toolKey(plan.toolName));
        if (countable && !used) {
          const entry = idleByTool.get(toolKey(plan.toolName)) ?? { toolName: toolKey(plan.toolName), count: 0, micros: 0n };
          entry.count += Math.max(1, plan.seatCount);
          entry.micros += plan.cycleSeatMicros * BigInt(Math.max(1, plan.seatCount));
          idleByTool.set(toolKey(plan.toolName), entry);
        }
        return { toolName: toolKey(plan.toolName), used };
      });

    for (const key of usage?.previousTools ?? []) {
      const entry = toolPeople.get(key) ?? { name: key, people: 0, previousPeople: 0 };
      entry.previousPeople += 1;
      toolPeople.set(key, entry);
    }
    if (usage?.previous.size) previousActive += 1;

    if (!devices.length && !usage?.current.size) {
      notEnrolled.push({ id: developer.id, name: developer.name, seats: seatsFor(false) });
      continue;
    }

    const enrolledAt = devices.length
      ? dayKey(new Date(Math.min(...devices.map((device) => device.createdAt.getTime()))))
      : fromKey;
    const lastSeen = devices.length ? new Date(Math.max(...devices.map((device) => device.lastSeenAt.getTime()))) : null;
    const current = usage?.current ?? new Set<string>();
    const reporting = current.size > 0 || (lastSeen !== null && lastSeen >= from);
    const band: AdoptionBand = !reporting ? "no_data" : (() => {
      const eligible = weeks.filter((week) => week.end >= enrolledAt);
      const active = eligible.filter((week) => [...current].some((day) => day >= week.start && day <= week.end));
      const result = bandFor(active.length, eligible.length);
      return result === "inactive" ? "not_started" : result;
    })();

    const cells: AdoptionCell[] = weeks.map((week) => {
      if (week.end < enrolledAt) return "before";
      if (band === "no_data") return "no_data";
      return [...current].some((day) => day >= week.start && day <= week.end) ? "active" : "inactive";
    });

    const previousEligible = previousWeeks.filter((week) => week.end >= enrolledAt);
    const previousBand = previousEligible.length
      ? bandFor(
        previousEligible.filter((week) => [...(usage?.previous ?? [])].some((day) => day >= week.start && day <= week.end)).length,
        previousEligible.length,
      )
      : null;

    const eligibleDays = Math.max(1, Math.round((to.getTime() - Math.max(from.getTime(), Date.parse(enrolledAt))) / DAY_MS) + 1);
    for (const [key, name] of currentTools) {
      const entry = toolPeople.get(key) ?? { name, people: 0, previousPeople: 0 };
      entry.name = name;
      entry.people += 1;
      toolPeople.set(key, entry);
    }

    people.push({
      id: developer.id,
      name: developer.name,
      band,
      previousBand,
      weeks: cells,
      activeDays: current.size,
      activeDates: [...current].sort(),
      enrolledAt,
      daysPerWeek: Math.round((current.size / eligibleDays) * 70) / 10,
      tools: [...currentTools.values()].sort((a, b) => a.localeCompare(b)),
      seats: seatsFor(band !== "no_data"),
      lastSeenAt: lastSeen?.toISOString() ?? null,
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name));
  notEnrolled.sort((a, b) => a.name.localeCompare(b.name));
  const count = (band: AdoptionBand) => people.filter((person) => person.band === band).length;

  return {
    from: fromKey,
    to: toKey,
    weeks,
    people,
    notEnrolled,
    counts: {
      members: input.developers.length,
      enrolled: people.length,
      active: people.filter((person) => person.activeDays > 0).length,
      previousActive,
      regular: count("regular"),
      occasional: count("occasional"),
      notStarted: count("not_started"),
      noData: count("no_data"),
    },
    tools: [...toolPeople.values()]
      .filter((tool) => tool.people > 0 || tool.previousPeople > 0)
      .map((tool) => ({ toolName: tool.name, people: tool.people, previousPeople: tool.previousPeople }))
      .sort((a, b) => b.people - a.people || a.toolName.localeCompare(b.toolName)),
    idleSeats: {
      count: [...idleByTool.values()].reduce((sum, tool) => sum + tool.count, 0),
      cycleMicros: [...idleByTool.values()].reduce((sum, tool) => sum + tool.micros, 0n).toString(),
      tools: [...idleByTool.values()]
        .sort((a, b) => (b.micros > a.micros ? 1 : b.micros < a.micros ? -1 : a.toolName.localeCompare(b.toolName)))
        .map((tool) => ({ toolName: tool.toolName, count: tool.count, cycleMicros: tool.micros.toString() })),
    },
  };
}

/** Billing-cycle windows run past today; weeks that have not happened yet must not read as "no use". */
export function clampAdoptionWindow(window: { from: Date; to: Date }, now: Date) {
  const to = startOfDay(window.to > now ? now : window.to);
  const from = startOfDay(window.from);
  return { from: from > to ? to : from, to };
}

export async function getTeamAdoption(orgId: string, window: MetricWindow, now: Date = new Date()): Promise<TeamAdoption> {
  const { from, to } = clampAdoptionWindow(window, now);
  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  const previousFrom = new Date(from.getTime() - spanDays * DAY_MS);

  const [developers, activity, plans] = await Promise.all([
    prisma.developer.findMany({
      where: { orgId, removedAt: null },
      select: {
        id: true,
        name: true,
        devices: { select: { createdAt: true, lastSeenAt: true, decommissionedAt: true } },
      },
    }),
    prisma.$queryRaw<Array<{ developerId: string; toolName: string; date: string }>>`
      SELECT developer_id AS "developerId", tool_name AS "toolName", to_char(date, 'YYYY-MM-DD') AS date
      FROM usage_daily
      WHERE org_id = ${orgId}
        AND developer_id IS NOT NULL
        AND date >= ${dayKey(previousFrom)}::date
        AND date <= ${dayKey(to)}::date
        AND metric_kind <> 'productivity'
        AND source NOT IN ('cursor_local', 'opencode_local')
        AND (requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0 OR active_seconds > 0)
      GROUP BY developer_id, tool_name, date
    `,
    prisma.developerPlanAssignment.findMany({
      where: {
        orgId,
        active: true,
        seatStatus: "active",
        cycleSeatMicros: { gt: 0n },
        startDate: { lte: to },
        OR: [{ endDate: null }, { endDate: { gte: from } }],
      },
      select: { developerId: true, toolName: true, cycleSeatMicros: true, seatCount: true },
    }),
  ]);

  return buildTeamAdoption({ window: { from, to }, developers, activity, plans });
}
