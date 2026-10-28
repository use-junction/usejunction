import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import {
  bulkUpsertCommits,
  bulkUpsertGitHubIdentities,
  bulkUpsertPullRequests,
  restampGitAuthors,
} from "@/lib/features/github-code-writes";

const runDb = Boolean(process.env.DATABASE_URL);

/**
 * The batched writers are raw SQL, which nothing type-checks against the schema.
 * This runs each statement against a real database so a renamed column fails here
 * rather than in production.
 */
test("batched GitHub writes round-trip through Postgres with the documented conflict rules", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: `Writes Org ${suffix}`, slug: `writes-${suffix}` } });
  try {
    const developer = await prisma.developer.create({ data: { orgId: org.id, email: `ada-${suffix}@example.com`, name: "Ada", role: "user" } });
    const connection = await prisma.providerConnection.create({
      data: { orgId: org.id, provider: "github", product: "copilot", method: "oauth", status: "active", createdByUserId: `user-${suffix}` },
    });
    const repository = await prisma.repository.create({ data: { orgId: org.id, host: "github.com", owner: "ada", name: `repo-${suffix}` } });
    const when = new Date("2026-10-26T09:00:00.000Z");

    // Pull requests: insert, then update the same number and get the same id back.
    const base = {
      orgId: org.id, connectionId: connection.id, repositoryId: repository.id, state: "merged", headRefName: "feat", baseRefName: "main",
      authorLogin: "ada", authorDeveloperId: null, url: null, githubCreatedAt: when, mergedAt: when, closedAt: null,
      additions: 1, deletions: 2, changedFiles: 3, ticketKeys: ["UJ-1"], closingIssues: [{ number: 9, title: null, url: null }],
    };
    const first = await bulkUpsertPullRequests([{ ...base, number: 1, title: "first" }, { ...base, number: 2, title: "second" }]);
    assert.equal(first.length, 2);
    const again = await bulkUpsertPullRequests([{ ...base, number: 1, title: "first, renamed" }]);
    assert.equal(again[0]?.id, first.find((row) => row.number === 1)?.id, "an update returns the existing id");
    const stored = await prisma.gitPullRequest.findUniqueOrThrow({ where: { repositoryId_number: { repositoryId: repository.id, number: 1 } } });
    assert.equal(stored.title, "first, renamed");
    assert.deepEqual(stored.ticketKeys, ["UJ-1"]);
    assert.equal(stored.mergedAt?.toISOString(), when.toISOString());

    // Commits: a later row without a pull-request link keeps the one already stored.
    const prId = again[0]!.id;
    const commit = {
      orgId: org.id, repositoryId: repository.id, sha: `sha-${suffix}`, authoredAt: when, committedAt: when, authorEmail: null, authorLogin: "ada",
      authorDeveloperId: null, messageHeadline: "feat", additions: 5, deletions: 0, pullRequestId: prId, isDirectPush: false, isBot: false, ticketKeys: [],
    };
    assert.equal(await bulkUpsertCommits([commit]), 1);
    await bulkUpsertCommits([{ ...commit, pullRequestId: null, additions: 6 }]);
    const storedCommit = await prisma.gitCommit.findUniqueOrThrow({ where: { repositoryId_sha: { repositoryId: repository.id, sha: commit.sha } } });
    assert.equal(storedCommit.pullRequestId, prId, "the pull-request link survives a row without one");
    assert.equal(storedCommit.additions, 6, "other columns take the new value");

    // Identities: a match never clears an assigned developer.
    const identity = { orgId: org.id, connectionId: connection.id, login: "ada", email: null, developerId: developer.id, matchedBy: "email", metadata: { githubUserId: 11 } };
    const inserted = await bulkUpsertGitHubIdentities([identity]);
    assert.equal(inserted[0]?.developerId, developer.id);
    const kept = await bulkUpsertGitHubIdentities([{ ...identity, developerId: null, matchedBy: "login" }]);
    assert.equal(kept[0]?.developerId, developer.id, "a null developer does not clear the stored one");
    assert.equal(kept[0]?.matchedBy, "login");

    // Restamp: commits and pull requests for the login pick up the developer in one pass.
    await restampGitAuthors(org.id, [{ login: "ADA", developerId: developer.id }]);
    const restampedCommit = await prisma.gitCommit.findUniqueOrThrow({ where: { repositoryId_sha: { repositoryId: repository.id, sha: commit.sha } } });
    const restampedPr = await prisma.gitPullRequest.findUniqueOrThrow({ where: { repositoryId_number: { repositoryId: repository.id, number: 2 } } });
    assert.equal(restampedCommit.authorDeveloperId, developer.id);
    assert.equal(restampedPr.authorDeveloperId, developer.id);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
