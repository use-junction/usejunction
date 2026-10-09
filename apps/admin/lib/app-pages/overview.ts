import { prisma } from "@usejunction/db";
import type { AppPrincipal } from "@/lib/api/app-auth";
import { jsonSafe } from "@/lib/api/app-response";
import { UTC_TIMEZONE } from "@/lib/analytics/contracts/time-window";
import { monthlyMicros, unassignedSeats } from "@/lib/billing/monthly";
import { getTeamAdoption, type TeamAdoption } from "@/lib/queries/activity/adoption";
import { getOrgDeviceSyncStatus } from "@/lib/queries/team/device-syncs";
import { getCostOverview, getUnseatedUsers, idleSeatMicros, SIGNAL_DAYS, type CostOverview } from "@/lib/queries/tools/cost-overview";
import { reportNow } from "@/lib/report-now";
import { listTeams, NO_TEAM, resolveTeamFilter, type TeamSummary } from "@/lib/teams";
import { usageByDay, usageByDeveloper } from "@/lib/teams/usage";
import { listSubscriptions } from "@/lib/tools/subscriptions";
import { canonicalToolKey, toolDisplayName } from "@/lib/tools/catalog";

/**
 * Overview answers the buyer's five-minute questions on one screen:
 * what are we paying, who is using it, what is idle, is everyone connected, and what to do next.
 * Every figure is read through the same queries as the page it links to, so they never disagree.
 */

const DAY_MS = 86_400_000;
const TREND_MONTHS = 6;

export type OverviewAction = {
  key: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  /** Monthly saving when the action frees money. */
  savingsMicros: string | null;
  tone: "money" | "people" | "fleet";
};

export type OverviewTeamRow = {
  id: string;
  name: string;
  color: string | null;
  people: number;
  active: number;
  seatsMonthlyMicros: string;
  idleMonthlyMicros: string;
  usageMonthToDateMicros: string;
};

export type OverviewPayload = {
  team: { id: string; name: string } | null;
  teams: TeamSummary[];
  canManageTeams: boolean;
  month: CostOverview["month"];
  spend: {
    monthlyTotalMicros: string;
    seatsMonthlyMicros: string;
    payAsYouGoToDateMicros: string;
    payAsYouGoProjectedMicros: string | null;
    usageValueWithinPlansMicros: string;
    totalIsEstimate: boolean;
  };
  idle: { micros: string; seats: number };
  adoption: {
    windowDays: number;
    active: number;
    enrolled: number;
    members: number;
    notEnrolled: number;
    notStarted: number;
    noData: number;
    previousActive: number;
  };
  fleet: { machines: number; online: number; stale: number; needsRepair: number; needsUpdate: number };
  actions: OverviewAction[];
  trend: Array<{ month: string; label: string; usageMicros: string; partial: boolean }>;
  /** Usage at API prices per day of the current month, day 1 through today. */
  daily: Array<{ date: string; usageMicros: string }>;
  byTeam: OverviewTeamRow[];
};

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function calendarMonth(today: Date): CostOverview["month"] {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  return { from: dayKey(from), to: dayKey(today), daysElapsed: today.getUTCDate(), daysInMonth };
}

/**
 * Usage at API prices per calendar month, oldest first (the current month is partial),
 * plus each day of the current month through today. One query feeds both.
 */
async function usageTrend(orgId: string, developerIds: string[] | null, today: Date) {
  const firstMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (TREND_MONTHS - 1), 1));
  const months = Array.from({ length: TREND_MONTHS }, (_, index) => {
    const start = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1));
    return {
      month: dayKey(start).slice(0, 7),
      label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      usageMicros: 0n,
      partial: index === TREND_MONTHS - 1,
    };
  });
  const byMonth = new Map(months.map((row) => [row.month, row]));
  const days = await usageByDay(orgId, { from: firstMonth, to: today }, developerIds);
  for (const [day, micros] of days) {
    const entry = byMonth.get(day.slice(0, 7));
    if (entry) entry.usageMicros += micros;
  }
  const daily = Array.from({ length: today.getUTCDate() }, (_, index) => {
    const date = dayKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), index + 1)));
    return { date, usageMicros: days.get(date) ?? 0n };
  });
  return { months, daily };
}

