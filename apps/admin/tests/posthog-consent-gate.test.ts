// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init,
    opt_out_capturing: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock("@/lib/consent/analytics-consent", () => ({
  hasAnalyticsConsent: vi.fn(),
}));

describe("PostHog consent gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
  });

  it("does not initialise PostHog without analytics consent", async () => {
    const { hasAnalyticsConsent } = await import("@/lib/consent/analytics-consent");
    vi.mocked(hasAnalyticsConsent).mockReturnValue(false);
    const { startPostHogIfConsented } = await import("@/lib/posthog/client");
    expect(startPostHogIfConsented()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("initialises PostHog after consent", async () => {
    const { hasAnalyticsConsent } = await import("@/lib/consent/analytics-consent");
    vi.mocked(hasAnalyticsConsent).mockReturnValue(true);
    const { startPostHogIfConsented } = await import("@/lib/posthog/client");
    expect(startPostHogIfConsented()).toBe(true);
    expect(init).toHaveBeenCalledOnce();
  });
});
