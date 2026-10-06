import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();

vi.mock("@usejunction/db", () => ({
  prisma: {
    signalsPolicy: { findFirst },
  },
}));

vi.mock("@/lib/activity/record-device-activity-event", () => ({
  enforceDeviceActivityRetention: vi.fn(),
}));

describe("EU Signals policy gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    findFirst.mockResolvedValue({
      workExtractionEnabled: true,
      rawWorkTextEnabled: true,
      retentionDays: 90,
      excludedApps: [],
      excludedDomains: [],
      workExtractionStartedAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("forces work extraction off on EU deployments", async () => {
    vi.stubEnv("DEPLOYMENT_REGION", "eu");
    vi.stubEnv("NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED", "true");
    const { getEffectiveSignalsPolicy } = await import("@/lib/signals/service");
    const policy = await getEffectiveSignalsPolicy("org_1");
    expect(policy.workExtractionEnabled).toBe(false);
    expect(policy.rawWorkTextEnabled).toBe(false);
    vi.unstubAllEnvs();
  });

  it("keeps stored work extraction on US deployments when the product is enabled", async () => {
    vi.stubEnv("DEPLOYMENT_REGION", "us");
    vi.stubEnv("NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED", "true");
    const { getEffectiveSignalsPolicy } = await import("@/lib/signals/service");
    const policy = await getEffectiveSignalsPolicy("org_1");
    expect(policy.workExtractionEnabled).toBe(true);
    vi.unstubAllEnvs();
  });

  it("forces work extraction off when the Signals product is hidden", async () => {
    vi.stubEnv("DEPLOYMENT_REGION", "us");
    vi.stubEnv("NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED", "false");
    const { getEffectiveSignalsPolicy } = await import("@/lib/signals/service");
    const policy = await getEffectiveSignalsPolicy("org_1");
    expect(policy.workExtractionEnabled).toBe(false);
    expect(policy.rawWorkTextEnabled).toBe(false);
    vi.unstubAllEnvs();
  });
});
