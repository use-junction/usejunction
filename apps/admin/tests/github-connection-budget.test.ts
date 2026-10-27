import assert from "node:assert/strict";
import { test } from "vitest";
import { githubBudgetExhaustedMessage, githubCodeSyncBudgetMs, githubSyncStoppedMessage } from "@/lib/features/github-code-sync";
import { githubConnectionView } from "@/lib/integrations/github-connections";

const granted = { pull_requests: "read", contents: "read", metadata: "read" };

function connection(overrides: Partial<Parameters<typeof githubConnectionView>[0]> = {}) {
  return {
    id: "conn-1",
    externalOrgId: "Dinuda",
    config: { installationId: "123", accountType: "User", org: "Dinuda" },
    permissions: granted,
    lastSyncedAt: new Date("2026-10-27T10:00:00.000Z"),
    lastError: null,
    capabilities: [],
    ...overrides,
  };
}

test("a run stopped at its time budget shows as partial with the progress note", () => {
  const note = githubBudgetExhaustedMessage(40, 120);
  const view = githubConnectionView(connection({
    capabilities: [{ capability: "pull_requests", status: "partial", lastError: note }],
  }));
  assert.equal(view.state, "partial");
  assert.equal(view.lastError, note);
  assert.match(note, /40 of 120/);
  assert.match(note, /remaining 80/);
  assert.match(note, /Sync now/);

  const stoppedNote = githubSyncStoppedMessage(6, 15);
  assert.match(stoppedNote, /stopped at your request after 6 of 15/);
  assert.match(stoppedNote, /remaining 9/);
  assert.equal(githubConnectionView(connection({
    capabilities: [{ capability: "pull_requests", status: "partial", lastError: stoppedNote }],
  })).state, "partial");
});

test("a completed personal sync is ready, and a never-finished one still reads as syncing", () => {
  const ready = githubConnectionView(connection({
    capabilities: [{ capability: "pull_requests", status: "available", lastError: null }],
  }));
  assert.equal(ready.state, "ready");
  const pending = githubConnectionView(connection({ lastSyncedAt: null }));
  assert.equal(pending.state, "syncing");
});

test("code sync budget defaults to two minutes and honours the env override", () => {
  const previous = process.env.GITHUB_CODE_SYNC_BUDGET_MS;
  delete process.env.GITHUB_CODE_SYNC_BUDGET_MS;
  assert.equal(githubCodeSyncBudgetMs(), 120_000);
  process.env.GITHUB_CODE_SYNC_BUDGET_MS = "45000";
  assert.equal(githubCodeSyncBudgetMs(), 45_000);
  process.env.GITHUB_CODE_SYNC_BUDGET_MS = "nope";
  assert.equal(githubCodeSyncBudgetMs(), 120_000);
  if (previous === undefined) delete process.env.GITHUB_CODE_SYNC_BUDGET_MS;
  else process.env.GITHUB_CODE_SYNC_BUDGET_MS = previous;
});
