import { describe, expect, test } from "vitest";
import { estimateCost, PRICING_VERSION } from "@/lib/metrics/estimate-cost";
import { PRICING_VERSION as SOURCE_PRICING_VERSION } from "@/lib/metrics/source-priority";

describe("cursor composer and grok fast pricing", () => {
  test("pricing version is aligned across admin modules", () => {
    expect(PRICING_VERSION).toBe("2026-10-20");
    expect(SOURCE_PRICING_VERSION).toBe(PRICING_VERSION);
  });

  test("fast composer matches fast tier before standard substring", () => {
    const fast = estimateCost("composer-2.5-fast", 1_000_000, 500_000, 0, 0, "cursor");
    const standard = estimateCost("composer-2.5", 1_000_000, 500_000, 0, 0, "cursor");
    expect(fast).toBe(10.5);
    expect(standard).toBe(1.75);
    expect(fast).toBeGreaterThan(standard);
  });

  test("fast grok matches fast tier before standard grok-4.5", () => {
    const fast = estimateCost("cursor-grok-4.5-high-fast", 1_000_000, 1_000_000, 0, 0, "cursor");
    const standard = estimateCost("grok-4.5", 1_000_000, 1_000_000, 0, 0, "cursor");
    expect(fast).toBe(22);
    expect(standard).toBe(8);
    expect(fast).toBeGreaterThan(standard);
  });

  test("composer-2-fast uses fast tier", () => {
    expect(estimateCost("composer-2-fast", 1_000_000, 0, 0, 0, "cursor")).toBe(3);
  });
});
