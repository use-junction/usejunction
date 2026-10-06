import { prisma } from "@usejunction/db";
import { UTC_TIMEZONE } from "@/lib/analytics/contracts/time-window";
import { readOrgUsageFromSnapshots } from "@/lib/analytics/snapshots";
import { normalizeBillingCadence, resolveBillingCycle } from "@/lib/billing/cycles";
import { getTeamAdoption } from "@/lib/queries/activity/adoption";
import { canonicalToolKey } from "@/lib/tools/catalog";

/**
 * The Cost page answers "what will we pay this month, and what should we change?"
 *
 * Rules the page relies on:
 * - Every plan is normalised to a monthly amount; mixed cadences are never summed raw.
 * - Usage on a tool that has a plan is shown as usage *value*, not added to the bill:
 *   vendors report what the usage is worth, not what they invoice on top of the seat.
 * - Usage on a tool with no plan is pay-as-you-go spend and is added to the bill.
 * - A projection needs at least MIN_PROJECTION_DAYS of the month; before that, show month to date only.
 * - Money follows the calendar month; behaviour (seats in use, limits, unused seats) uses the trailing
 *   SIGNAL_DAYS so early in the month a seat is not called unused after two days.
 */

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.4375;
export const MIN_PROJECTION_DAYS = 7;
export const SIGNAL_DAYS = 30;
/** A person "hits the limit" when any plan window reached this share. */
const LIMIT_HIT = 100;
const LIMIT_NEAR = 90;
const LIMIT_LIGHT = 10;

export type PriceTag = "entered" | "list";

export type CostPlan = {
  id: string;
  name: string;
  cadence: "weekly" | "monthly" | "annual" | "custom";
  seatCapacity: number;
  assignedSeats: number;
  monthlyMicros: string;
  priceTag: PriceTag;
  renewsOn: string;
  /** Full charge at renewal; differs from monthlyMicros for annual or weekly plans. */
  renewalMicros: string;
};

export type CostTool = {
  toolKey: string;
  plans: CostPlan[];
  seatsPaid: number;
  seatsAssigned: number;
  /** People with any usage of this tool in the trailing SIGNAL_DAYS. */
  activePeople: number;
  seatsMonthlyMicros: string;
  seatsPriceTag: PriceTag | "mixed" | null;
  usageToDateMicros: string;
  usageVerifiedToDateMicros: string;
  /** How usage relates to the bill. */
  usageBasis: "pay_as_you_go" | "within_plan";
  includedMonthlyMicros: string;
  /** Pay-as-you-go spend projected to month end; null before MIN_PROJECTION_DAYS. */
  projectedSpendMicros: string | null;
  limits: { measured: number; hit: number; near: number; light: number } | null;
};

export type CostChange = {
  kind: "unassigned_seats" | "unused_seats" | "past_allowance" | "hitting_limits" | "annual_renewal";
  toolKey: string | null;
  text: string;
  monthlyMicros: string | null;
  basis: string;
  href: string | null;
};

export type CostOverview = {
  month: { from: string; to: string; daysElapsed: number; daysInMonth: number };
  totals: {
    seatsMonthlyMicros: string;
    seatsHaveListPrices: boolean;
    payAsYouGoToDateMicros: string;
    payAsYouGoEstimatedToDateMicros: string;
    payAsYouGoProjectedMicros: string | null;
    previousPayAsYouGoSameDaysMicros: string;
    usageValueWithinPlansToDateMicros: string;
    /** seats + projected pay-as-you-go (or month to date before a projection is possible). */
    monthlyTotalMicros: string;
    totalIsEstimate: boolean;
  };
  tools: CostTool[];
  changes: CostChange[];
};

type PlanInput = {
  id: string;
  toolKey: string | null;
  toolName: string;
  name: string;
  billingCadence: string;
  billingCycleDays: number | null;
  billingCycleAnchorDate: Date | null;
  createdAt: Date;
  seatCapacity: number;
  assignedSeats: number;
  cycleSeatMicros: bigint;
  includedCycleMicros: bigint;
  customPrice: boolean;
  priceSource: string;
};

export type CostOverviewInput = {
  now: Date;
  plans: PlanInput[];
  usage: Array<{ toolName: string; verifiedMicros: bigint; estimatedMicros: bigint; actualMicros: bigint }>;
  previousUsage: Array<{ toolName: string; verifiedMicros: bigint; estimatedMicros: bigint; actualMicros: bigint }>;
  activePeople: Array<{ toolName: string; developerId: string }>;
  /** Peak used % per person, tool, and plan window in the trailing SIGNAL_DAYS. */
  quotaPeaks: Array<{ toolName: string; developerId: string; peak: number }>;
  idleSeats: Array<{ toolName: string; count: number; cycleMicros: string }>;
};

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function key(name: string | null | undefined) {
  return canonicalToolKey((name ?? "").trim().toLowerCase());
}

