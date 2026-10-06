import assert from "node:assert/strict";
import { test } from "vitest";
import { allocateDeveloperDay, featureCostWindow, resolveTicketKey, splitMicros } from "@/lib/features/allocate";

const day = "2026-07-10";

test("feature cost window defaults to 90 UTC days", () => {
  const window = featureCostWindow(new Date("2026-09-21T15:00:00.000Z"));
  assert.equal(window.days, 90);
  assert.equal(window.from.toISOString().slice(0, 10), "2026-06-24");
  assert.equal(window.to.toISOString().slice(0, 10), "2026-09-21");
});

test("splitMicros keeps an exact total with largest remainder", () => {
  assert.deepEqual(splitMicros(100n, [2, 1]), [67n, 33n]);
  assert.equal(splitMicros(100n, [2, 1]).reduce((sum, value) => sum + value, 0n), 100n);
});

test("one commit day assigns the full bucket to that pull request", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: "repo-1", costMicros: 5_000_000n },
    commits: [
      { sha: "aaa", pullRequestId: "pr-1", authoredAt: new Date("2026-07-10T12:00:00.000Z"), repositoryId: "repo-1" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.method, "commit_split");
  assert.equal(rows[0]?.pullRequestId, "pr-1");
  assert.equal(rows[0]?.commitSha, null);
  assert.equal(rows[0]?.ticketKey, null);
  assert.equal(rows[0]?.costMicros, 5_000_000n);
});

test("two pull requests split 2:1 by commit count", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "estimated_api", repositoryId: null, costMicros: 90n },
    commits: [
      { sha: "a", pullRequestId: "pr-1", authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "r" },
      { sha: "b", pullRequestId: "pr-1", authoredAt: new Date("2026-07-10T02:00:00.000Z"), repositoryId: "r" },
      { sha: "c", pullRequestId: "pr-2", authoredAt: new Date("2026-07-10T03:00:00.000Z"), repositoryId: "r" },
    ],
  });
  const byPr = Object.fromEntries(rows.map((row) => [row.pullRequestId, row.costMicros]));
  assert.equal(byPr["pr-1"], 60n);
  assert.equal(byPr["pr-2"], 30n);
  assert.equal(rows.reduce((sum, row) => sum + row.costMicros, 0n), 90n);
});

test("commits without a pull request split per SHA", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: "r", costMicros: 40n },
    commits: [
      { sha: "aaa", pullRequestId: null, authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "r" },
      { sha: "bbb", pullRequestId: null, authoredAt: new Date("2026-07-10T02:00:00.000Z"), repositoryId: "r" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.method === "commit_split"));
  assert.ok(rows.every((row) => row.ticketKey === null));
  assert.deepEqual(new Set(rows.map((row) => row.commitSha)), new Set(["aaa", "bbb"]));
  assert.equal(rows.reduce((sum, row) => sum + row.costMicros, 0n), 40n);
});

test("identical pull requests in different repositories keep separate allocations", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: null, costMicros: 30n },
    commits: [
      { sha: "a", pullRequestId: "pr-1", authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "repo-1" },
      { sha: "b", pullRequestId: "pr-1", authoredAt: new Date("2026-07-10T02:00:00.000Z"), repositoryId: "repo-2" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.repositoryId)), new Set(["repo-1", "repo-2"]));
  assert.ok(rows.every((row) => row.costMicros === 15n));
});

test("a repository-scoped bucket cannot allocate into a different repository", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: "repo-1", costMicros: 30n },
    commits: [
      { sha: "a", pullRequestId: null, authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "repo-2" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.method, "unattributed");
  assert.equal(rows[0]?.repositoryId, "repo-1");
});

test("ticket source prefers the commit, then PR title, then PR branch", () => {
  assert.deepEqual(resolveTicketKey({ commitTicketKeys: ["PAY-1"], pullRequestTitle: "PAY-2 Title", pullRequestBranch: "PAY-3-branch" }), {
    ticketKey: "PAY-1", source: "commit",
  });
  assert.deepEqual(resolveTicketKey({ commitTicketKeys: [], pullRequestTitle: "PAY-2 Title", pullRequestBranch: "PAY-3-branch" }), {
    ticketKey: "PAY-2", source: "pr_title",
  });
  assert.deepEqual(resolveTicketKey({ commitTicketKeys: [], pullRequestTitle: "No key", pullRequestBranch: "pay-3-branch" }), {
    ticketKey: "PAY-3", source: "pr_branch",
  });
  assert.deepEqual(resolveTicketKey({ commitTicketKeys: [], pullRequestTitle: "No key", pullRequestBranch: "dependabot/pay-3" }), {
    ticketKey: null, source: null,
  });
});

test("two standalone commits on the same day split 1:1", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: null, costMicros: 100n },
    commits: [
      { sha: "a", pullRequestId: null, authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "r" },
      { sha: "b", pullRequestId: null, authoredAt: new Date("2026-07-10T02:00:00.000Z"), repositoryId: "r" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.costMicros === 50n));
  assert.ok(rows.every((row) => row.method === "commit_split"));
});

test("unattributed remainder when nothing matches", () => {
  const rows = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: null, costMicros: 12n },
    commits: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.method, "unattributed");
  assert.equal(rows[0]?.costMicros, 12n);
});

test("keeps verified and estimated in separate rows", () => {
  const verified = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "verified_usage", repositoryId: null, costMicros: 10n },
    commits: [{ sha: "a", pullRequestId: null, authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "r" }],
  });
  const estimated = allocateDeveloperDay({
    bucket: { developerId: "dev-1", date: day, costKind: "estimated_api", repositoryId: null, costMicros: 20n },
    commits: [{ sha: "a", pullRequestId: null, authoredAt: new Date("2026-07-10T01:00:00.000Z"), repositoryId: "r" }],
  });
  assert.equal(verified[0]?.costKind, "verified_usage");
  assert.equal(estimated[0]?.costKind, "estimated_api");
});
