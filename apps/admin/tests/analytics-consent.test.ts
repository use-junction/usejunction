import { describe, expect, it } from "vitest";
import {
  ANALYTICS_CONSENT_COOKIE,
  hasAnalyticsConsent,
  hasResolvedAnalyticsConsent,
  readConsentCookie,
  serializeAnalyticsConsent,
} from "@/lib/consent/analytics-consent";
import { ANALYTICS_CONSENT_VERSION } from "@/lib/legal/versions";

describe("analytics consent cookie", () => {
  it("treats missing or stale cookies as no consent", () => {
    expect(hasAnalyticsConsent(null)).toBe(false);
    expect(hasResolvedAnalyticsConsent(null)).toBe(false);
    expect(readConsentCookie("")).toBeNull();
    expect(
      hasAnalyticsConsent({ analytics: true, version: "old", at: new Date().toISOString() }),
    ).toBe(false);
  });

  it("parses a current-version opt-in cookie", () => {
    const state = serializeAnalyticsConsent(true, new Date("2026-09-18T00:00:00.000Z"));
    const header = `${ANALYTICS_CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}`;
    expect(readConsentCookie(header)).toEqual(state);
    expect(hasAnalyticsConsent(state)).toBe(true);
    expect(state.version).toBe(ANALYTICS_CONSENT_VERSION);
  });
});
