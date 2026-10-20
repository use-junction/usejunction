import { describe, expect, test } from "vitest";
import { isStaleLogin } from "@/lib/tools/stale-login";

const now = new Date("2026-10-20T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("isStaleLogin", () => {
  test("a signed-in login on a recently seen device is live", () => {
    expect(isStaleLogin({ authPresent: true, updatedAt: daysAgo(90), device: { lastSeenAt: daysAgo(1) } }, now)).toBe(false);
  });

  test("a login whose device has been silent for over 30 days is stale", () => {
    expect(isStaleLogin({ authPresent: true, updatedAt: daysAgo(31), device: { lastSeenAt: daysAgo(31) } }, now)).toBe(true);
  });

  test("a signed-out login is kept for 30 days, then goes stale", () => {
    expect(isStaleLogin({ authPresent: false, updatedAt: daysAgo(10), device: { lastSeenAt: daysAgo(1) } }, now)).toBe(false);
    expect(isStaleLogin({ authPresent: false, updatedAt: daysAgo(40), device: { lastSeenAt: daysAgo(1) } }, now)).toBe(true);
  });
});
