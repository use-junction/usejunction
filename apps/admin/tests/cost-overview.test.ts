import { expect, test } from "vitest";
import { buildCostOverview, monthlyFactor } from "@/lib/queries/tools/cost-overview";

const plan = (over: Partial<Parameters<typeof buildCostOverview>[0]["plans"][number]> = {}) => ({
  id: "p1",
  toolKey: "cursor",
  toolName: "cursor",
  name: "Pro",
  billingCadence: "monthly",
  billingCycleDays: null,
  billingCycleAnchorDate: new Date("2026-09-10T00:00:00Z"),
  createdAt: new Date("2026-07-01T00:00:00Z"),
  seatCapacity: 1,
  assignedSeats: 1,
  cycleSeatMicros: 20_000_000n,
  includedCycleMicros: 0n,
  customPrice: false,
  priceSource: "provider_catalog",
  ...over,
});
const usage = (toolName: string, verified: number, estimated = 0) => ({
  toolName,
  verifiedMicros: BigInt(verified * 1_000_000),
  estimatedMicros: BigInt(estimated * 1_000_000),
  actualMicros: 0n,
});
const base = { previousUsage: [], activePeople: [], seatHolders: [], quotaPeaks: [], idleSeats: [] };

test("annual and weekly plans are normalised to monthly, never summed raw", () => {
  expect(monthlyFactor("monthly", null)).toBe(1);
  expect(monthlyFactor("annual", null)).toBeCloseTo(1 / 12);
  expect(monthlyFactor("weekly", null)).toBeCloseTo(30.4375 / 7);
  const result = buildCostOverview({
    ...base,
    now: new Date("2026-10-15T12:00:00Z"),
    plans: [plan(), plan({ id: "p2", toolKey: "claude", toolName: "claude", name: "Team", billingCadence: "annual", cycleSeatMicros: 240_000_000n, customPrice: true })],
    usage: [],
  });
  expect(result.totals.seatsMonthlyMicros).toBe("40000000");
  const claude = result.tools.find((tool) => tool.toolKey === "claude")!;
  expect(claude.plans[0]).toMatchObject({ monthlyMicros: "20000000", renewalMicros: "240000000", priceTag: "entered" });
  expect(result.tools.find((tool) => tool.toolKey === "cursor")!.seatsPriceTag).toBe("list");
});

test("usage under a plan is value, not bill; usage with no plan is pay-as-you-go spend", () => {
  const result = buildCostOverview({
    ...base,
    now: new Date("2026-10-10T12:00:00Z"),
    plans: [plan({ includedCycleMicros: 20_000_000n })],
    usage: [usage("cursor", 139), usage("openrouter", 10, 5)],
  });
  expect(result.totals.usageValueWithinPlansToDateMicros).toBe("139000000");
  expect(result.totals.payAsYouGoToDateMicros).toBe("15000000");
  expect(result.totals.payAsYouGoEstimatedToDateMicros).toBe("5000000");
  // 15 over 10 days, straight line to 31 days.
  expect(result.totals.payAsYouGoProjectedMicros).toBe("46500000");
  expect(result.totals.monthlyTotalMicros).toBe("66500000");
  expect(result.totals.totalIsEstimate).toBe(true);
  expect(result.changes.map((change) => change.kind)).toContain("past_allowance");
});

test("no projection before day 7; the total uses month to date", () => {
  const result = buildCostOverview({ ...base, now: new Date("2026-10-03T12:00:00Z"), plans: [], usage: [usage("openrouter", 9)] });
  expect(result.totals.payAsYouGoProjectedMicros).toBeNull();
  expect(result.totals.monthlyTotalMicros).toBe("9000000");
});

test("limit counts are per person and unassigned seats become a change with a price", () => {
  const result = buildCostOverview({
    ...base,
    now: new Date("2026-10-15T12:00:00Z"),
    plans: [plan({ toolKey: "chatgpt-codex", toolName: "codex", seatCapacity: 3, assignedSeats: 1 })],
    usage: [],
    quotaPeaks: [
      { toolName: "codex", developerId: "a", peak: 100 },
      { toolName: "codex", developerId: "a", peak: 40 },
      { toolName: "codex", developerId: "b", peak: 92 },
      { toolName: "codex", developerId: "c", peak: 4 },
    ],
  });
  const codex = result.tools[0]!;
  expect(codex.toolKey).toBe("chatgpt-codex");
  expect(codex.limits).toEqual({ measured: 3, hit: 1, near: 1, light: 1 });
  const unassigned = result.changes.find((change) => change.kind === "unassigned_seats")!;
  expect(unassigned.monthlyMicros).toBe("40000000");
  expect(unassigned.basis).toBe("list price");
});

test("spare capacity on a detected plan is never called assigned to no one", () => {
  // Detected plans grow as devices report seats and keep that capacity when a device stops
  // reporting or someone changes tier, so the leftover is not a seat anyone bought.
  const result = buildCostOverview({
    ...base,
    now: new Date("2026-10-15T12:00:00Z"),
    plans: [plan({ seatCapacity: 3, assignedSeats: 1, priceSource: "detected" })],
    usage: [],
  });
  expect(result.tools[0]!.plans[0]!.unassignedSeats).toBe(0);
  expect(result.changes.find((change) => change.kind === "unassigned_seats")).toBeUndefined();
});

test("people using a tool without a seat absorb its free seats, priciest first", () => {
  const result = buildCostOverview({
    ...base,
    now: new Date("2026-10-15T12:00:00Z"),
    plans: [
      plan({ id: "pro", name: "Pro", seatCapacity: 2, assignedSeats: 1 }),
      plan({ id: "plus", name: "Pro+", seatCapacity: 2, assignedSeats: 1, cycleSeatMicros: 60_000_000n }),
    ],
    usage: [],
    activePeople: [
      { toolName: "cursor", developerId: "held" },
      { toolName: "cursor", developerId: "unseated" },
      { toolName: "Cursor", developerId: "unseated" },
    ],
    seatHolders: [{ toolName: "cursor", developerId: "held" }],
  });
  const [pro, plus] = result.tools[0]!.plans;
  expect(plus!.unassignedSeats).toBe(0);
  expect(pro!.unassignedSeats).toBe(1);
  const changes = result.changes.filter((change) => change.kind === "unassigned_seats");
  expect(changes).toHaveLength(1);
  expect(changes[0]!.text).toBe("1 Pro seat assigned to no one");
});
