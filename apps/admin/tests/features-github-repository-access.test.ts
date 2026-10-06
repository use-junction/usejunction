import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { upsert: vi.fn() },
  gitHubRepositoryAccess: { upsert: vi.fn(), deleteMany: vi.fn() },
  gitHubProjectItem: { deleteMany: vi.fn() },
}));

vi.mock("@usejunction/db", () => ({ prisma: mocks }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.repository.upsert.mockImplementation(async ({ create }: { create: { name: string } }) => ({ id: `repo-${create.name}` }));
});

test("reconciliation persists all granted repositories and removes revoked access", async () => {
  const { reconcileGitHubRepositoryAccess } = await import("@/lib/features/github-repository-access");
  const ids = await reconcileGitHubRepositoryAccess("org-1", "conn-1", [
    { owner: { login: "team" }, name: "api" },
    { owner: { login: "team" }, name: "web" },
  ]);
  expect([...ids.values()]).toEqual(["repo-api", "repo-web"]);
  expect(mocks.gitHubRepositoryAccess.upsert).toHaveBeenCalledTimes(2);
  expect(mocks.gitHubRepositoryAccess.deleteMany).toHaveBeenCalledWith({
    where: { connectionId: "conn-1", repositoryId: { notIn: ["repo-api", "repo-web"] } },
  });
  expect(mocks.gitHubProjectItem.deleteMany).toHaveBeenCalledWith({
    where: { orgId: "org-1", project: { connectionId: "conn-1" }, repositoryId: { notIn: ["repo-api", "repo-web"] } },
  });
});

test("an empty successful GitHub listing clears access without deleting historical repositories", async () => {
  const { reconcileGitHubRepositoryAccess } = await import("@/lib/features/github-repository-access");
  const ids = await reconcileGitHubRepositoryAccess("org-1", "conn-1", []);
  expect(ids.size).toBe(0);
  expect(mocks.repository.upsert).not.toHaveBeenCalled();
  expect(mocks.gitHubRepositoryAccess.deleteMany).toHaveBeenCalledWith({
    where: { connectionId: "conn-1", repositoryId: { notIn: [] } },
  });
});
