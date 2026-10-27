import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { describeConnectionSync } from "@/lib/features/connection-sync-client";

const mocks = vi.hoisted(() => ({
  appRuntimeSetting: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("@usejunction/db", () => ({ prisma: { appRuntimeSetting: mocks.appRuntimeSetting } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appRuntimeSetting.upsert.mockResolvedValue(undefined);
  mocks.appRuntimeSetting.deleteMany.mockResolvedValue({ count: 1 });
});

test("a fresh stop request applies, a stale one from an earlier click does not", async () => {
  const { providerSyncStopRequested, requestProviderSyncStop, providerSyncStopKey } = await import("@/lib/integrations/sync-stop");
  const now = new Date("2026-10-27T15:00:00.000Z");
  await requestProviderSyncStop("conn-1", now);
  assert.equal(mocks.appRuntimeSetting.upsert.mock.calls[0]?.[0]?.where?.key, providerSyncStopKey("conn-1"));

  mocks.appRuntimeSetting.findUnique.mockResolvedValue({ value: now.toISOString() });
  assert.equal(await providerSyncStopRequested("conn-1", { now: new Date(now.getTime() + 60_000) }), true);
  assert.equal(await providerSyncStopRequested("conn-1", { now: new Date(now.getTime() + 11 * 60_000) }), false, "older than ten minutes is ignored");

  mocks.appRuntimeSetting.findUnique.mockResolvedValue(null);
  assert.equal(await providerSyncStopRequested("conn-1"), false);
  mocks.appRuntimeSetting.findUnique.mockResolvedValue({ value: "not-a-date" });
  assert.equal(await providerSyncStopRequested("conn-1"), false);
});

test("sync outcomes read differently for stopped, paused, failed and clean runs", () => {
  const stopped = describeConnectionSync("ada", { githubRepos: 15, githubDeferredRepos: 9, githubStopped: true });
  assert.equal(stopped.kind, "info");
  assert.match(stopped.description, /Synced 6 of 15 repositories/);

  const paused = describeConnectionSync("ada", { githubRepos: 15, githubDeferredRepos: 9 });
  assert.equal(paused.kind, "warning");
  assert.match(paused.title, /time budget/);
  assert.match(paused.description, /remaining 9/);

  const failed = describeConnectionSync("ada", { githubRepos: 15, githubFailedRepos: 2 });
  assert.equal(failed.kind, "warning");
  assert.match(failed.description, /2 repositories could not be checked/);

  const clean = describeConnectionSync("ada", { githubRepos: 15, githubCommits: 420 });
  assert.equal(clean.kind, "success");
  assert.match(clean.description, /15 repositories and 420 commits/);
});
