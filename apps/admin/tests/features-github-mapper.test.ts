import assert from "node:assert/strict";
import { test } from "vitest";
import { mapCommitNode, mapPullRequestNode, mapRestCommit, mergeCommitRecords, PULL_REQUEST_COMMITS_QUERY } from "@/lib/features/github-mapper";
import { githubAppInstallUrl, githubAppOwnerInstallationsUrl, githubAppPermissionsUrl, githubCodePermissionsGranted, githubMembersReadGranted, githubPermissionUpdateUrl, normalizeGitHubAccountType, normalizeGitHubPrivateKey } from "@/lib/integrations/github-app";

test("maps a GraphQL pull request and its commits", () => {
  const mapped = mapPullRequestNode({
    number: 482,
    title: "PAY-219 checkout",
    state: "MERGED",
    headRefName: "feature/pay-219-checkout",
    createdAt: "2026-07-10T10:00:00.000Z",
    mergedAt: "2026-07-10T18:00:00.000Z",
    author: { login: "Ada" },
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    url: "https://github.com/acme/app/pull/482",
    commits: {
      totalCount: 1,
      nodes: [
        {
          commit: {
            oid: "abc123",
            authoredDate: "2026-07-10T12:00:00.000Z",
            committedDate: "2026-07-10T12:00:00.000Z",
            messageHeadline: "PAY-219 implement checkout",
            author: { email: "ada@acme.com", user: { login: "ada" } },
          },
        },
      ],
    },
  });
  assert.ok(mapped);
  assert.equal(mapped?.state, "merged");
  assert.deepEqual(mapped?.ticketKeys, []);
  assert.equal(mapped?.authorLogin, "ada");
  assert.equal(mapped?.authorGithubUserId, null);
  assert.equal(mapped?.commits[0]?.sha, "abc123");
  assert.equal(mapped?.commits[0]?.isDirectPush, false);
});

test("maps GraphQL databaseId onto the commit author", () => {
  const mapped = mapCommitNode({
    oid: "deadbeef",
    authoredDate: "2026-07-10T12:00:00.000Z",
    author: { email: "dinuda@users.noreply.github.com", user: { login: "dinuda", databaseId: 4242 } },
  });
  assert.equal(mapped?.authorLogin, "dinuda");
  assert.equal(mapped?.authorGithubUserId, 4242);
});

test("skips bot commits and prefers the PR-side record on squash merge", () => {
  const bot = mapCommitNode({
    oid: "botsha",
    authoredDate: "2026-07-10T12:00:00.000Z",
    author: { email: "418+dependabot[bot]@users.noreply.github.com", user: { login: "dependabot[bot]" } },
  });
  assert.equal(bot?.isBot, true);

  const prSide = mapCommitNode(
    { oid: "deadbeef", authoredDate: "2026-07-10T12:00:00.000Z", author: { user: { login: "ada" } } },
    { pullRequestNumber: 12, isDirectPush: false },
  );
  const history = mapCommitNode(
    {
      oid: "deadbeef",
      authoredDate: "2026-07-10T12:00:00.000Z",
      author: { user: { login: "ada" } },
      associatedPullRequests: { totalCount: 0, nodes: [] },
    },
    { isDirectPush: true },
  );
  const merged = mergeCommitRecords(history!, prSide!);
  assert.equal(merged.isDirectPush, false);
  assert.equal(merged.pullRequestNumber, 12);
});

test("githubCodePermissionsGranted requires pull_requests and contents", () => {
  assert.equal(githubCodePermissionsGranted({ pull_requests: "read", contents: "read" }), true);
  assert.equal(githubCodePermissionsGranted({ metadata: "read" }), false);
  assert.equal(githubCodePermissionsGranted(["copilot_seats:read"]), false);
  assert.equal(githubMembersReadGranted({ members: "read" }), true);
  assert.equal(githubMembersReadGranted({ pull_requests: "read", contents: "read" }), false);
});

test("permission update URL differs for personal vs organization installs", () => {
  assert.equal(
    githubPermissionUpdateUrl("acme", "123", "Organization"),
    "https://github.com/organizations/acme/settings/installations/123/permissions/update",
  );
  assert.equal(
    githubPermissionUpdateUrl("dinuda", "123", "User"),
    "https://github.com/settings/installations/123/permissions/update",
  );
  assert.equal(normalizeGitHubAccountType("user"), "User");
  assert.equal(normalizeGitHubAccountType("Organization"), "Organization");
  assert.equal(normalizeGitHubAccountType("bot"), null);
  const install = githubAppInstallUrl("usejunction-dinuda", "state.token");
  assert.equal(install, "https://github.com/settings/apps/usejunction-dinuda/installations");
  assert.equal(
    githubAppOwnerInstallationsUrl("usejunction-dinuda"),
    "https://github.com/settings/apps/usejunction-dinuda/installations",
  );
  assert.equal(
    githubAppOwnerInstallationsUrl("usejunction-dinuda"),
    "https://github.com/settings/apps/usejunction-dinuda/installations",
  );
  assert.equal(
    githubAppPermissionsUrl("usejunction-dinuda"),
    "https://github.com/settings/apps/usejunction-dinuda/permissions",
  );
  const oneLinePem = "-----BEGIN RSA PRIVATE KEY----- ABCDEFGHIJKLMNOPQRSTUVWXYZ -----END RSA PRIVATE KEY-----";
  assert.match(normalizeGitHubPrivateKey(oneLinePem), /^-----BEGIN RSA PRIVATE KEY-----\n/);
  assert.match(normalizeGitHubPrivateKey(oneLinePem), /\n-----END RSA PRIVATE KEY-----\n$/);
});

test("maps REST commits and pages extra PR commit fields", () => {
  const mapped = mapRestCommit({
    sha: "abc123def",
    commit: {
      message: "feat: wire org sync\n\nbody",
      author: { date: "2026-09-20T12:00:00.000Z", email: "dinuda@users.noreply.github.com" },
    },
    author: { login: "dinuda", id: 4242 },
  });
  assert.equal(mapped?.authorLogin, "dinuda");
  assert.equal(mapped?.authorGithubUserId, 4242);
  assert.equal(mapped?.messageHeadline, "feat: wire org sync");
  assert.match(PULL_REQUEST_COMMITS_QUERY, /oid/);
  assert.match(PULL_REQUEST_COMMITS_QUERY, /authoredDate/);
});
