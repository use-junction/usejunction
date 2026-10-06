import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gitHubRepositoryAccess: { deleteMany: vi.fn(), findMany: vi.fn() },
  gitPullRequest: { deleteMany: vi.fn() },
  gitCommit: { deleteMany: vi.fn(), findMany: vi.fn() },
  usageDaily: { findMany: vi.fn() },
  repository: { deleteMany: vi.fn() },
  externalIdentity: { updateMany: vi.fn(), deleteMany: vi.fn() },
  providerConnection: { count: vi.fn() },
  providerConnectionCapability: { updateMany: vi.fn() },
  featureCostAllocation: { deleteMany: vi.fn() },
  developer: { findMany: vi.fn() },
}));

vi.mock("@usejunction/db", () => ({ prisma: mocks }));
vi.mock("@/lib/analytics/query/read", () => ({
  readUsageMetrics: vi.fn(),
  dimension: () => null,
  metricBigInt: () => 0n,
}));
vi.mock("@/lib/features/autosync", () => ({ wakeGitHubAuthorDaemons: vi.fn() }));
vi.mock("@/lib/errors/public", () => ({ logServerError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitHubRepositoryAccess.findMany.mockResolvedValue([{ repositoryId: "repo-keep" }]);
  mocks.usageDaily.findMany.mockResolvedValue([]);
  mocks.providerConnection.count.mockResolvedValue(1);
  mocks.developer.findMany.mockResolvedValue([]);
});

test("disconnecting one GitHub account keeps the other account's commits", async () => {
  const { removeGitHubConnectionWork } = await import("@/lib/features/github-code-sync");
  await removeGitHubConnectionWork("org-1", "conn-leave", { rebuildAllocations: false });
  expect(mocks.gitHubRepositoryAccess.deleteMany).toHaveBeenCalledWith({ where: { orgId: "org-1", connectionId: "conn-leave" } });
  expect(mocks.gitPullRequest.deleteMany).toHaveBeenCalledWith({ where: { orgId: "org-1", connectionId: "conn-leave" } });
  expect(mocks.gitCommit.deleteMany).toHaveBeenCalledWith({
    where: { orgId: "org-1", repositoryId: { notIn: ["repo-keep"] } },
  });
  expect(mocks.repository.deleteMany).toHaveBeenCalledWith({
    where: { orgId: "org-1", host: "github.com", id: { notIn: ["repo-keep"] } },
  });
});

test("disconnecting one GitHub account keeps author matches when another account remains", async () => {
  const { removeGitHubConnectionWork } = await import("@/lib/features/github-code-sync");
  await removeGitHubConnectionWork("org-1", "conn-leave");
  expect(mocks.externalIdentity.updateMany).toHaveBeenCalledWith({
    where: { orgId: "org-1", provider: "github", connectionId: "conn-leave" },
    data: { connectionId: null },
  });
  expect(mocks.externalIdentity.deleteMany).not.toHaveBeenCalled();
});
