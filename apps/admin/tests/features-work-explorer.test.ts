import assert from "node:assert/strict";
import { test } from "vitest";
import { commitChangeType, compareCost, groupWorkByRepository, type WorkCommit } from "@/lib/features/work-explorer";

function commit(overrides: Partial<WorkCommit> = {}): WorkCommit {
  return { sha: "abc123", headline: "feat: checkout", authoredAt: "2026-09-20T12:00:00.000Z", authorLogin: "ada", repository: { owner: "acme", name: "web" }, verifiedMicros: "1000001", estimatedMicros: "2000002", developers: ["Ada"], ...overrides };
}

test("groups repository work with exact separate costs, contributors and change counts", () => {
  const groups = groupWorkByRepository([
    commit(),
    commit({ sha: "def456", headline: "fix: checkout", verifiedMicros: "9007199254740993", estimatedMicros: "0", authoredAt: "2026-09-22T12:00:00.000Z" }),
    commit({ repository: { owner: "other", name: "web" }, authorLogin: "ben" }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].verifiedMicros, BigInt("9007199255740994"));
  assert.equal(groups[0].estimatedMicros, BigInt("2000002"));
  assert.equal(groups[0].contributors.size, 1);
  assert.equal(groups[0].changes.get("Features"), 1);
  assert.equal(groups[0].changes.get("Fixes"), 1);
  assert.equal(groups[0].commits[0].sha, "def456");
});

test("search and change filters recalculate totals from only matching commits", () => {
  const commits = [commit(), commit({ sha: "def456", headline: "fix(auth)!: sign in", estimatedMicros: "42" })];
  const groups = groupWorkByRepository(commits, " ADA ", "Fixes");
  assert.equal(groups[0].commits.length, 1);
  assert.equal(groups[0].estimatedMicros, BigInt(42));
  assert.equal(groupWorkByRepository(commits, "missing").length, 0);
  assert.equal(groupWorkByRepository(commits, "DEF456")[0].commits.length, 1);
});

test("classification uses explicit conventional prefixes and never fabricates feature names", () => {
  assert.equal(commitChangeType("feat(payments)!: change API"), "Features");
  assert.equal(commitChangeType("FIX: restore login"), "Fixes");
  assert.equal(commitChangeType("support new features"), "Other changes");
  assert.equal(commitChangeType("unknown: a thing"), "Other changes");
});

test("highest-cost sorting preserves precision beyond Number safe range", () => {
  assert.equal(compareCost({ verifiedMicros: "9007199254740993", estimatedMicros: "0" }, { verifiedMicros: "9007199254740992", estimatedMicros: "0" }), -1);
});
