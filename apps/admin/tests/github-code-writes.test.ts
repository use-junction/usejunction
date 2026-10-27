import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn() }));

vi.mock("@usejunction/db", async () => {
  const actual = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return { prisma: { $queryRaw: mocks.$queryRaw, $executeRaw: mocks.$executeRaw }, Prisma: actual.Prisma };
});

import {
  COMMIT_WRITE_CHUNK,
  IDENTITY_WRITE_CHUNK,
  PULL_REQUEST_WRITE_CHUNK,
  bulkUpsertCommits,
  bulkUpsertGitHubIdentities,
  bulkUpsertPullRequests,
  commitUpsertSql,
  dedupeCommitRows,
  dedupeIdentityRows,
  dedupePullRequestRows,
  identityUpsertSql,
  pullRequestUpsertSql,
  restampGitAuthors,
  restampSql,
  type CommitRow,
  type IdentityRow,
  type PullRequestRow,
} from "@/lib/features/github-code-writes";

const when = new Date("2026-10-27T10:00:00.000Z");

function pullRequest(number: number, overrides: Partial<PullRequestRow> = {}): PullRequestRow {
  return {
    orgId: "org-1", connectionId: "conn-1", repositoryId: "repo-1", number, title: `PR ${number}`, state: "merged",
    headRefName: "feat", baseRefName: "main", authorLogin: "ada", authorDeveloperId: "dev-1", url: null,
    githubCreatedAt: when, mergedAt: when, closedAt: null, additions: 1, deletions: 2, changedFiles: 3,
    ticketKeys: ["UJ-1"], closingIssues: [{ number: 9, title: null, url: null }],
    ...overrides,
  };
}

function commit(sha: string, overrides: Partial<CommitRow> = {}): CommitRow {
  return {
    orgId: "org-1", repositoryId: "repo-1", sha, authoredAt: when, committedAt: when, authorEmail: null, authorLogin: "ada",
    authorDeveloperId: "dev-1", messageHeadline: "feat", additions: 1, deletions: 0, pullRequestId: null, isDirectPush: true, isBot: false, ticketKeys: [],
    ...overrides,
  };
}

function identity(login: string, overrides: Partial<IdentityRow> = {}): IdentityRow {
  return { orgId: "org-1", connectionId: "conn-1", login, email: null, developerId: null, matchedBy: null, metadata: { githubUserId: 1 }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.$queryRaw.mockResolvedValue([]);
  mocks.$executeRaw.mockResolvedValue(1);
});

test("builders dedupe rows so one statement never touches the same row twice", () => {
  assert.deepEqual(dedupePullRequestRows([pullRequest(1, { title: "old" }), pullRequest(2), pullRequest(1, { title: "new" })]).map((row) => row.title), ["new", "PR 2"]);
  assert.deepEqual(dedupeCommitRows([commit("a"), commit("b"), commit("a", { additions: 9 })]).map((row) => `${row.sha}:${row.additions}`), ["a:9", "b:1"]);
  assert.deepEqual(dedupeIdentityRows([identity("Ada"), identity("ada", { developerId: "dev-1" })]).map((row) => `${row.login}:${row.developerId}`), ["ada:dev-1"]);
});

test("pull request statement upserts on (repository_id, number) and returns ids", () => {
  const statement = pullRequestUpsertSql([pullRequest(1), pullRequest(2, { authorLogin: null, authorDeveloperId: null, mergedAt: null })], when);
  assert.equal(typeof statement.sql, "string");
  assert.ok(Array.isArray(statement.values));
  assert.match(statement.sql, /INSERT INTO git_pull_requests/);
  assert.match(statement.sql, /ON CONFLICT \(repository_id, number\) DO UPDATE SET/);
  assert.match(statement.sql, /RETURNING id, number, repository_id/);
  assert.doesNotMatch(statement.sql, /connection_id = EXCLUDED/, "a pull request keeps the connection that first imported it");
  assert.equal(statement.values.length, 2 * 21, "every column is a bound parameter, nulls included");
  assert.equal(statement.values[4], 1);
  assert.equal(statement.values[21 + 9], null, "a null author is bound, not interpolated");
});

