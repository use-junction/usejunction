import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  loadActivityPage: vi.fn(),
}));

vi.mock("@/lib/api/app-auth", () => ({
  requireAppPrincipal: mocks.requireAppPrincipal,
}));

vi.mock("@/lib/app-pages/activity", () => ({
  loadActivityPage: mocks.loadActivityPage,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAppPrincipal.mockResolvedValue({
    orgId: "org-1",
    userId: "owner-1",
    role: "owner",
  });
  mocks.loadActivityPage.mockResolvedValue({
    kind: "organization",
    scope: "team",
    canSwitchAudience: true,
    allowPeriodControls: true,
    cycleView: "last_30_days",
    rollingPeriod: { kind: "preset", days: 30 },
    periodLabel: "Last 30 days",
    usage: { totals: { requests: 1 } },
    deviceFeed: {
      presenceFallback: false,
      items: [
        {
          id: "exchange:1",
          kind: "usage",
          source: "exchange",
          direction: "ingest",
          status: "ok",
          at: "2026-07-18T16:30:00.000Z",
          title: "Usage sync",
          summary: "Usage sync · 1 row",
          errorCode: null,
          durationMs: 12,
          device: {
            id: "d1",
            hostname: "mac.local",
            os: "darwin",
            architecture: "arm64",
            agentVersion: "0.0.1",
          },
          developer: { id: "dev1", name: "Ada", email: "ada@example.com" },
          details: {},
          inspect: { requestSummary: {}, responseSummary: {} },
        },
      ],
    },
  });
});

test("GET /api/app/activity returns the activity page payload", async () => {
  vi.resetModules();
  const { GET } = await import("../app/api/app/activity/route");
  const response = await GET(
    new NextRequest("http://localhost/api/app/activity?view=last_30_days&scope=team"),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.kind, "organization");
  assert.equal(body.data.scope, "team");
  assert.equal(body.data.deviceFeed.items[0].kind, "usage");
  assert.equal(body.data.deviceFeed.items[0].source, "exchange");
  assert.equal(mocks.loadActivityPage.mock.calls.length, 1);
  assert.deepEqual(mocks.loadActivityPage.mock.calls[0][1], {
    view: "last_30_days",
    days: null,
    from: null,
    to: null,
    scope: "team",
    team: null,
  });
});

test("GET /api/app/activity forwards auth failures", async () => {
  mocks.requireAppPrincipal.mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  vi.resetModules();
  const { GET } = await import("../app/api/app/activity/route");
  const response = await GET(new NextRequest("http://localhost/api/app/activity"));

  assert.equal(response.status, 401);
  assert.equal(mocks.loadActivityPage.mock.calls.length, 0);
});