/** Monthly equivalent of one cycle's amount. */
export function monthlyFactor(cadence: string, cycleDays: number | null) {
  const normalized = normalizeBillingCadence(cadence);
  if (normalized === "annual") return 1 / 12;
  if (normalized === "weekly") return AVG_MONTH_DAYS / 7;
  if (normalized === "custom" && cycleDays && cycleDays > 0) return AVG_MONTH_DAYS / cycleDays;
  return 1;
}

function scale(micros: bigint, factor: number) {
  return factor === 1 ? micros : BigInt(Math.round(Number(micros) * factor));
}

function priceTag(plan: Pick<PlanInput, "customPrice" | "priceSource">): PriceTag {
  return plan.customPrice || plan.priceSource === "custom" || plan.priceSource === "manual" ? "entered" : "list";
}

function sum<T>(rows: T[], pick: (row: T) => bigint) {
  return rows.reduce((total, row) => total + pick(row), 0n);
}

export function buildCostOverview(input: CostOverviewInput): CostOverview {
  const today = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()));
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = Math.round((today.getTime() - monthStart.getTime()) / DAY_MS) + 1;
  const canProject = daysElapsed >= MIN_PROJECTION_DAYS;

  const toolKeys = new Set<string>();
  const plansByTool = new Map<string, PlanInput[]>();
  for (const plan of input.plans) {
    const toolKey = key(plan.toolKey ?? plan.toolName);
    plansByTool.set(toolKey, [...(plansByTool.get(toolKey) ?? []), plan]);
    toolKeys.add(toolKey);
  }
  const usageByTool = new Map<string, { verified: bigint; estimated: bigint }>();
  for (const row of input.usage) {
    const toolKey = key(row.toolName);
    const entry = usageByTool.get(toolKey) ?? { verified: 0n, estimated: 0n };
    entry.verified += row.verifiedMicros + row.actualMicros;
    entry.estimated += row.estimatedMicros;
    usageByTool.set(toolKey, entry);
    toolKeys.add(toolKey);
  }
  const previousByTool = new Map<string, bigint>();
  for (const row of input.previousUsage) {
    const toolKey = key(row.toolName);
    previousByTool.set(toolKey, (previousByTool.get(toolKey) ?? 0n) + row.verifiedMicros + row.actualMicros + row.estimatedMicros);
  }
  const peopleByTool = new Map<string, Set<string>>();
  for (const row of input.activePeople) {
    const toolKey = key(row.toolName);
    peopleByTool.set(toolKey, (peopleByTool.get(toolKey) ?? new Set()).add(row.developerId));
  }
  const peaksByTool = new Map<string, Map<string, number[]>>();
  for (const row of input.quotaPeaks) {
    const toolKey = key(row.toolName);
    const people = peaksByTool.get(toolKey) ?? new Map<string, number[]>();
    people.set(row.developerId, [...(people.get(row.developerId) ?? []), row.peak]);
    peaksByTool.set(toolKey, people);
  }

  const tools: CostTool[] = [];
  for (const toolKey of toolKeys) {
    if (!toolKey) continue;
    const plans = plansByTool.get(toolKey) ?? [];
    const usage = usageByTool.get(toolKey) ?? { verified: 0n, estimated: 0n };
    const costPlans: CostPlan[] = plans.map((plan) => {
      const factor = monthlyFactor(plan.billingCadence, plan.billingCycleDays);
      const cycleMicros = plan.cycleSeatMicros * BigInt(plan.seatCapacity);
      const cycle = resolveBillingCycle(plan, input.now);
      return {
        id: plan.id,
        name: plan.name,
        cadence: normalizeBillingCadence(plan.billingCadence),
        seatCapacity: plan.seatCapacity,
        assignedSeats: plan.assignedSeats,
        monthlyMicros: scale(cycleMicros, factor).toString(),
        priceTag: priceTag(plan),
        renewsOn: dayKey(cycle.nextRenewalDate),
        renewalMicros: cycleMicros.toString(),
      };
    });
    const paidPlans = costPlans.filter((plan) => BigInt(plan.monthlyMicros) > 0n);
    const tags = new Set(paidPlans.map((plan) => plan.priceTag));
    const usageTotal = usage.verified + usage.estimated;
    const payAsYouGo = plans.length === 0;
    const peaks = peaksByTool.get(toolKey);
    const people = [...(peaks?.values() ?? [])];

    tools.push({
      toolKey,
      plans: costPlans,
      seatsPaid: plans.reduce((total, plan) => total + plan.seatCapacity, 0),
      seatsAssigned: plans.reduce((total, plan) => total + plan.assignedSeats, 0),
      activePeople: peopleByTool.get(toolKey)?.size ?? 0,
      seatsMonthlyMicros: sum(costPlans, (plan) => BigInt(plan.monthlyMicros)).toString(),
      seatsPriceTag: tags.size === 0 ? null : tags.size > 1 ? "mixed" : [...tags][0]!,
      usageToDateMicros: usageTotal.toString(),
      usageVerifiedToDateMicros: usage.verified.toString(),
      usageBasis: payAsYouGo ? "pay_as_you_go" : "within_plan",
      includedMonthlyMicros: sum(plans, (plan) => scale(plan.includedCycleMicros * BigInt(plan.seatCapacity), monthlyFactor(plan.billingCadence, plan.billingCycleDays))).toString(),
      projectedSpendMicros: payAsYouGo && canProject
        ? BigInt(Math.round((Number(usageTotal) / daysElapsed) * daysInMonth)).toString()
        : null,
      limits: people.length
        ? {
          measured: people.length,
          hit: people.filter((windows) => windows.some((peak) => peak >= LIMIT_HIT)).length,
          near: people.filter((windows) => !windows.some((peak) => peak >= LIMIT_HIT) && windows.some((peak) => peak >= LIMIT_NEAR)).length,
          light: people.filter((windows) => windows.every((peak) => peak < LIMIT_LIGHT)).length,
        }
        : null,
    });
  }

  tools.sort((a, b) => {
    const diff = BigInt(b.seatsMonthlyMicros) + BigInt(b.projectedSpendMicros ?? b.usageToDateMicros) * (b.usageBasis === "pay_as_you_go" ? 1n : 0n)
      - (BigInt(a.seatsMonthlyMicros) + BigInt(a.projectedSpendMicros ?? a.usageToDateMicros) * (a.usageBasis === "pay_as_you_go" ? 1n : 0n));
    return diff > 0n ? 1 : diff < 0n ? -1 : a.toolKey.localeCompare(b.toolKey);
  });

  const seats = sum(tools, (tool) => BigInt(tool.seatsMonthlyMicros));
  const payg = tools.filter((tool) => tool.usageBasis === "pay_as_you_go");
  const paygToDate = sum(payg, (tool) => BigInt(tool.usageToDateMicros));
  const paygEstimated = sum(payg, (tool) => BigInt(tool.usageToDateMicros) - BigInt(tool.usageVerifiedToDateMicros));
  const paygProjected = canProject ? sum(payg, (tool) => BigInt(tool.projectedSpendMicros ?? "0")) : null;
  const previousPayg = sum(payg, (tool) => previousByTool.get(tool.toolKey) ?? 0n);
  const withinPlans = sum(tools.filter((tool) => tool.usageBasis === "within_plan"), (tool) => BigInt(tool.usageToDateMicros));
  const seatsHaveListPrices = tools.some((tool) => tool.seatsPriceTag === "list" || tool.seatsPriceTag === "mixed");

  return {
    month: { from: dayKey(monthStart), to: dayKey(today), daysElapsed, daysInMonth },
    totals: {
      seatsMonthlyMicros: seats.toString(),
      seatsHaveListPrices,
      payAsYouGoToDateMicros: paygToDate.toString(),
      payAsYouGoEstimatedToDateMicros: paygEstimated.toString(),
      payAsYouGoProjectedMicros: paygProjected?.toString() ?? null,
      previousPayAsYouGoSameDaysMicros: previousPayg.toString(),
      usageValueWithinPlansToDateMicros: withinPlans.toString(),
      monthlyTotalMicros: (seats + (paygProjected ?? paygToDate)).toString(),
      totalIsEstimate: seatsHaveListPrices || paygEstimated > 0n || paygProjected !== null,
    },
    tools,
    changes: buildChanges(tools, input.idleSeats, today),
  };
}

