import { describe, expect, it } from "vitest";
import { mergeOrgOverviewShellMetrics } from "@/lib/app-pages/dashboard-merge";
import type { OrgOverviewMetricsData, OrgOverviewShellData } from "@/lib/insights";

const shell: OrgOverviewShellData = {
  coverage: { developers: 5, devices: 3, configuredTools: 2, trackedTools: 4 },
  health: {
    issues: [{ severity: "warning", message: "Missing plan", context: "Cursor" }],
  },
  detectedInstallations: [{ toolName: "cursor", count: 2 }],
};

const metrics = {
  range: 30,
  cycleView: "current_cycles",
  period: {
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-01-30T00:00:00.000Z",
    previousFrom: "2025-12-01T00:00:00.000Z",
    previousTo: "2025-12-30T00:00:00.000Z",
  },
  hasUsageActivity: false,
  partialData: false,
  observation: {
    rangeDays: 30,
    daysWithActivity: 0,
    firstActivityDate: null,
    partialWindow: false,
  },
  kpis: {
    actualSpend: { value: 0, previousValue: 0, deltaPercent: null, basis: "none" as const },
    seats: { value: 0, previousValue: 0, deltaPercent: null },
    verifiedUsageCost: { value: 0, previousValue: 0, deltaPercent: null },
    estimatedApiCost: { value: 0, previousValue: 0, deltaPercent: null },
    tokens: { value: 0, previousValue: 0, deltaPercent: null },
  },
  subscriptionCycles: [],
  renewals: [],
  trend: [],
  attention: [],
  tools: [],
  models: [],
  providerCards: [],
  people: [],
  coverage: { activeDevelopers: 1 },
  failures: [],
} satisfies OrgOverviewMetricsData;

describe("mergeOrgOverviewShellMetrics", () => {
  it("merges static coverage and detected tools into metrics", () => {
    const merged = mergeOrgOverviewShellMetrics(shell, metrics);
    expect(merged.coverage).toEqual({
      developers: 5,
      devices: 3,
      configuredTools: 2,
      trackedTools: 4,
      activeDevelopers: 1,
    });
    expect(merged.tools).toEqual([
      { name: "cursor", requests: 0, cost: 0, activeDevelopers: 0 },
    ]);
    expect(merged.hasActivity).toBe(true);
    expect(merged.attention[0]?.title).toBe("Missing plan");
  });

  it("never reports more active people than are on the roster", () => {
    // Usage from people removed since still counts as active in the window.
    const merged = mergeOrgOverviewShellMetrics(
      { ...shell, coverage: { ...shell.coverage, developers: 4 } },
      { ...metrics, coverage: { activeDevelopers: 6 } },
    );
    expect(merged.coverage.developers).toBe(4);
    expect(merged.coverage.activeDevelopers).toBe(4);
  });
});
