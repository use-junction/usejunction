import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { buildDailyReportEmailDocument } from "@/lib/email/daily-report-html";
import { buildSampleReport } from "@/lib/reports/sample-report";

describe("sample report", () => {
  const today = new Date("2026-10-08T12:00:00.000Z"); // Thursday

  test("personal sample is today's daily email", () => {
    const report = buildSampleReport("you", today);
    assert.equal(report.kind, "personal");
    assert.equal(report.localDate, "2026-10-08");
    const built = buildDailyReportEmailDocument({ report, recipientName: "Sam", appOrigin: "http://localhost:3001" });
    assert.match(built.subject, /Your UseJunction day · 2026-10-08/);
    assert.match(built.html, /Sam/);
  });

  test("team sample is the last full Mon–Sun week", () => {
    const report = buildSampleReport("team", today);
    assert.equal(report.period, "week");
    assert.equal(report.weekStart, "2026-09-28");
    assert.equal(report.weekEnd, "2026-10-04");
    const built = buildDailyReportEmailDocument({ report, appOrigin: "http://localhost:3001" });
    assert.match(built.subject, /Team week · 2026-09-28 – 2026-10-04/);
  });
});