function buildChanges(tools: CostTool[], idleSeats: CostOverviewInput["idleSeats"], today: Date): CostChange[] {
  const changes: CostChange[] = [];
  for (const tool of tools) {
    for (const plan of tool.plans) {
      const free = plan.seatCapacity - plan.assignedSeats;
      const perSeat = plan.seatCapacity ? BigInt(plan.monthlyMicros) / BigInt(plan.seatCapacity) : 0n;
      if (free > 0 && perSeat > 0n) {
        changes.push({
          kind: "unassigned_seats",
          toolKey: tool.toolKey,
          text: `${free} ${plan.name} ${free === 1 ? "seat is" : "seats are"} paid for but assigned to no one`,
          monthlyMicros: (perSeat * BigInt(free)).toString(),
          basis: plan.priceTag === "entered" ? "your price" : "list price",
          href: `/tools/${tool.toolKey}`,
        });
      }
      const renews = new Date(`${plan.renewsOn}T00:00:00Z`);
      const daysToRenewal = Math.round((renews.getTime() - today.getTime()) / DAY_MS);
      if (plan.cadence === "annual" && daysToRenewal >= 0 && daysToRenewal <= 60 && BigInt(plan.renewalMicros) > 0n) {
        changes.push({
          kind: "annual_renewal",
          toolKey: tool.toolKey,
          text: `${plan.name} renews on ${plan.renewsOn} as one annual charge`,
          monthlyMicros: null,
          basis: `${plan.priceTag === "entered" ? "your price" : "list price"} · full charge at renewal`,
          href: `/tools/${tool.toolKey}`,
        });
      }
    }
    const included = BigInt(tool.includedMonthlyMicros);
    if (tool.usageBasis === "within_plan" && included > 0n && BigInt(tool.usageToDateMicros) > included) {
      changes.push({
        kind: "past_allowance",
        toolKey: tool.toolKey,
        text: "Usage is past the plan's included allowance this month. Extra usage may be billed on top of seats; check the invoice.",
        monthlyMicros: null,
        basis: BigInt(tool.usageVerifiedToDateMicros) > 0n ? "vendor-reported usage value" : "estimated usage value",
        href: `/tools/${tool.toolKey}`,
      });
    }
    if (tool.limits && tool.limits.hit > 0) {
      changes.push({
        kind: "hitting_limits",
        toolKey: tool.toolKey,
        text: `${tool.limits.hit} of ${tool.limits.measured} ${tool.limits.measured === 1 ? "person" : "people"} hit the plan limit in the last ${SIGNAL_DAYS} days. A higher tier may fit.`,
        monthlyMicros: null,
        basis: "plan-window readings from the agent",
        href: `/tools/${tool.toolKey}`,
      });
    }
  }
  for (const idle of idleSeats) {
    changes.push({
      kind: "unused_seats",
      toolKey: key(idle.toolName),
      text: `${idle.count} assigned ${idle.count === 1 ? "seat" : "seats"} saw no use in the last ${SIGNAL_DAYS} days`,
      monthlyMicros: idle.cycleMicros,
      basis: "per cycle · people with healthy collection only",
      href: "/activity",
    });
  }
  return changes.sort((a, b) => {
    const diff = BigInt(b.monthlyMicros ?? "0") - BigInt(a.monthlyMicros ?? "0");
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });
}

