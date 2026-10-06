import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  allocations: vi.fn(),
  pullRequests: vi.fn(),
  pullRequest: vi.fn(),
  commits: vi.fn(),
  commitGroups: vi.fn(),
  issues: vi.fn(),
  project: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("@usejunction/db", async () => {
  const { Prisma } = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return { Prisma, prisma: {
    gitHubRepositoryAccess: { findFirst: mocks.access },
    featureCostAllocation: { groupBy: mocks.allocations },
    gitPullRequest: { findMany: mocks.pullRequests, findFirst: mocks.pullRequest },
    gitCommit: { findMany: mocks.commits, groupBy: mocks.commitGroups },
    gitHubProject: { findFirst: mocks.project },
    gitHubProjectItem: { findMany: mocks.issues },
    $queryRaw: mocks.raw,
  } };
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.access.mockResolvedValue({ id: "access-1", connectionId: "conn", repository: { owner: "acme", name: "app" } });
  mocks.allocations.mockResolvedValue([]);
  mocks.pullRequests.mockResolvedValue([]);
  mocks.pullRequest.mockResolvedValue({ id: "pr-1" });
  mocks.commits.mockResolvedValue([]);
  mocks.issues.mockResolvedValue([]);
  mocks.commitGroups.mockResolvedValue([]);
  mocks.raw.mockResolvedValue([]);
});

test("repository details are limited to a current grant", async () => {
  mocks.access.mockResolvedValue(null);
  const { loadRepositoryWork } = await import("@/lib/app-pages/work-spend-detail");
  assert.equal(await loadRepositoryWork({ orgId: "org", repositoryId: "removed" }), null);
  assert.equal(mocks.pullRequests.mock.calls.length, 0);
});

test("a pull request carries its cost and links a GitHub Project issue", async () => {
  mocks.raw
    .mockResolvedValueOnce([{ id: "pr-1", activityAt: new Date("2026-09-24T00:00:00Z") }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ pullRequestId: "pr-1", costKind: "verified_usage", costMicros: 3_000_000n }, { pullRequestId: "pr-1", costKind: "estimated_api", costMicros: 2_000_000n }]);
  mocks.pullRequests.mockResolvedValue([{
    id: "pr-1", number: 41, title: "Ship billing", state: "merged", url: "https://github.com/acme/app/pull/41",
    closingIssues: [{ url: "https://github.com/acme/app/issues/41" }], authorLogin: "ada",
    githubCreatedAt: new Date("2026-09-20T00:00:00Z"), mergedAt: new Date("2026-09-23T00:00:00Z"), closedAt: null,
  }]);
  mocks.issues.mockResolvedValue([{ externalItemId: "item-1", contentType: "Issue", number: 41, title: "Ship billing", status: "Done", url: "https://github.com/acme/app/issues/41", project: { id: "project-1", title: "Roadmap", url: "https://github.com/orgs/acme/projects/1" } }]);
  mocks.commitGroups.mockResolvedValue([{ pullRequestId: "pr-1", _count: { _all: 4 } }]);
  const { loadRepositoryWork } = await import("@/lib/app-pages/work-spend-detail");
  const result = await loadRepositoryWork({ orgId: "org", repositoryId: "repo", days: "30" });
  assert.equal(result?.items.length, 1);
  assert.equal(result.items[0]?.kind, "pull_request");
  assert.equal(result.items[0]?.title, "Ship billing");
  assert.equal(result.items[0]?.verifiedMicros, "3000000");
  assert.equal(result.items[0]?.estimatedMicros, "2000000");
  assert.equal(result.items[0]?.pullRequests.length, 1);
  assert.equal(result.items[0]?.projectLinks[0]?.projectTitle, "Roadmap");
});

test("repository work paginates direct commits without returning all commits in the page model", async () => {
  const commits = Array.from({ length: 26 }, (_, index) => ({
    id: `commit-${index}`, sha: `sha-${index}`, messageHeadline: `Change ${index}`,
    authoredAt: new Date(Date.UTC(2026, 8, 24, 12, 0, 0) - index * 1000), authorLogin: "ada",
  }));
  mocks.raw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(commits.map((row) => ({ id: row.id, activityAt: row.authoredAt })))
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "commit-25", activityAt: commits[25]!.authoredAt }]);
  mocks.commits.mockImplementation(({ where }: { where: { id: { in: string[] } } }) => Promise.resolve(commits.filter((row) => where.id.in.includes(row.id))));
  const { loadRepositoryWork } = await import("@/lib/app-pages/work-spend-detail");
  const first = await loadRepositoryWork({ orgId: "org", repositoryId: "repo", days: "30" });
  assert.equal(first?.items.length, 25);
  assert.ok(first?.nextCursor);
  const second = await loadRepositoryWork({ orgId: "org", repositoryId: "repo", days: "30", cursor: first?.nextCursor });
  assert.equal(second?.items.length, 1);
  assert.equal(second?.nextCursor, null);
  assert.equal(second?.items[0]?.id, "commit-25");
});

test("PR commit drilldown shows per-commit cost without pooling a ticket key", async () => {
  mocks.commits.mockResolvedValue([{
    id: "commit-1", sha: "abc123", messageHeadline: "Ship billing", authoredAt: new Date("2026-09-24T10:00:00Z"),
    authorLogin: "ada", pullRequest: { title: "Ship billing", headRefName: "billing" },
  }]);
  mocks.allocations.mockResolvedValue([{ commitSha: "abc123", costKind: "verified_usage", _sum: { costMicros: 5_000_000n } }]);
  const { loadRepositoryWork } = await import("@/lib/app-pages/work-spend-detail");
  const result = await loadRepositoryWork({ orgId: "org", repositoryId: "repo", days: "30", pullRequestId: "pr-1" });
  assert.equal(result?.items[0]?.ticketKey, null);
  assert.equal(result?.items[0]?.verifiedMicros, "5000000");
  assert.deepEqual(result?.allocationContext, []);
});
