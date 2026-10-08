import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { buildDailyReportEmail, buildReportEmailText, reportsEmailFrom } from "@/lib/email/daily-report";
import { buildEmailColumnChartHtml } from "@/lib/email/daily-report-html";
import { buildDailyReportPdfHtml, buildPdfAreaChartSvg } from "@/lib/email/daily-report-pdf";
import { buildEmailWowWeekStripHtml, buildPdfWowWeekStripSvg } from "@/lib/email/wow-week-strip-render";
import type { DailyReportPayload } from "@/lib/reports/daily-report";
import { buildWowWeekStrip, type WowDayTotals } from "@/lib/reports/wow-week-strip";

function sampleStrip() {
  const currentByDate = new Map<string, WowDayTotals>([
    ["2026-07-20", { tokens: 10, cost: 0.1, requests: 2 }],
    ["2026-07-21", { tokens: 3400, cost: 1.25, requests: 12 }],
  ]);
  const priorByDate = new Map<string, WowDayTotals>([
    ["2026-07-19", { tokens: 8, cost: 0.1, requests: 2 }],
    ["2026-07-20", { tokens: 2000, cost: 0.8, requests: 8 }],
  ]);
  return buildWowWeekStrip({
    asOfLocalDate: "2026-07-21",
    timeZone: "Asia/Colombo",
    weekStart: "2026-07-20",
    weekEnd: "2026-07-26",
    currentByDate,
    priorByDate,
    topToolDisplayName: "ChatGPT",
    todayPartial: true,
  });
}

const report: DailyReportPayload = {
  kind: "personal",
  period: "day",
  localDate: "2026-07-21",
  timeZone: "Asia/Colombo",
  title: "Your day.",
  subtitle: "2026-07-21 · Asia/Colombo",
  kpis: {
    requests: 12,
    tokens: 3400,
    cost: 1.25,
    tools: 2,
    requestsDeltaPct: 10,
    tokensDeltaPct: 8,
    costDeltaPct: -5,
    planUsedPercent: 42,
    acceptancePercent: 61,
  },
  plan: {
    usedPercent: 42,
    statusLabel: "Within allowance",
    withinAllowance: true,
    hint: "Usage is well within the included plan allowance",
    tools: [
      {
        toolName: "cursor",
        displayName: "Cursor",
        usedPercent: 42,
        statusLabel: "Within allowance",
        withinAllowance: true,
      },
    ],
  },
  series: [
    { label: "Mon", requests: 2, tokens: 10, cost: 0.1 },
    { label: "Tue", requests: 12, tokens: 3400, cost: 1.25 },
    { label: "Wed", requests: 0, tokens: 0, cost: 0 },
    { label: "Thu", requests: 0, tokens: 0, cost: 0 },
    { label: "Fri", requests: 0, tokens: 0, cost: 0 },
    { label: "Sat", requests: 0, tokens: 0, cost: 0 },
    { label: "Sun", requests: 0, tokens: 0, cost: 0 },
  ],
  wowStrip: sampleStrip(),
  topTools: [
    {
      toolName: "chatgpt",
      displayName: "ChatGPT",
      requests: 8,
      tokens: 2000,
      cost: 0.9,
      sharePercent: 72,
      tokenSharePercent: 59,
    },
    {
      toolName: "cursor",
      displayName: "Cursor",
      requests: 4,
      tokens: 1400,
      cost: 0.35,
      sharePercent: 28,
      tokenSharePercent: 41,
    },
  ],
};

