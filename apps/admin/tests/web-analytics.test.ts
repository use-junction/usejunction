import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { serializeAnalyticsConsent } from "../lib/consent/analytics-consent";
import { isHostedSite, prepareAnalyticsEvent, redactAnalyticsUrl } from "../lib/web-analytics";

const site = "https://usejunction.dev";

test("Vercel Web Analytics never receives a token, code or id from a URL", () => {
  const cases: Array<[string, string]> = [
    // Invite links carry their token in the path.
    [`${site}/i/9f2c1d7a-secret`, `${site}/i/[token]`],
    [`${site}/join/abc123token`, `${site}/join/[token]`],
    // A company join page is public; its slug stays.
    [`${site}/join/company/northwind`, `${site}/join/company/northwind`],
    // Device sign-in codes and reset tokens ride in the query string, which is never sent.
    [`${site}/connect?code=WDJB-MJHT`, `${site}/connect`],
    [`${site}/reset-password?token=abc&email=a%40b.dev`, `${site}/reset-password`],
    [`${site}/login?callbackUrl=%2Fteam#top`, `${site}/login`],
    // People and sessions are grouped by page, not tracked one by one.
    [`${site}/team/cm3x9developer/coding`, `${site}/team/[developerId]/coding`],
    [`${site}/signals/activity/work/sess_42`, `${site}/signals/activity/work/[sessionId]`],
    [`${site}/signals/journeys/onboarding-flow`, `${site}/signals/journeys/[flowKey]`],
    // Public pages are unchanged.
    [`${site}/`, `${site}/`],
    [`${site}/compare/ccusage`, `${site}/compare/ccusage`],
    [`${site}/blog/codexbar-for-teams?utm_source=x`, `${site}/blog/codexbar-for-teams`],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactAnalyticsUrl(input), expected, input);
  }
  assert.equal(redactAnalyticsUrl("not a url"), "");
});

test("turning analytics off in Settings → Privacy stops Vercel Web Analytics too", () => {
  const event = { type: "pageview" as const, url: `${site}/i/token?x=1` };

  assert.deepEqual(prepareAnalyticsEvent(event, null), { type: "pageview", url: `${site}/i/[token]` }, "on by default");
  assert.deepEqual(prepareAnalyticsEvent(event, serializeAnalyticsConsent(true)), { type: "pageview", url: `${site}/i/[token]` });
  assert.equal(prepareAnalyticsEvent(event, serializeAnalyticsConsent(false)), null, "opted out: nothing is sent");
  assert.equal(prepareAnalyticsEvent({ type: "pageview", url: "garbage" }, null), null);
});

test("Web Analytics loads on the hosted site only, decided in the browser", () => {
  for (const host of ["usejunction.dev", "eu.usejunction.dev", "admin-git-main-makers-ops.vercel.app", "USEJUNCTION.DEV."]) {
    assert.equal(isHostedSite(host), true, host);
  }
  for (const host of ["localhost", "127.0.0.1", "junction.acme.internal", "usejunction.dev.evil.com", "notusejunction.dev"]) {
    assert.equal(isHostedSite(host), false, host);
  }
});

test("the root layout always mounts Web Analytics, and the cookies page lists it", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const layout = readFileSync(path.join(here, "..", "app", "layout.tsx"), "utf8");
  // process.env.VERCEL is not set at runtime on this project, so gating on it hid analytics everywhere.
  assert.doesNotMatch(layout, /process\.env\.VERCEL/);
  assert.match(layout, /<WebAnalytics \/>/);

  const component = readFileSync(path.join(here, "..", "components", "web-analytics.tsx"), "utf8");
  assert.match(component, /from "@vercel\/analytics\/next"/);
  assert.match(component, /beforeSend=\{\(event\) => prepareAnalyticsEvent\(event\)\}/);
  assert.match(component, /isHostedSite\(window\.location\.hostname\)/);

  const cookies = readFileSync(path.join(here, "..", "content", "legal", "cookies.ts"), "utf8");
  assert.match(cookies, /Vercel Web Analytics counts page views on usejunction\.dev without cookies/);
});
