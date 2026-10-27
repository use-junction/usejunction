import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  providerConnection: { findMany: vi.fn(), updateMany: vi.fn() },
}));
const syncMocks = vi.hoisted(() => ({
  syncConnection: vi.fn(),
  releaseConnectionLease: vi.fn(),
  logServerError: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({ prisma: prismaMocks }));
vi.mock("@/lib/integrations/sync", () => ({
  syncConnection: syncMocks.syncConnection,
  releaseConnectionLease: syncMocks.releaseConnectionLease,
}));
vi.mock("@/lib/errors/public", () => ({ logServerError: syncMocks.logServerError }));

const now = new Date("2026-10-27T15:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.providerConnection.updateMany.mockResolvedValue({ count: 1 });
  syncMocks.releaseConnectionLease.mockResolvedValue(undefined);
});

test("claims GitHub connections the scheduler left overdue and leases them", async () => {
  prismaMocks.providerConnection.findMany.mockResolvedValue([{ id: "never-synced" }, { id: "overdue" }]);
  const { claimStaleGitHubConnections, STALE_GITHUB_SYNC_GRACE_MS } = await import("@/lib/integrations/stale-resync");
  const claimed = await claimStaleGitHubConnections("org-1", { now });
  assert.deepEqual(claimed, ["never-synced", "overdue"]);

  const where = prismaMocks.providerConnection.findMany.mock.calls[0]?.[0].where;
  assert.equal(where.orgId, "org-1");
  assert.equal(where.provider, "github");
  // Due more than the grace period ago, or never scheduled, and not leased by another runner.
  assert.deepEqual(where.AND[0], {
    OR: [{ nextSyncAt: null }, { nextSyncAt: { lt: new Date(now.getTime() - STALE_GITHUB_SYNC_GRACE_MS) } }],
  });
  assert.deepEqual(where.AND[1], { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] });

  const lease = prismaMocks.providerConnection.updateMany.mock.calls[0]?.[0];
  assert.deepEqual(lease.where, { id: "never-synced", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] });
  assert.deepEqual(lease.data, { leaseUntil: new Date(now.getTime() + 5 * 60_000) });
});

test("a connection another runner leased first is not claimed", async () => {
  prismaMocks.providerConnection.findMany.mockResolvedValue([{ id: "raced" }, { id: "free" }]);
  prismaMocks.providerConnection.updateMany
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 1 });
  const { claimStaleGitHubConnections } = await import("@/lib/integrations/stale-resync");
  assert.deepEqual(await claimStaleGitHubConnections("org-1", { now }), ["free"]);
});

test("a page view resyncs every claimed connection after the response", async () => {
  prismaMocks.providerConnection.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  syncMocks.syncConnection.mockImplementation(async (id: string) => {
    if (id === "a") throw new Error("GitHub down");
    return { githubRepos: 2 };
  });
  const { resyncStaleGitHubConnections } = await import("@/lib/integrations/stale-resync");
  const scheduled: Array<() => Promise<void>> = [];
  const claimed = await resyncStaleGitHubConnections("org-1", (task) => scheduled.push(task), { now });
  assert.deepEqual(claimed, ["a", "b"]);
  assert.equal(scheduled.length, 1);
  assert.equal(syncMocks.syncConnection.mock.calls.length, 0, "nothing runs before the response is sent");

  await scheduled[0]!();
  assert.deepEqual(syncMocks.syncConnection.mock.calls.map((call) => call[0]), ["a", "b"]);
  for (const call of syncMocks.syncConnection.mock.calls) {
    assert.ok((call[1] as { deadline: Date }).deadline instanceof Date, "each sync gets the request deadline");
  }
  // The failure on "a" is logged and does not stop "b".
  assert.equal(syncMocks.logServerError.mock.calls.length, 1);
});

test("nothing is scheduled when no connection is overdue", async () => {
  prismaMocks.providerConnection.findMany.mockResolvedValue([]);
  const { resyncStaleGitHubConnections } = await import("@/lib/integrations/stale-resync");
  const schedule = vi.fn();
  assert.deepEqual(await resyncStaleGitHubConnections("org-1", schedule, { now }), []);
  assert.equal(schedule.mock.calls.length, 0);
});

test("a claim failure is logged and the page still loads", async () => {
  prismaMocks.providerConnection.findMany.mockRejectedValue(new Error("db down"));
  const { resyncStaleGitHubConnections } = await import("@/lib/integrations/stale-resync");
  const schedule = vi.fn();
  assert.deepEqual(await resyncStaleGitHubConnections("org-1", schedule, { now }), []);
  assert.equal(schedule.mock.calls.length, 0);
  assert.equal(syncMocks.logServerError.mock.calls.length, 1);
});
