import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { findMany: vi.fn(), createMany: vi.fn() },
  gitHubRepositoryAccess: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  gitHubProjectItem: { deleteMany: vi.fn() },
}));

vi.mock("@usejunction/db", () => ({ prisma: mocks }));

/** In-memory repository table: rows appear after createMany, like Postgres. */
function fakeRepositoryTable(initial: Array<{ owner: string; name: string }>) {
  const rows = initial.map((row) => ({ id: `repo-${row.name}`, ...row }));
  mocks.repository.findMany.mockImplementation(async ({ where }: { where: { OR: Array<{ owner: string; name: string }> } }) =>
    rows.filter((row) => where.OR.some((wanted) => wanted.owner === row.owner && wanted.name === row.name)),
  );
  mocks.repository.createMany.mockImplementation(async ({ data }: { data: Array<{ owner: string; name: string }> }) => {
    for (const row of data) rows.push({ id: `repo-${row.name}`, owner: row.owner, name: row.name });
    return { count: data.length };
  });
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitHubRepositoryAccess.findMany.mockResolvedValue([]);
  mocks.gitHubRepositoryAccess.createMany.mockResolvedValue({ count: 0 });
});

test("reconciliation persists all granted repositories and removes revoked access", async () => {
  fakeRepositoryTable([{ owner: "team", name: "api" }]);
  mocks.gitHubRepositoryAccess.findMany.mockResolvedValue([{ repositoryId: "repo-api" }]);
  const { reconcileGitHubRepositoryAccess } = await import("@/lib/features/github-repository-access");
  const ids = await reconcileGitHubRepositoryAccess("org-1", "conn-1", [
    { owner: { login: "team" }, name: "api" },
    { owner: { login: "team" }, name: "web" },
  ]);
  expect([...ids.entries()]).toEqual([["team/api", "repo-api"], ["team/web", "repo-web"]]);
  // Only the unknown repository and the missing grant are written, in one statement each.
  expect(mocks.repository.createMany).toHaveBeenCalledTimes(1);
  expect(mocks.repository.createMany.mock.calls[0]?.[0]).toEqual({
    data: [{ orgId: "org-1", host: "github.com", owner: "team", name: "web" }],
    skipDuplicates: true,
  });
  expect(mocks.gitHubRepositoryAccess.createMany).toHaveBeenCalledTimes(1);
  expect(mocks.gitHubRepositoryAccess.createMany.mock.calls[0]?.[0]).toEqual({
    data: [{ orgId: "org-1", connectionId: "conn-1", repositoryId: "repo-web" }],
    skipDuplicates: true,
  });
  expect(mocks.gitHubRepositoryAccess.deleteMany).toHaveBeenCalledWith({
    where: { connectionId: "conn-1", repositoryId: { notIn: ["repo-api", "repo-web"] } },
  });
  expect(mocks.gitHubProjectItem.deleteMany).toHaveBeenCalledWith({
    where: { orgId: "org-1", project: { connectionId: "conn-1" }, repositoryId: { notIn: ["repo-api", "repo-web"] } },
  });
});

test("a listing that is already reconciled writes nothing", async () => {
  fakeRepositoryTable([{ owner: "team", name: "api" }]);
  mocks.gitHubRepositoryAccess.findMany.mockResolvedValue([{ repositoryId: "repo-api" }]);
  const { reconcileGitHubRepositoryAccess } = await import("@/lib/features/github-repository-access");
  await reconcileGitHubRepositoryAccess("org-1", "conn-1", [{ owner: { login: "team" }, name: "api" }]);
  expect(mocks.repository.createMany).not.toHaveBeenCalled();
  expect(mocks.gitHubRepositoryAccess.createMany).not.toHaveBeenCalled();
});

test("an empty successful GitHub listing clears access without deleting historical repositories", async () => {
  fakeRepositoryTable([]);
  const { reconcileGitHubRepositoryAccess } = await import("@/lib/features/github-repository-access");
  const ids = await reconcileGitHubRepositoryAccess("org-1", "conn-1", []);
  expect(ids.size).toBe(0);
  expect(mocks.repository.findMany).not.toHaveBeenCalled();
  expect(mocks.repository.createMany).not.toHaveBeenCalled();
  expect(mocks.gitHubRepositoryAccess.deleteMany).toHaveBeenCalledWith({
    where: { connectionId: "conn-1", repositoryId: { notIn: [] } },
  });
});
