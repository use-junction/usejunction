import { normalizeBillingCadence } from "@/lib/billing/cycles";

const AVG_MONTH_DAYS = 30.4375;

/** Monthly equivalent of one cycle's amount, so mixed cadences can be summed and compared. */
export function monthlyFactor(cadence: string, cycleDays: number | null) {
  const normalized = normalizeBillingCadence(cadence);
  if (normalized === "annual") return 1 / 12;
  if (normalized === "weekly") return AVG_MONTH_DAYS / 7;
  if (normalized === "custom" && cycleDays && cycleDays > 0) return AVG_MONTH_DAYS / cycleDays;
  return 1;
}

export function monthlyMicros(cycleMicros: bigint, cadence: string, cycleDays: number | null) {
  const factor = monthlyFactor(cadence, cycleDays);
  return factor === 1 ? cycleMicros : BigInt(Math.round(Number(cycleMicros) * factor));
}

export type SeatPlan = {
  toolKey: string | null;
  toolName: string;
  seatCapacity: number;
  assignedSeats: number;
  cycleSeatMicros: bigint;
  billingCadence: string;
  billingCycleDays: number | null;
  priceSource: string;
};

/**
 * Seats per plan we can honestly call "assigned to no one", in input order. A seat only counts when:
 * - someone entered the seat count. Detected plans grow capacity as devices report seats and keep it
 *   when a device stops reporting or a person changes tier, so their spare capacity proves nothing;
 * - no one with real use of the tool in the signal window lacks a seat. Each such person is
 *   presumably on one of the "free" seats, so they absorb them, priciest first.
 */
export function provenFreeSeats<T extends SeatPlan>(
  plans: T[],
  toolKey: (plan: T) => string,
  unseatedUsers: ReadonlyMap<string, number> = new Map(),
): number[] {
  const free = plans.map((plan) =>
    plan.priceSource === "detected" || plan.cycleSeatMicros <= 0n ? 0 : Math.max(0, plan.seatCapacity - plan.assignedSeats),
  );
  const remaining = new Map(unseatedUsers);
  const order = plans.map((_, index) => index).sort((a, b) => {
    const diff = monthlyMicros(plans[b]!.cycleSeatMicros, plans[b]!.billingCadence, plans[b]!.billingCycleDays)
      - monthlyMicros(plans[a]!.cycleSeatMicros, plans[a]!.billingCadence, plans[a]!.billingCycleDays);
    return diff > 0n ? 1 : diff < 0n ? -1 : a - b;
  });
  for (const index of order) {
    const key = toolKey(plans[index]!);
    const users = remaining.get(key) ?? 0;
    if (!users || !free[index]) continue;
    const absorbed = Math.min(users, free[index]!);
    free[index] = free[index]! - absorbed;
    remaining.set(key, users - absorbed);
  }
  return free;
}

export type UnassignedSeats = {
  count: number;
  monthlyMicros: string;
  tools: Array<{ toolName: string; count: number; monthlyMicros: string }>;
};

/**
 * Paid seats bought but assigned to no one, priced per month.
 * Cost and Adoption both read this so the two pages never disagree on idle money.
 */
export function unassignedSeats(
  plans: SeatPlan[],
  toolKey: (plan: SeatPlan) => string,
  unseatedUsers?: ReadonlyMap<string, number>,
): UnassignedSeats {
  const byTool = new Map<string, { count: number; micros: bigint }>();
  const proven = provenFreeSeats(plans, toolKey, unseatedUsers);
  for (const [index, plan] of plans.entries()) {
    const free = proven[index]!;
    if (free <= 0) continue;
    const key = toolKey(plan);
    const entry = byTool.get(key) ?? { count: 0, micros: 0n };
    entry.count += free;
    entry.micros += monthlyMicros(plan.cycleSeatMicros * BigInt(free), plan.billingCadence, plan.billingCycleDays);
    byTool.set(key, entry);
  }
  const tools = [...byTool.entries()]
    .map(([toolName, entry]) => ({ toolName, count: entry.count, monthlyMicros: entry.micros.toString() }))
    .sort((a, b) => (BigInt(b.monthlyMicros) > BigInt(a.monthlyMicros) ? 1 : BigInt(b.monthlyMicros) < BigInt(a.monthlyMicros) ? -1 : a.toolName.localeCompare(b.toolName)));
  return {
    count: tools.reduce((sum, tool) => sum + tool.count, 0),
    monthlyMicros: tools.reduce((sum, tool) => sum + BigInt(tool.monthlyMicros), 0n).toString(),
    tools,
  };
}