function toMicros(dollars: number) {
  return BigInt(Math.round(dollars * 1_000_000));
}

export async function getCostOverview(
  orgId: string,
  plans: PlanInput[],
  now: Date = new Date(),
): Promise<CostOverview> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const previousStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const previousLastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate();
  const previousSameDay = new Date(Date.UTC(previousStart.getUTCFullYear(), previousStart.getUTCMonth(), Math.min(today.getUTCDate(), previousLastDay)));
  const signalStart = new Date(today.getTime() - (SIGNAL_DAYS - 1) * DAY_MS);
  const window = (from: Date, to: Date) => ({ from, to, timezone: UTC_TIMEZONE, grain: "day" as const });

  const [current, previous, activePeople, quotaPeaks, adoption] = await Promise.all([
    readOrgUsageFromSnapshots(orgId, window(monthStart, today), { includeTools: true, ensure: false }),
    readOrgUsageFromSnapshots(orgId, window(previousStart, previousSameDay), { includeTools: true, ensure: false }),
    prisma.$queryRaw<Array<{ toolName: string; developerId: string }>>`
      SELECT DISTINCT tool_name AS "toolName", developer_id AS "developerId"
      FROM usage_daily
      WHERE org_id = ${orgId}
        AND developer_id IS NOT NULL
        AND date >= ${dayKey(signalStart)}::date
        AND date <= ${dayKey(today)}::date
        AND metric_kind <> 'productivity'
        AND (requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0 OR active_seconds > 0)
    `,
    prisma.$queryRaw<Array<{ toolName: string; developerId: string; peak: number }>>`
      SELECT q.tool_name AS "toolName", d.user_id AS "developerId", MAX(q.used_percent)::float AS peak
      FROM quota_observations q
      JOIN devices d ON d.id = q.device_id
      WHERE q.org_id = ${orgId}
        AND q.observed_at >= ${signalStart}
      GROUP BY q.tool_name, d.user_id, q.window_type, q.reset_at
    `,
    getTeamAdoption(orgId, window(signalStart, today), now),
  ]);

  const usageRows = (rows: typeof current.tools) => rows.map((row) => ({
    toolName: row.toolName,
    verifiedMicros: toMicros(row.verifiedUsageCost),
    estimatedMicros: toMicros(row.estimatedApiCost),
    actualMicros: toMicros(row.actualSpendCost),
  }));

  return buildCostOverview({
    now,
    plans,
    usage: usageRows(current.tools),
    previousUsage: usageRows(previous.tools),
    activePeople,
    quotaPeaks,
    idleSeats: adoption.idleSeats.tools,
  });
}
