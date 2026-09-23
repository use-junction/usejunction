import assert from "node:assert/strict";
import { beforeEach, afterEach, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  deviceFindUnique: vi.fn(),
  deviceUpdate: vi.fn(),
  workSessionUpsert: vi.fn(),
  getEffectiveSignalsPolicy: vi.fn(),
  enforceSignalsRetention: vi.fn(),
  recordDeviceActivityEvent: vi.fn(),
  deviceActiveAccountAllowed: vi.fn(async () => true),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    device: {
      findUnique: mocks.deviceFindUnique,
      update: mocks.deviceUpdate,
    },
    localWorkSession: { upsert: mocks.workSessionUpsert },
  },
}));

vi.mock("@/lib/ingest/device-context", () => ({
  requireActiveDeviceForIngest: () => mocks.deviceFindUnique(),
}));

vi.mock("@/lib/privacy/account-collection", () => ({
  deviceActiveAccountAllowed: mocks.deviceActiveAccountAllowed,
}));

vi.mock("@/lib/signals/service", () => ({
  getEffectiveSignalsPolicy: mocks.getEffectiveSignalsPolicy,
  enforceSignalsRetention: mocks.enforceSignalsRetention,
}));

vi.mock("@/lib/activity/record-device-activity-event", () => ({
  recordDeviceActivityEvent: mocks.recordDeviceActivityEvent,
  uniqueStrings: (values: string[]) => Array.from(new Set(values)),
}));

function request(sessions: Array<Record<string, unknown>>) {
  return new NextRequest("http://localhost/api/ingest/work-sessions", {
    method: "POST",
    headers: { Authorization: "Bearer device-token", "Content-Type": "application/json" },
    body: JSON.stringify({ sessions }),
  });
}

function session(localId: string, observedAt: string) {
  return {
    localId,
    toolName: "codex",
    observedAt,
    source: "codex_session",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED", "true");
  mocks.deviceFindUnique.mockResolvedValue({
    id: "device_1",
    orgId: "org_1",
    userId: "developer_1",
    agentVersion: "0.3.1",
    createdAt: new Date("2026-07-19T09:00:00.000Z"),
  });
  mocks.getEffectiveSignalsPolicy.mockResolvedValue({
    workExtractionEnabled: true,
    workExtractionStartedAt: "2026-07-19T10:00:00.000Z",
    retentionDays: 90,
  });
  mocks.workSessionUpsert.mockResolvedValue({});
  mocks.deviceUpdate.mockResolvedValue({});
  mocks.enforceSignalsRetention.mockResolvedValue(undefined);
  mocks.recordDeviceActivityEvent.mockResolvedValue(undefined);
  mocks.deviceActiveAccountAllowed.mockResolvedValue(true);
});

test("work ingest skips Cursor and Codex sessions when logging is off", async () => {
  mocks.deviceActiveAccountAllowed.mockResolvedValueOnce(false);
  const { POST } = await import("../app/api/ingest/work-sessions/route");
  const response = await POST(request([session("later", "2026-07-19T10:00:01.000Z")]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    upserted: 0,
    skipped: 1,
    beforeCollectionStartSkipped: 0,
  });
  assert.equal(mocks.workSessionUpsert.mock.calls.length, 0);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("work ingest stores only exact or post-cutoff observations from a mixed batch", async () => {
  const { POST } = await import("../app/api/ingest/work-sessions/route");
  const response = await POST(request([
    session("old", "2026-07-19T09:59:59.999Z"),
    session("exact", "2026-07-19T10:00:00.000Z"),
    session("later", "2026-07-19T10:00:00.001Z"),
  ]));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    upserted: 2,
    skipped: 1,
    beforeCollectionStartSkipped: 1,
  });
  assert.equal(mocks.workSessionUpsert.mock.calls.length, 2);
  assert.deepEqual(
    mocks.workSessionUpsert.mock.calls.map(([input]) => input.create.localId),
    ["exact", "later"],
  );
});

test("work ingest rejects agents from before the forward-only release", async () => {
  mocks.deviceFindUnique.mockResolvedValue({
    id: "device_1",
    orgId: "org_1",
    userId: "developer_1",
    agentVersion: "0.3.0",
    createdAt: new Date("2026-07-19T09:00:00.000Z"),
  });
  const { POST } = await import("../app/api/ingest/work-sessions/route");
  const response = await POST(request([session("later", "2026-07-19T10:00:01.000Z")]));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /agent update required/i);
  assert.equal(mocks.workSessionUpsert.mock.calls.length, 0);
});

test("work ingest applies device enrollment when it is later than workspace enablement", async () => {
  mocks.deviceFindUnique.mockResolvedValue({
    id: "device_1",
    orgId: "org_1",
    userId: "developer_1",
    agentVersion: "0.3.1",
    createdAt: new Date("2026-07-19T11:00:00.000Z"),
  });
  const { POST } = await import("../app/api/ingest/work-sessions/route");
  const response = await POST(request([
    session("before-enrollment", "2026-07-19T10:30:00.000Z"),
    session("after-enrollment", "2026-07-19T11:00:01.000Z"),
  ]));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).beforeCollectionStartSkipped, 1);
  assert.equal(mocks.workSessionUpsert.mock.calls.length, 1);
  assert.equal(mocks.workSessionUpsert.mock.calls[0][0].create.localId, "after-enrollment");
});

test("accepts opencode work sessions from local db extraction", async () => {
  const { POST } = await import("../app/api/ingest/work-sessions/route");
  const response = await POST(request([
    {
      localId: "opencode:ses-work-1",
      toolName: "opencode",
      title: "Ship onboarding polish",
      model: "opencode/big-pickle",
      observedAt: "2026-07-21T12:00:00.000Z",
      startedAt: "2026-07-21T11:00:00.000Z",
      endedAt: "2026-07-21T12:00:00.000Z",
      source: "opencode_sessions",
      trace: {
        location: { kind: "workspace", project: "acme-web" },
        stats: { linesAdded: 42, linesRemoved: 7, filesChanged: 3 },
      },
    },
  ]));

  assert.equal(response.status, 200);
  assert.equal(mocks.workSessionUpsert.mock.calls.length, 1);
  assert.equal(mocks.workSessionUpsert.mock.calls[0][0].create.toolName, "opencode");
  assert.equal(mocks.workSessionUpsert.mock.calls[0][0].create.source, "opencode_sessions");
});