function buildActions(input: {
  cost: CostOverview | null;
  adoption: TeamAdoption;
  fleet: OverviewPayload["fleet"];
  idleMicros: bigint;
  idleSeats: number;
}): OverviewAction[] {
  const actions: OverviewAction[] = [];
  const { cost, adoption, fleet } = input;
  if (input.idleMicros > 0n) {
    actions.push({
      key: "idle-seats",
      title: `Reclaim or cancel ${input.idleSeats} idle ${input.idleSeats === 1 ? "seat" : "seats"}`,
      detail: `No use in the last ${SIGNAL_DAYS} days, or assigned to no one.`,
      href: "/tools",
      cta: "Review in Cost",
      savingsMicros: input.idleMicros.toString(),
      tone: "money",
    });
  }
  for (const change of cost?.changes ?? []) {
    if (!change.toolKey) continue;
    const tool = toolDisplayName(change.toolKey);
    if (change.kind === "hitting_limits") {
      actions.push({ key: `limit-${change.toolKey}`, title: `${tool} is hitting its plan limit`, detail: change.text, href: `/tools/${change.toolKey}`, cta: "Open tool", savingsMicros: null, tone: "money" });
    } else if (change.kind === "past_allowance") {
      actions.push({ key: `allowance-${change.toolKey}`, title: `${tool} is past its included allowance`, detail: "Extra usage may be billed on top of seats.", href: `/tools/${change.toolKey}`, cta: "Open tool", savingsMicros: null, tone: "money" });
    } else if (change.kind === "annual_renewal") {
      actions.push({ key: `renewal-${change.toolKey}-${change.text}`, title: `${tool}: ${change.text}`, detail: "Decide seat count before it renews.", href: `/tools/${change.toolKey}`, cta: "Open tool", savingsMicros: null, tone: "money" });
    }
  }
  if (adoption.counts.notStarted > 0) {
    actions.push({
      key: "not-started",
      title: `${adoption.counts.notStarted} ${adoption.counts.notStarted === 1 ? "person hasn't" : "people haven't"} used AI in ${SIGNAL_DAYS} days`,
      detail: "Their machine reports, but no AI-tool days.",
      href: "/activity",
      cta: "See who",
      savingsMicros: null,
      tone: "people",
    });
  }
  if (adoption.notEnrolled.length > 0) {
    actions.push({
      key: "not-enrolled",
      title: `${adoption.notEnrolled.length} ${adoption.notEnrolled.length === 1 ? "person has" : "people have"} no machine connected`,
      detail: "Their usage and seats can't be measured yet.",
      href: "/activity",
      cta: "Send setup",
      savingsMicros: null,
      tone: "people",
    });
  }
  if (fleet.needsUpdate > 0) {
    actions.push({
      key: "agent-update",
      title: `${fleet.needsUpdate} ${fleet.needsUpdate === 1 ? "machine needs" : "machines need"} an agent update`,
      detail: "Older agents can't take remote sync requests.",
      href: "/team?tab=fleet",
      cta: "Open Fleet",
      savingsMicros: null,
      tone: "fleet",
    });
  }
  if (fleet.needsRepair + fleet.stale > 0) {
    const count = fleet.needsRepair + fleet.stale;
    actions.push({
      key: "fleet-stale",
      title: `${count} ${count === 1 ? "machine has" : "machines have"} stopped reporting`,
      detail: fleet.needsRepair ? `${fleet.needsRepair} need a repair.` : "No recent heartbeat.",
      href: "/team?tab=fleet",
      cta: "Open Fleet",
      savingsMicros: null,
      tone: "fleet",
    });
  }
  return actions;
}

async function teamRollup(orgId: string, teams: TeamSummary[], adoption: TeamAdoption, today: Date): Promise<OverviewTeamRow[]> {
  if (!teams.length) return [];
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const [people, assignments, usage] = await Promise.all([
    prisma.developer.findMany({ where: { orgId, removedAt: null }, select: { id: true, teamId: true } }),
    prisma.developerPlanAssignment.findMany({
      where: { orgId, active: true, seatStatus: "active", cycleSeatMicros: { gt: 0n } },
      select: { developerId: true, toolName: true, cycleSeatMicros: true, seatCount: true, billingCadence: true, billingCycleDays: true },
    }),
    usageByDeveloper(orgId, { from: monthStart, to: today }),
  ]);
  const adoptionById = new Map(adoption.people.map((person) => [person.id, person]));
  const rows = new Map<string, OverviewTeamRow>();
  const rowFor = (teamId: string | null) => {
    const key = teamId ?? NO_TEAM;
    const team = teams.find((item) => item.id === teamId);
    const row = rows.get(key) ?? {
      id: key,
      name: team?.name ?? "No team",
      color: team?.color ?? null,
      people: 0,
      active: 0,
      seatsMonthlyMicros: "0",
      idleMonthlyMicros: "0",
      usageMonthToDateMicros: "0",
    };
    rows.set(key, row);
    return row;
  };
  for (const team of teams) rowFor(team.id);
  const teamOf = new Map(people.map((person) => [person.id, person.teamId]));
  for (const person of people) {
    const row = rowFor(person.teamId);
    row.people += 1;
    if ((adoptionById.get(person.id)?.activeDays ?? 0) > 0) row.active += 1;
    row.usageMonthToDateMicros = (BigInt(row.usageMonthToDateMicros) + (usage.get(person.id)?.costMicros ?? 0n)).toString();
  }
  for (const seat of assignments) {
    if (!teamOf.has(seat.developerId)) continue;
    const row = rowFor(teamOf.get(seat.developerId) ?? null);
    const monthly = monthlyMicros(seat.cycleSeatMicros * BigInt(Math.max(1, seat.seatCount)), seat.billingCadence, seat.billingCycleDays);
    row.seatsMonthlyMicros = (BigInt(row.seatsMonthlyMicros) + monthly).toString();
    // Same rule as Adoption's idle seats: only people whose collection is healthy count as idle.
    const person = adoptionById.get(seat.developerId);
    const idle = person && person.band !== "no_data" && person.seats.some((item) => item.toolName === canonicalToolKey(seat.toolName) && !item.used);
    if (idle) row.idleMonthlyMicros = (BigInt(row.idleMonthlyMicros) + monthly).toString();
  }
  return [...rows.values()]
    .filter((row) => row.people > 0 || row.id !== NO_TEAM)
    .sort((a, b) => (a.id === NO_TEAM ? 1 : b.id === NO_TEAM ? -1 : a.name.localeCompare(b.name)));
}

