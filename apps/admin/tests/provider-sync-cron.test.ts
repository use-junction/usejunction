import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimDueConnections: vi.fn(),
  syncConnection: vi.fn(),
  releaseConnectionLease: vi.fn(),
  logServerError: vi.fn(),
}));

vi.mock("@/lib/integrations/sync", () => ({
  claimDueConnections: mocks.claimDueConnections,
  syncConnection: mocks.syncConnection,
  releaseConnectionLease: mocks.releaseConnectionLease,
}));
vi.mock("@/lib/errors/public", () => ({ logServerError: mocks.logServerError }));

function request() {
  return new NextRequest("http://localhost:3001/api/cron/provider-sync", {
    method: "POST",
    headers: { authorization: "Bearer development-cron" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.releaseConnectionLease.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

test("every claimed connection gets the request deadline", async () => {
  mocks.claimDueConnections.mockResolvedValue(["conn-a", "conn-b"]);
  mocks.syncConnection.mockResolvedValue({ members: 0 });
  const { POST } = await import("@/app/api/cron/provider-sync/route");
  const started = Date.now();
  const response = await POST(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.claimed, 2);
  assert.deepEqual(body.results.map((row: { id: string; ok: boolean }) => [row.id, row.ok]), [["conn-a", true], ["conn-b", true]]);
  for (const call of mocks.syncConnection.mock.calls) {
    const deadline = (call[1] as { deadline: Date }).deadline;
    assert.ok(deadline.getTime() - started >= 269_000 && deadline.getTime() - started <= 271_000, "deadline is 270 s from the start of the request");
  }
  assert.equal(mocks.releaseConnectionLease.mock.calls.length, 0);
});

test("connections the request cannot reach in time are released instead of started", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
  mocks.claimDueConnections.mockResolvedValue(["slow", "later"]);
  mocks.syncConnection.mockImplementation(async () => {
    // The first sync uses up all but a few seconds of the request budget.
    vi.setSystemTime(new Date("2026-10-27T12:04:25.000Z"));
    return { githubDeferredRepos: 3 };
  });
  const { POST } = await import("@/app/api/cron/provider-sync/route");
  const body = await (await POST(request())).json();
  assert.equal(mocks.syncConnection.mock.calls.length, 1);
  assert.equal(mocks.syncConnection.mock.calls[0]?.[0], "slow");
  assert.deepEqual(mocks.releaseConnectionLease.mock.calls.map((call) => call[0]), ["later"]);
  assert.deepEqual(body.results[1], { id: "later", ok: false, error: "deferred: request time budget exhausted" });
});

test("a failing sync is reported without stopping the others", async () => {
  mocks.claimDueConnections.mockResolvedValue(["bad", "good"]);
  mocks.syncConnection.mockImplementation(async (id: string) => {
    if (id === "bad") throw new Error("boom");
    return { members: 1 };
  });
  const { POST } = await import("@/app/api/cron/provider-sync/route");
  const body = await (await POST(request())).json();
  assert.deepEqual(body.results, [{ id: "bad", ok: false, error: "sync failed" }, { id: "good", ok: true, counts: { members: 1 } }]);
  assert.equal(mocks.logServerError.mock.calls.length, 1);
});

test("rejects callers without the cron secret", async () => {
  const { POST } = await import("@/app/api/cron/provider-sync/route");
  const response = await POST(new NextRequest("http://localhost:3001/api/cron/provider-sync", { method: "POST" }));
  assert.equal(response.status, 401);
  assert.equal(mocks.claimDueConnections.mock.calls.length, 0);
});