describe("daily report email", () => {
  test("includes deep link with date and settings opt-out", () => {
    const built = buildDailyReportEmail({ report, recipientName: "Dinuda" });
    assert.match(built.subject, /Your UseJunction day/);
    assert.match(built.html, /Open today's report/);
    assert.match(built.url, /\/reports\?scope=you&date=2026-07-21$/);
    assert.match(built.html, /\/settings/);
    assert.match(built.text, /Manage email reports|Turn off daily emails/);
  });

  test("includes plan status, usage KPIs, and clean section titles", () => {
    const built = buildDailyReportEmail({ report, recipientName: "Dinuda" });
    assert.match(built.html, /Good evening, Dinuda/);
    assert.match(built.html, /usejunction\.png/);
    assert.match(built.html, /alt="UseJunction"/);
    assert.match(built.html, />Plan status</);
    assert.doesNotMatch(built.html, /Plan status · billing cycle/);
    assert.match(built.html, /Within allowance/);
    assert.match(built.html, /Plan usage/);
    assert.match(built.html, /42%/);
    assert.match(built.html, />Usage by tool today</);
    assert.doesNotMatch(built.html, /Usage by tool · today/);
    assert.match(built.html, /ChatGPT/);
    assert.doesNotMatch(built.html, /Today · You/);
    assert.doesNotMatch(built.html, /750K tokens and/);
    assert.doesNotMatch(built.html, /#e5ec67/);
    assert.doesNotMatch(built.html, /<svg/);
  });

  test("labels request-only tools without inventing token share", () => {
    const built = buildDailyReportEmail({
      report: {
        ...report,
        kpis: { ...report.kpis, tokens: 0, cost: 0, requests: 47, tokensDeltaPct: -100 },
        topTools: [
          {
            toolName: "antigravity",
            displayName: "Antigravity",
            requests: 47,
            tokens: 0,
            cost: 0,
            sharePercent: 0,
            tokenSharePercent: 0,
          },
        ],
      },
      recipientName: "Dinuda",
    });
    assert.match(built.html, /tokens not reported/);
    assert.match(built.html, /vs yesterday|led today|Quiet day/);
    assert.match(built.html, /47 req/);
  });

  test("column chart encodes peak bar", () => {
    const html = buildEmailColumnChartHtml(
      [
        { label: "10:00", requests: 3, tokens: 100, cost: 0.1 },
        { label: "14:00", requests: 5, tokens: 200, cost: 0.5 },
        { label: "18:00", requests: 4, tokens: 150, cost: 0.65 },
      ],
      "tokens",
    );
    assert.match(html, /height="\d+"/);
    assert.match(html, /14:00|18:00/);
  });

  test("email prefers WOW week strip over hourly chart", () => {
    const built = buildDailyReportEmail({ report, recipientName: "Dinuda" });
    assert.match(built.html, /Mon|Tue|Wed/);
    assert.match(built.html, /Tokens this week/);
    assert.doesNotMatch(built.html, /Tokens this week · vs yesterday/);
    assert.doesNotMatch(built.html, /Tokens · key moments/);
    assert.doesNotMatch(built.html, /<svg/);
  });

  test("email WOW strip render includes weekday cells and token counts", () => {
    const html = buildEmailWowWeekStripHtml(report.wowStrip!);
    assert.match(html, /Mon/);
    assert.match(html, /Tue/);
    assert.match(html, /Tokens this week/);
    assert.doesNotMatch(html, /vs yesterday/);
  });

  test("team weekly report links with period=week", () => {
    const built = buildDailyReportEmail({
      report: {
        ...report,
        kind: "org",
        period: "week",
        localDate: "2026-07-26",
        weekStart: "2026-07-20",
        weekEnd: "2026-07-26",
        title: "Team week.",
        subtitle: "Acme · 2026-07-20 – 2026-07-26 · Asia/Colombo",
        membersActive: 3,
      },
    });
    assert.match(built.subject, /Team week/);
    assert.match(built.url, /\/reports\?scope=team&date=2026-07-26&period=week$/);
    assert.match(built.html, /Open this week's report/);
    assert.match(built.html, /Sent Sundays at 19:00/);
    assert.doesNotMatch(built.url, /scope=you/);
  });
});

describe("daily report send email", () => {
  test("uses plain text body with attachment notice", () => {
    const text = buildReportEmailText({
      report,
      recipientName: "Dinuda",
    });
    assert.match(text, /^Hi Dinuda,/);
    assert.match(text, /Please find your AI use report for today attached as a PDF\./);
    assert.match(text, /Best regards,\nJunction AI Assistant\nAI Analytics Team/);
    assert.doesNotMatch(text, /Manage email reports/);
    assert.doesNotMatch(text, /<html/i);
    assert.doesNotMatch(text, /Open today's report/);
  });

  test("reports sender uses configured address", () => {
    const prev = process.env.REPORTS_EMAIL_FROM;
    process.env.REPORTS_EMAIL_FROM = "UseJunction <reporting@usejunction.dev>";
    try {
      assert.equal(reportsEmailFrom(), "UseJunction <reporting@usejunction.dev>");
    } finally {
      if (prev) process.env.REPORTS_EMAIL_FROM = prev;
      else delete process.env.REPORTS_EMAIL_FROM;
    }
  });
});

describe("daily report PDF document", () => {
  test("builds polished PDF HTML with WOW strip, plan status, and KPIs", () => {
    const pdf = buildDailyReportPdfHtml({
      report,
      recipientName: "Dinuda",
      appOrigin: "https://app.usejunction.com",
    });
    assert.match(pdf.filename, /usejunction-day-2026-07-21\.pdf/);
    assert.match(pdf.subject, /Your UseJunction day/);
    assert.match(pdf.html, /Good evening, Dinuda/);
    assert.match(pdf.html, /<svg/);
    assert.match(pdf.html, /Plan status/);
    assert.match(pdf.html, /Within allowance/);
    assert.match(pdf.html, /Plan usage/);
    assert.match(pdf.html, />Plan status</);
    assert.match(pdf.html, />Usage by tool today</);
    assert.match(pdf.html, /Tokens this week/);
    assert.doesNotMatch(pdf.html, /Tokens this week · vs yesterday/);
    assert.match(pdf.html, /Today's spend/);
    assert.doesNotMatch(pdf.html, /Tokens by hour/);
    assert.doesNotMatch(pdf.html, /Today · You/);
    assert.doesNotMatch(pdf.html, /#e5ec67/);
    assert.match(pdf.html, /class="actions"/);
    assert.match(pdf.html, /margin-left: auto/);
  });

  test("SVG area chart includes peak halo", () => {
    const svg = buildPdfAreaChartSvg(
      [
        { label: "10:00", requests: 3, tokens: 100, cost: 0.1 },
        { label: "14:00", requests: 5, tokens: 200, cost: 0.5 },
        { label: "18:00", requests: 4, tokens: 150, cost: 0.65 },
      ],
      "tokens",
    );
    assert.match(svg, /<svg/);
    assert.match(svg, /<rect/);
    assert.match(svg, /#08758a/);
  });

  test("PDF WOW strip SVG includes weekday labels", () => {
    const svg = buildPdfWowWeekStripSvg(report.wowStrip!);
    assert.match(svg, /<svg/);
    assert.match(svg, /Mon/);
    assert.match(svg, /Tue/);
  });
});
