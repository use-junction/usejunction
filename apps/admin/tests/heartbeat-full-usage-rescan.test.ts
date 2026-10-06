import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  device: null as null | Record<string, unknown>,
  getFullUsageRescanDay: vi.fn(),
  updateDirectiveForHeartbeat: vi.fn(),
  recordDeviceActivityEvent: vi.fn(),
  transaction: vi.fn(),
  pendingRemoteSyncCount: vi.fn(),
  githubAuthorIdentity: vi.fn(),
  githubConnection: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      mocks.transaction(fn),
    device: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    deviceSyncRequestTarget: {
      count: mocks.pendingRemoteSyncCount,
    },
    externalIdentity: {
      findFirst: mocks.githubAuthorIdentity,
    },
    providerConnection: {
      findFirst: mocks.githubConnection,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  findDeviceByBearerToken: async () => mocks.device,
}));

vi.mock("@/lib/agent-updates", () => ({
  updateDirectiveForHeartbeat: mocks.updateDirectiveForHeartbeat,
  normalizeAgentVersion: (v: string) => v,
}));

vi.mock("@/lib/activity/record-device-activity-event", () => ({
  recordDeviceActivityEvent: mocks.recordDeviceActivityEvent,
}));

vi.mock("@/lib/runtime-settings", () => ({
  getFullUsageRescanDay: mocks.getFullUsageRescanDay,
}));

vi.mock("@/lib/devices/decommission", () => ({
  revokeDeviceAuth: vi.fn(),
}));

vi.mock("@/lib/security", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  hashOpaqueToken: (v: string) => `hash:${v}`,
}));

vi.mock("@/lib/security/http", () => ({
  limitedJson: async () => ({
    ok: true,
    data: {
      hostname: "macbook",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "0.3.4",
      localEndpoint: "http://127.0.0.1:47832",
      localSyncToken: "uj_local_secret_token",
    },
  }),
}));

vi.mock("@/lib/errors/public", () => ({
  logServerError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.device = {
    id: "dev_1",
    orgId: "org_1",
    userId: "user_1",
    hostname: "macbook",
    os: "darwin",
    architecture: "arm64",
    agentVersion: "0.3.4",
    decommissionedAt: null,
    user: { removedAt: null },
  };
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      device: {
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    }),
  );
  mocks.updateDirectiveForHeartbeat.mockResolvedValue(null);
  mocks.recordDeviceActivityEvent.mockResolvedValue(undefined);
  mocks.getFullUsageRescanDay.mockResolvedValue("2026-07-21");
  mocks.pendingRemoteSyncCount.mockResolvedValue(0);
  mocks.githubAuthorIdentity.mockResolvedValue(null);
  mocks.githubConnection.mockResolvedValue(null);
});

test("heartbeat surfaces fullUsageRescanDay from runtime settings", async () => {
  const { POST } = await import("@/app/api/devices/heartbeat/route");
  const response = await POST(
    new Request("http://localhost/api/devices/heartbeat", {
      method: "POST",
      headers: { authorization: "Bearer device-token" },
    }) as never,
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.fullUsageRescanDay, "2026-07-21");
  assert.equal(mocks.getFullUsageRescanDay.mock.calls.length, 1);
});

test("heartbeat omits fullUsageRescanDay when unset", async () => {
  mocks.getFullUsageRescanDay.mockResolvedValue(null);
  const { POST } = await import("@/app/api/devices/heartbeat/route");
  const response = await POST(
    new Request("http://localhost/api/devices/heartbeat", {
      method: "POST",
      headers: { authorization: "Bearer device-token" },
    }) as never,
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.fullUsageRescanDay, undefined);
});

test("heartbeat asks mapped GitHub-author daemons to claim Features usage syncs", async () => {
  mocks.pendingRemoteSyncCount.mockResolvedValue(2);
  mocks.githubAuthorIdentity.mockResolvedValue({ id: "ident-1" });
  mocks.githubConnection.mockResolvedValue({ id: "conn-1" });
  const { POST } = await import("@/app/api/devices/heartbeat/route");
  const response = await POST(
    new Request("http://localhost/api/devices/heartbeat", {
      method: "POST",
      headers: { authorization: "Bearer device-token" },
    }) as never,
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pendingRemoteSync, true);
  assert.equal(body.featuresAuthorSync, true);
});
