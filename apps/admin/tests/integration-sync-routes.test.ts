import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  audit: vi.fn(),
  syncConnection: vi.fn(),
  requestProviderSyncStop: vi.fn(),
  providerConnection: { findFirst: vi.fn() },
  logServerError: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  audit: mocks.audit,
  rolesFor: () => ["owner", "admin"],
}));
vi.mock("@usejunction/db", () => ({ prisma: { providerConnection: mocks.providerConnection } }));
vi.mock("@/lib/integrations/sync", () => ({ syncConnection: mocks.syncConnection }));
vi.mock("@/lib/integrations/sync-stop", () => ({ requestProviderSyncStop: mocks.requestProviderSyncStop }));
vi.mock("@/lib/errors/public", () => ({ logServerError: mocks.logServerError }));

const params = Promise.resolve({ id: "conn-1" });

function post(path: string) {
  return new NextRequest(`http://localhost:3001${path}`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgRole.mockResolvedValue({ orgId: "org-1", userId: "owner-1", role: "owner", email: "owner@example.com" });
  mocks.providerConnection.findFirst.mockResolvedValue({ id: "conn-1" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.requestProviderSyncStop.mockResolvedValue(undefined);
});

test("a manual sync gets the whole request as its budget and wakes author daemons", async () => {
  mocks.syncConnection.mockResolvedValue({ githubRepos: 15, githubDeferredRepos: 0 });
  const { POST } = await import("@/app/api/integrations/[id]/sync/route");
  const started = Date.now();
  const response = await POST(post("/api/integrations/conn-1/sync"), { params });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, counts: { githubRepos: 15, githubDeferredRepos: 0 } });
  const options = mocks.syncConnection.mock.calls[0]?.[1] as { deadline: Date; forceAuthorWake: boolean };
  const budget = options.deadline.getTime() - started;
  assert.ok(budget >= 269_000 && budget <= 271_000, `expected a 270 s budget, got ${budget} ms`);
  assert.equal(options.forceAuthorWake, true);
  assert.equal(mocks.audit.mock.calls[0]?.[0]?.action, "integration.synced");
});

test("a stop request is recorded and audited for a connection in the caller's workspace", async () => {
  const { POST } = await import("@/app/api/integrations/[id]/sync/stop/route");
  const response = await POST(post("/api/integrations/conn-1/sync/stop"), { params });
  assert.equal(response.status, 200);
  assert.deepEqual(mocks.requestProviderSyncStop.mock.calls.map((call) => call[0]), ["conn-1"]);
  assert.equal(mocks.audit.mock.calls[0]?.[0]?.action, "integration.sync_stop_requested");
});

test("a stop request for a connection outside the workspace is refused", async () => {
  mocks.providerConnection.findFirst.mockResolvedValue(null);
  const { POST } = await import("@/app/api/integrations/[id]/sync/stop/route");
  const response = await POST(post("/api/integrations/conn-1/sync/stop"), { params });
  assert.equal(response.status, 404);
  assert.equal(mocks.requestProviderSyncStop.mock.calls.length, 0);
});