export async function loadOverviewPage(principal: AppPrincipal, search: { team?: string | null } = {}): Promise<OverviewPayload> {
  const now = reportNow();
  const today = startOfDay(now);
  const signalStart = new Date(today.getTime() - (SIGNAL_DAYS - 1) * DAY_MS);
  const [subscriptions, teams, scope] = await Promise.all([
    listSubscriptions(principal.orgId),
    listTeams(principal.orgId),
    resolveTeamFilter(principal.orgId, search.team),
  ]);
  const developerIds = scope?.developerIds;
  const window = { from: signalStart, to: today, timezone: UTC_TIMEZONE, grain: "day" as const };
  const unseated = developerIds ? undefined : await getUnseatedUsers(principal.orgId, now);

  const [cost, adoption, orgAdoption, syncs, trend] = await Promise.all([
    getCostOverview(principal.orgId, subscriptions, now, { developerIds }).catch(() => null),
    getTeamAdoption(principal.orgId, window, now, {
      developerIds,
      unassignedSeats: developerIds ? undefined : unassignedSeats(subscriptions, (plan) => canonicalToolKey(plan.toolKey ?? plan.toolName), unseated),
    }),
    // The team table always compares every team, whatever the filter.
    developerIds ? getTeamAdoption(principal.orgId, window, now) : Promise.resolve(null),
    getOrgDeviceSyncStatus(principal.orgId, now),
    usageTrend(principal.orgId, developerIds ?? null, today),
  ]);

  const inScope = developerIds ? new Set(developerIds) : null;
  const devices = syncs.devices.filter((device) => !inScope || inScope.has(device.developer.id));
  const fleet = {
    machines: devices.length,
    online: devices.filter((device) => device.status === "online").length,
    stale: devices.filter((device) => device.status === "stale" || device.status === "never_synced").length,
    needsRepair: devices.filter((device) => device.status === "repair_required").length,
    needsUpdate: devices.filter((device) => device.remoteSyncProtocol < 1).length,
  };
  const idleMicros = cost ? idleSeatMicros(cost) : 0n;
  const idleSeats = adoption.idleSeats.count + adoption.unassignedSeats.count;

  return jsonSafe({
    team: scope ? { id: scope.teamId, name: scope.name } : null,
    teams,
    canManageTeams: principal.role === "owner" || principal.role === "admin",
    month: cost?.month ?? calendarMonth(today),
    spend: {
      monthlyTotalMicros: cost?.totals.monthlyTotalMicros ?? "0",
      seatsMonthlyMicros: cost?.totals.seatsMonthlyMicros ?? "0",
      payAsYouGoToDateMicros: cost?.totals.payAsYouGoToDateMicros ?? "0",
      payAsYouGoProjectedMicros: cost?.totals.payAsYouGoProjectedMicros ?? null,
      usageValueWithinPlansMicros: cost?.totals.usageValueWithinPlansToDateMicros ?? "0",
      totalIsEstimate: cost?.totals.totalIsEstimate ?? false,
    },
    idle: { micros: idleMicros.toString(), seats: idleMicros > 0n ? idleSeats : 0 },
    adoption: {
      windowDays: SIGNAL_DAYS,
      active: adoption.counts.active,
      enrolled: adoption.counts.enrolled,
      members: adoption.counts.members,
      notEnrolled: adoption.notEnrolled.length,
      notStarted: adoption.counts.notStarted,
      noData: adoption.counts.noData,
      previousActive: adoption.counts.previousActive,
    },
    fleet,
    actions: buildActions({ cost, adoption, fleet, idleMicros, idleSeats }),
    trend: trend.months.map((row) => ({ ...row, usageMicros: row.usageMicros.toString() })),
    daily: trend.daily.map((row) => ({ ...row, usageMicros: row.usageMicros.toString() })),
    byTeam: await teamRollup(principal.orgId, teams, orgAdoption ?? adoption, today),
  });
}
