import assert from "node:assert/strict";
import { test } from "vitest";
import { legalAcceptanceIsCurrent } from "@/lib/legal/acceptance";
import { isUsageRetentionDays, LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from "@/lib/legal/versions";
import { workSpendWindow } from "@/lib/app-pages/work-spend-window";

test("legal acceptance is current only for this terms and privacy version", () => {
  assert.equal(legalAcceptanceIsCurrent(null), false);
  assert.equal(legalAcceptanceIsCurrent({
    termsAcceptedAt: new Date("2026-09-18T00:00:00.000Z"),
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
  }), true);
  assert.equal(legalAcceptanceIsCurrent({
    termsAcceptedAt: new Date("2026-09-18T00:00:00.000Z"),
    termsVersion: "2020-01-01",
    privacyVersion: LEGAL_PRIVACY_VERSION,
  }), false);
  assert.equal(legalAcceptanceIsCurrent({
    termsAcceptedAt: null,
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
  }), false);
});

test("usage retention accepts only the published windows", () => {
  assert.equal(isUsageRetentionDays(365), true);
  assert.equal(isUsageRetentionDays(1095), true);
  assert.equal(isUsageRetentionDays(30), false);
  assert.equal(isUsageRetentionDays("365"), false);
});

test("work-spend window is 30 or 90 days and ends the day after the last included day", () => {
  const month = workSpendWindow("30");
  const quarter = workSpendWindow(null);
  assert.equal(month.days, 30);
  assert.equal(quarter.days, 90);
  assert.equal(workSpendWindow("7").days, 90);
  assert.equal(month.endExclusive.getTime() - month.to.getTime(), 86_400_000);
});
