import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GITHUB_INCREMENTAL_MAX_AGE_MS,
  GITHUB_INCREMENTAL_OVERLAP_MS,
  githubFullRefetchRequested,
  repoFetchCutoff,
} from "@/lib/features/github-sync-window";

const now = new Date("2026-10-27T12:00:00.000Z");
const windowCutoff = new Date(now.getTime() - 90 * 86_400_000);
const base = { windowCutoff, syncStatus: "available", fullRefetch: false, now };

test("a repository sealed recently refetches from two days before its last success", () => {
  const lastSuccessAt = new Date("2026-10-26T08:00:00.000Z");
  const result = repoFetchCutoff({ ...base, lastSuccessAt });
  assert.equal(result.mode, "incremental");
  assert.equal(result.cutoff.getTime(), lastSuccessAt.getTime() - GITHUB_INCREMENTAL_OVERLAP_MS);
});

test("never-synced, errored, stale and forced repositories take the full window", () => {
  const recent = new Date("2026-10-26T08:00:00.000Z");
  assert.equal(repoFetchCutoff({ ...base, lastSuccessAt: null }).mode, "full");
  assert.equal(repoFetchCutoff({ ...base, lastSuccessAt: recent, syncStatus: "error" }).mode, "full");
  assert.equal(repoFetchCutoff({ ...base, lastSuccessAt: recent, fullRefetch: true }).mode, "full");
  const stale = new Date(now.getTime() - GITHUB_INCREMENTAL_MAX_AGE_MS - 1);
  assert.equal(repoFetchCutoff({ ...base, lastSuccessAt: stale }).mode, "full");
  for (const result of [
    repoFetchCutoff({ ...base, lastSuccessAt: null }),
    repoFetchCutoff({ ...base, lastSuccessAt: recent, syncStatus: "error" }),
  ]) {
    assert.equal(result.cutoff.getTime(), windowCutoff.getTime());
  }
});

test("an incremental cutoff never reaches back before the cost window", () => {
  const lastSuccessAt = new Date(windowCutoff.getTime() + 86_400_000);
  const result = repoFetchCutoff({ ...base, lastSuccessAt });
  assert.equal(result.mode, "full");
  assert.equal(result.cutoff.getTime(), windowCutoff.getTime());
});

test("the full-refetch flag is read only when set to 1", () => {
  assert.equal(githubFullRefetchRequested({ GITHUB_CODE_SYNC_FULL_REFETCH: "1" } as NodeJS.ProcessEnv), true);
  assert.equal(githubFullRefetchRequested({ GITHUB_CODE_SYNC_FULL_REFETCH: "true" } as NodeJS.ProcessEnv), false);
  assert.equal(githubFullRefetchRequested({} as NodeJS.ProcessEnv), false);
});
