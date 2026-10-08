import assert from "node:assert/strict";
import { test } from "vitest";
import { buildTeamReminderEmail } from "@/lib/email/daily-report";
import { isEmptyReport } from "@/lib/reports/daily-report";

function kpis(requests: number, tokens: number, cost: number) {
  return {
    kpis: {
      requests,
      tokens,
      cost,
      tools: 0,
      requestsDeltaPct: null,
      tokensDeltaPct: null,
      costDeltaPct: null,
      planUsedPercent: null,
      acceptancePercent: null,
    },
  };
}

test("isEmptyReport only flags reports with no usage at all", () => {
  assert.equal(isEmptyReport(kpis(0, 0, 0)), true);
  assert.equal(isEmptyReport(kpis(1, 0, 0)), false);
  assert.equal(isEmptyReport(kpis(0, 120, 0)), false);
  assert.equal(isEmptyReport(kpis(0, 0, 0.01)), false);
});

test("team reminder email follows the report email voice and links back to the app", () => {
  const email = buildTeamReminderEmail({
    organizationName: "Acme",
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    recipientName: "Dinuda Yaggahavita",
    appOrigin: "https://usejunction.dev/",
  });
  assert.equal(email.subject, "No team AI usage this week · 2026-10-05 – 2026-10-11");
  assert.equal(email.url, "https://usejunction.dev/dashboard");
  assert.match(email.text, /^Hi Dinuda,/);
  assert.match(email.text, /AI usage for Acme this week/);
  assert.match(email.text, /https:\/\/usejunction\.dev\/dashboard/);
  assert.match(email.text, /Junction AI Assistant\nAI Analytics Team$/);
});
