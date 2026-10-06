import assert from "node:assert/strict";
import { beforeEach, afterEach, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  deviceFindUnique: vi.fn(),
  deviceUpdate: vi.fn(),
  signalsSessionUpsert: vi.fn(),
  signalsActivityEventUpsert: vi.fn(),
  signalsActivityEventFindMany: vi.fn(),
  getEffectiveSignalsPolicy: vi.fn(),
  enforceSignalsRetention: vi.fn(),
  recordDeviceActivityEvent: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    device: {
      findUnique: mocks.deviceFindUnique,
      update: mocks.deviceUpdate,
    },
    signalsSession: { upsert: mocks.signalsSessionUpsert },
    signalsActivityEvent: {
      upsert: mocks.signalsActivityEventUpsert,
      findMany: mocks.signalsActivityEventFindMany,
    },
  },
}));

vi.mock("@/lib/ingest/device-context", () => ({
  requireActiveDeviceForIngest: () => mocks.deviceFindUnique(),
}));

vi.mock("@/lib/signals/service", () => ({
  getEffectiveSignalsPolicy: mocks.getEffectiveSignalsPolicy,
  enforceSignalsRetention: mocks.enforceSignalsRetention,
}));

vi.mock("@/lib/activity/record-device-activity-event", () => ({
  recordDeviceActivityEvent: mocks.recordDeviceActivityEvent,
  uniqueStrings: (values: string[]) => Array.from(new Set(values.filter(Boolean))),
}));

function request(sessions: Array<Record<string, unknown>>) {
  return new NextRequest("http://localhost/api/ingest/signals-sessions", {
    method: "POST",
    headers: { Authorization: "Bearer device-token", "Content-Type": "application/json" },
    body: JSON.stringify({ sessions }),
  });
}

function session(localId: string) {
  return {
    localId,
    startedAt: "2026-07-19T10:00:00.000Z",
    endedAt: "2026-07-19T10:05:00.000Z",
    durationSeconds: 300,
    aiTool: "cursor",
    appBefore: "Chrome",
    domainBefore: "github.com",
    appAfter: "Slack",
    domainAfter: "slack.com",
    flowSignature: "github->cursor->slack",
    confidence: 0.9,
    collectionMode: "app_domain",
    steps: [
      {
        app: "Chrome",
        domain: "github.com",
        startedAt: "2026-07-19T10:00:00.000Z",
        endedAt: "2026-07-19T10:01:00.000Z",
      },
      {
        app: "Cursor",
        domain: null,
        startedAt: "2026-07-19T10:01:00.000Z",
        endedAt: "2026-07-19T10:04:00.000Z",
      },
      {
        app: "Slack",
        domain: "slack.com",
        startedAt: "2026-07-19T10:04:00.000Z",
        endedAt: "2026-07-19T10:05:00.000Z",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED", "true");
  mocks.deviceFindUnique.mockResolvedValue({
    id: "device_1",
    orgId: "org_1",
    userId: "developer_1",
    hostname: "mac.local",
    user: { removedAt: null },
  });
  mocks.getEffectiveSignalsPolicy.mockResolvedValue({
    enabled: true,
    retentionDays: 90,
    collectionMode: "app_domain",
    excludedApps: [],
    excludedDomains: [],
    storeEvents: true,
    workExtractionEnabled: false,
    rawWorkTextEnabled: false,
    workExtractionStartedAt: null,
    updatedAt: null,
  });
  mocks.signalsSessionUpsert.mockResolvedValue({});
  mocks.signalsActivityEventUpsert.mockResolvedValue({});
  mocks.signalsActivityEventFindMany.mockResolvedValue([]);
  mocks.deviceUpdate.mockResolvedValue({});
  mocks.enforceSignalsRetention.mockResolvedValue(undefined);
  mocks.recordDeviceActivityEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("signals ingest upserts sessions but writes zero signalsActivityEvent rows even when storeEvents is true", async () => {
  const { POST } = await import("../app/api/ingest/signals-sessions/route");
  const response = await POST(request([session("sig-1")]));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { upserted: 1, skipped: 0 });
  assert.equal(mocks.signalsSessionUpsert.mock.calls.length, 1);
  assert.equal(mocks.signalsActivityEventUpsert.mock.calls.length, 0);
  assert.equal(mocks.recordDeviceActivityEvent.mock.calls.length, 1);
  assert.equal(mocks.recordDeviceActivityEvent.mock.calls[0][0].kind, "signals_sessions");

  const storedEvents = await mocks.signalsActivityEventFindMany({ where: { orgId: "org_1" } });
  assert.equal(storedEvents.length, 0);
});
