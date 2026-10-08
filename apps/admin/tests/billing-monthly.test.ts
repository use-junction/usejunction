import { expect, test } from "vitest";
import { monthlyMicros, unassignedSeats } from "@/lib/billing/monthly";
import { isIdlePaidCycle } from "@/lib/dashboard/idle-cycles";

const seatPlan = (over: Partial<Parameters<typeof unassignedSeats>[0][number]> = {}) => ({
  toolKey: "cursor",
  toolName: "cursor",
  seatCapacity: 3,
  assignedSeats: 1,
  cycleSeatMicros: 20_000_000n,
  billingCadence: "monthly",
  billingCycleDays: null,
  priceSource: "provider_catalog",
  ...over,
});

test("annual and weekly prices become monthly before anything is summed", () => {
  expect(monthlyMicros(240_000_000n, "annual", null)).toBe(20_000_000n);
  expect(monthlyMicros(7_000_000n, "weekly", null)).toBe(30_437_500n);
  expect(monthlyMicros(20_000_000n, "monthly", null)).toBe(20_000_000n);
});

test("unassigned seats are priced per month and grouped by tool", () => {
  const result = unassignedSeats(
    [seatPlan(), seatPlan({ toolKey: "claude", toolName: "claude", seatCapacity: 2, assignedSeats: 1, cycleSeatMicros: 300_000_000n, billingCadence: "annual" })],
    (plan) => plan.toolKey ?? plan.toolName,
  );
  expect(result.count).toBe(3);
  expect(result.tools).toEqual([
    { toolName: "cursor", count: 2, monthlyMicros: "40000000" },
    { toolName: "claude", count: 1, monthlyMicros: "25000000" },
  ]);
  expect(result.monthlyMicros).toBe("65000000");
});

test("free plans and fully assigned plans never count as unassigned money", () => {
  const result = unassignedSeats(
    [seatPlan({ cycleSeatMicros: 0n }), seatPlan({ assignedSeats: 3 })],
    (plan) => plan.toolName,
  );
  expect(result).toEqual({ count: 0, monthlyMicros: "0", tools: [] });
});

test("detected capacity and people using the tool without a seat are not unassigned money", () => {
  const result = unassignedSeats(
    [seatPlan({ priceSource: "detected" }), seatPlan({ toolKey: "claude", toolName: "claude" })],
    (plan) => plan.toolName,
    new Map([["claude", 1]]),
  );
  expect(result.tools).toEqual([{ toolName: "claude", count: 1, monthlyMicros: "20000000" }]);
});

test("a paid plan with no use reads as idle, not within allowance", () => {
  const row = { cycleSpend: 40, modelCalls: 0, verifiedUsageCost: 0, estimatedApiCost: 0, utilizationPercent: 0 };
  expect(isIdlePaidCycle(row)).toBe(true);
  expect(isIdlePaidCycle({ ...row, modelCalls: 3 })).toBe(false);
  expect(isIdlePaidCycle({ ...row, cycleSpend: 0 })).toBe(false);
  expect(isIdlePaidCycle({ ...row, utilizationPercent: null })).toBe(true);
});