test("commit statement keeps an existing pull-request link when the new row has none", () => {
  const statement = commitUpsertSql([commit("a", { pullRequestId: null })]);
  assert.match(statement.sql, /INSERT INTO git_commits/);
  assert.match(statement.sql, /ON CONFLICT \(repository_id, sha\) DO UPDATE SET/);
  assert.match(statement.sql, /pull_request_id = COALESCE\(EXCLUDED\.pull_request_id, git_commits\.pull_request_id\)/);
  assert.equal(statement.values.length, 16);
});

test("identity statement never clears an assigned developer and returns the stored row", () => {
  const statement = identityUpsertSql([identity("ada", { developerId: null, matchedBy: "login" })], when);
  assert.match(statement.sql, /INSERT INTO external_identities/);
  assert.match(statement.sql, /ON CONFLICT \(org_id, provider, external_user_id\) DO UPDATE SET/);
  assert.match(statement.sql, /developer_id = COALESCE\(EXCLUDED\.developer_id, external_identities\.developer_id\)/);
  assert.match(statement.sql, /RETURNING id, external_user_id, email, developer_id, matched_by, metadata/);
  assert.equal(statement.values.length, 11);
  assert.equal(statement.values[3], "github");
  assert.equal(statement.values[7], "vendor_verified");
});

test("executors chunk large inputs and skip empty ones", async () => {
  await bulkUpsertPullRequests([]);
  await bulkUpsertCommits([]);
  await bulkUpsertGitHubIdentities([]);
  await restampGitAuthors("org-1", []);
  assert.equal(mocks.$queryRaw.mock.calls.length, 0);
  assert.equal(mocks.$executeRaw.mock.calls.length, 0);

  mocks.$queryRaw.mockImplementation(async (statement: Prisma.Sql) =>
    Array.from({ length: statement.values.length / 21 }, (_, index) => ({ id: `pr-${index}`, number: index, repository_id: "repo-1" })),
  );
  const prs = Array.from({ length: PULL_REQUEST_WRITE_CHUNK + 1 }, (_, index) => pullRequest(index));
  const returned = await bulkUpsertPullRequests(prs);
  assert.equal(mocks.$queryRaw.mock.calls.length, 2, "one statement per chunk");
  assert.equal(returned.length, PULL_REQUEST_WRITE_CHUNK + 1);

  const commits = Array.from({ length: COMMIT_WRITE_CHUNK * 2 }, (_, index) => commit(`sha-${index}`));
  assert.equal(await bulkUpsertCommits(commits), COMMIT_WRITE_CHUNK * 2);
  assert.equal(mocks.$executeRaw.mock.calls.length, 2);

  mocks.$queryRaw.mockReset();
  mocks.$queryRaw.mockImplementation(async (statement: Prisma.Sql) =>
    Array.from({ length: statement.values.length / 11 }, (_, index) => ({
      id: `id-${index}`, external_user_id: statement.values[index * 11 + 4], email: null, developer_id: null, matched_by: null, metadata: {},
    })),
  );
  const identities = Array.from({ length: IDENTITY_WRITE_CHUNK + 5 }, (_, index) => identity(`user-${index}`));
  const rows = await bulkUpsertGitHubIdentities(identities);
  assert.equal(mocks.$queryRaw.mock.calls.length, 2);
  assert.equal(rows.length, IDENTITY_WRITE_CHUNK + 5);
  assert.equal(rows[0]?.externalUserId, "user-0", "RETURNING rows are mapped back to the cache shape");
});

test("restamp writes every login in two set-based statements per chunk and skips rows already stamped", async () => {
  await restampGitAuthors("org-1", [{ login: "Ada", developerId: "dev-1" }, { login: "ada", developerId: "dev-2" }, { login: "ghost", developerId: null }]);
  assert.equal(mocks.$executeRaw.mock.calls.length, 2, "one statement for commits and one for pull requests");
  const statement = restampSql("git_commits", "org-1", [{ login: "Ada", developerId: "dev-1" }, { login: "ghost", developerId: null }]);
  assert.match(statement.sql, /UPDATE git_commits AS t/);
  assert.match(statement.sql, /IS DISTINCT FROM v\.developer_id/);
  assert.equal(statement.values[0], "ada", "logins are stamped in lower case");
  assert.equal(statement.values[3], null);
});
