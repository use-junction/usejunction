import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(), projects: vi.fn(), projectUpdate: vi.fn(), projectUpdateMany: vi.fn(), itemUpsert: vi.fn(), itemDelete: vi.fn(),
  grants: vi.fn(), connectionUpdate: vi.fn(), transaction: vi.fn(), installation: vi.fn(), token: vi.fn(), graphql: vi.fn(),
}));
vi.mock("@usejunction/db", async () => ({ Prisma: (await vi.importActual<typeof import("@prisma/client")>("@prisma/client")).Prisma, prisma: {
  providerConnection: { findMany: mocks.connection, update: mocks.connectionUpdate },
  gitHubProject: { findMany: mocks.projects, update: mocks.projectUpdate, updateMany: mocks.projectUpdateMany },
  gitHubProjectItem: { upsert: mocks.itemUpsert, deleteMany: mocks.itemDelete },
  gitHubRepositoryAccess: { findMany: mocks.grants },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/integrations/github-app", () => ({
  getGitHubInstallation: mocks.installation, githubInstallationToken: mocks.token, githubGraphql: mocks.graphql,
  githubProjectsReadGranted: (permissions: Record<string, string>) => permissions.organization_projects === "read",
  normalizeGitHubAccountType: (value: string) => value,
}));

const project = (id: string) => ({ id, orgId: "org", connectionId: "conn", externalId: id, number: 1, title: id, url: `https://github.com/orgs/acme/projects/${id}`, syncStatus: "available", lastAttemptAt: null, lastSuccessAt: null, lastError: null, createdAt: new Date() });
const page = (id: string, after: string | null, nodes: unknown[], hasNextPage: boolean) => ({ node: { id, title: id, url: `https://github.com/orgs/acme/projects/${id}`, items: { nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? "next" : null } } } });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.connection.mockResolvedValue([{ id: "conn", orgId: "org", provider: "github", status: "active", config: { installationId: "123", accountType: "Organization" } }]);
  mocks.projects.mockResolvedValue([project("p1"), project("p2")]);
  mocks.installation.mockResolvedValue({ account: { type: "Organization", login: "acme" }, permissions: { organization_projects: "read" } });
  mocks.token.mockResolvedValue("token");
  mocks.grants.mockResolvedValue([{ repositoryId: "repo", repository: { owner: "acme", name: "app" } }]);
  mocks.projectUpdateMany.mockResolvedValue({ count: 1 });
  mocks.projectUpdate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ gitHubProjectItem: { upsert: mocks.itemUpsert, deleteMany: mocks.itemDelete }, gitHubProject: { update: mocks.projectUpdate } }));
});

test("paginates selected Projects, imports granted items only, and never prunes a failed scan", async () => {
  mocks.graphql.mockImplementation(async (_token: string, _query: string, variables: { id: string; after: string | null }) => {
    if (variables.id === "p2") throw new Error("GitHub timeout");
    if (!variables.after) return page("p1", null, [], true);
    return page("p1", "next", [
      { id: "item-1", content: { __typename: "Issue", id: "issue-1", number: 12, title: "ENG-12 Ship", url: "https://github.com/acme/app/issues/12", state: "OPEN", createdAt: "2026-09-01T00:00:00.000Z", closedAt: null, repository: { nameWithOwner: "acme/app" } }, fieldValueByName: { name: "Doing" } },
      { id: "item-2", content: { __typename: "Issue", id: "issue-2", number: 9, title: "Private", url: "https://github.com/other/private/issues/9", state: "OPEN", repository: { nameWithOwner: "other/private" } }, fieldValueByName: null },
      { id: "draft", content: { __typename: "DraftIssue", id: "draft", number: 1, title: "Draft" }, fieldValueByName: null },
    ], false);
  });
  const { syncGitHubProjects } = await import("@/lib/integrations/github-projects");
  const result = await syncGitHubProjects("org");
  expect(result).toMatchObject({ selected: 2, synced: 1, failed: 1, imported: 1 });
  expect(mocks.itemUpsert).toHaveBeenCalledTimes(1);
  expect(mocks.itemUpsert.mock.calls[0]?.[0].create).toMatchObject({
    repositoryId: "repo", status: "Doing", statusSource: "project",
    contentCreatedAt: new Date("2026-09-01T00:00:00.000Z"), contentClosedAt: null,
  });
  expect(mocks.itemDelete).toHaveBeenCalledTimes(1);
  expect(mocks.itemDelete.mock.calls[0]?.[0].where.projectId).toBe("p1");
  expect(mocks.projectUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p2" }, data: expect.objectContaining({ syncStatus: "error" }) }));
});

test("missing Projects permission records a separate Project failure", async () => {
  mocks.installation.mockResolvedValue({ account: { type: "Organization", login: "acme" }, permissions: { contents: "read" } });
  const { syncGitHubProjects } = await import("@/lib/integrations/github-projects");
  expect(await syncGitHubProjects("org")).toMatchObject({ failed: 2, reason: "permission_required" });
  expect(mocks.projectUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncStatus: "permission_required" }) }));
  expect(mocks.grants).not.toHaveBeenCalled();
});
