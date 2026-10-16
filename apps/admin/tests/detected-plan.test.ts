import { describe, expect, test } from "vitest";
import {
  canAutoCreateDetectedSeat,
  mapVendorPlanToCatalog,
  strongerVendorPlan,
  vendorPlanRank,
} from "@/lib/tools/detected-plan";

describe("canAutoCreateDetectedSeat", () => {
  test("a vendor plan always justifies a seat", () => {
    expect(canAutoCreateDetectedSeat("claude", { hasVendorPlan: true })).toBe(true);
  });

  test("Claude never auto-creates a seat from auth alone (no fake Free)", () => {
    expect(canAutoCreateDetectedSeat("claude", { hasVendorPlan: false, authPresent: true })).toBe(false);
  });

  test("tools with a real base tier still auto-create from auth", () => {
    expect(canAutoCreateDetectedSeat("antigravity", { hasVendorPlan: false, authPresent: true })).toBe(true);
    expect(canAutoCreateDetectedSeat("cursor", { hasVendorPlan: false, authPresent: true })).toBe(true);
  });

  test("no auth and no vendor plan is never a seat", () => {
    expect(canAutoCreateDetectedSeat("antigravity", { hasVendorPlan: false, authPresent: false })).toBe(false);
  });
});

describe("mapVendorPlanToCatalog (claude tiers)", () => {
  test("bare max maps to max-5x, and the tier-aware strings pass through", () => {
    expect(mapVendorPlanToCatalog("claude", "max")).toBe("max-5x");
    expect(mapVendorPlanToCatalog("claude", "max-5x")).toBe("max-5x");
    expect(mapVendorPlanToCatalog("claude", "max-20x")).toBe("max-20x");
  });

  test("team variants map to their catalog keys", () => {
    expect(mapVendorPlanToCatalog("claude", "team_standard")).toBe("team-standard");
    expect(mapVendorPlanToCatalog("claude", "team-premium")).toBe("team-premium");
  });

  test("paid seat shapes never fall back to Free", () => {
    // What older agents stored for a paid Team seat (raw seatTier from ~/.claude.json).
    expect(mapVendorPlanToCatalog("claude", "team_tier_1")).toBe("team-standard");
    expect(mapVendorPlanToCatalog("claude", "claude_team")).toBe("team-standard");
    expect(mapVendorPlanToCatalog("claude", "team_premium_tier")).toBe("team-premium");
    expect(mapVendorPlanToCatalog("claude", "enterprise_tier_1")).toBe("enterprise");
    expect(mapVendorPlanToCatalog("claude", "claude_pro")).toBe("pro");
    expect(mapVendorPlanToCatalog("claude", "claude_max")).toBe("max-5x");
  });

  test("a genuinely unknown or empty plan still falls back to Free", () => {
    expect(mapVendorPlanToCatalog("claude", "")).toBe("free");
    expect(mapVendorPlanToCatalog("claude", "something_new")).toBe("free");
  });
});

describe("strongerVendorPlan (one person, several logins)", () => {
  test("team beats max beats pro", () => {
    expect(strongerVendorPlan("claude", "pro", "team-standard")).toBe("team-standard");
    expect(strongerVendorPlan("claude", "max-20x", "pro")).toBe("max-20x");
    expect(strongerVendorPlan("claude", "team-standard", "max-20x")).toBe("team-standard");
  });

  test("ranks increase with tier", () => {
    expect(vendorPlanRank("claude", "pro")).toBeLessThan(vendorPlanRank("claude", "max-20x"));
    expect(vendorPlanRank("claude", "max-20x")).toBeLessThan(vendorPlanRank("claude", "team-standard"));
  });
});
