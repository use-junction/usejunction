import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(), access: vi.fn(), developers: vi.fn(), allocationGroups: vi.fn(), oldAllocation: vi.fn(),
  commitGroups: vi.fn(), prGroups: vi.fn(), raw: vi.fn(), identities: vi.fn(), usage: vi.fn(), device: vi.fn(), projects: vi.fn(), projectRepos: vi.fn(),
}));

vi.mock("@usejunction/db", async () => {
  const { Prisma } = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return { Prisma, prisma: {
    providerConnection: { findMany: mocks.connection },
    gitHubRepositoryAccess: { findMany: mocks.access },
    developer: { findMany: mocks.developers },
    featureCostAllocation: { groupBy: mocks.allocationGroups, findFirst: mocks.oldAllocation },
    gitCommit: { groupBy: mocks.commitGroups },
    gitPullRequest: { groupBy: mocks.prGroups },
    gitHubProject: { findMany: mocks.projects },
    gitHubProjectItem: { groupBy: mocks.projectRepos },
    externalIdentity: { findMany: mocks.identities },
    usageDaily: { findFirst: mocks.usage },
    device: { findFirst: mocks.device },
    $queryRaw: mocks.raw,
  } };
});
vi.mock("@/lib/integrations/linear-sync", () => ({ linearConnectionSummary: async () => ({ connected: false, status: "disconnected", workspaceName: null, issueCount: 0, lastSyncedAt: null, lastError: null }) }));
vi.mock("@/lib/integrations/linear", () => ({ linearConfigured: () => false }));

const principal = { orgId: "org", userId: "user", role: "owner" as const, email: "owner@example.com" };
const repository = (id: string, name: string, syncStatus = "available") => ({
  repositoryId: id, syncStatus, lastSuccessAt: new Date("2026-09-23T12:00:00Z"), lastError: syncStatus === "error" ? "GitHub timed out" : null,
  repository: { id, owner: "acme", name },
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.connection.mockResolvedValue([{
    id: "github", orgId: "org", status: "active", lastSyncedAt: new Date("2026-09-23T12:00:00Z"), lastError: null,
    externalOrgId: "acme", permissions: { pull_requests: "read", contents: "read", members: "read" },
    config: { installationId: "123", accountType: "Organization", githubMemberLogins: [] },
    capabilities: [{ capability: "pull_requests", status: "available", lastError: null }, { capability: "org_members", status: "available", lastError: null }],
  }]);
  mocks.access.mockResolvedValue([]);
  mocks.developers.mockResolvedValue([]);
  mocks.allocationGroups.mockResolvedValue([]);
  mocks.oldAllocation.mockResolvedValue(null);
  mocks.commitGroups.mockResolvedValue([]);
  mocks.prGroups.mockResolvedValue([]);
  mocks.raw.mockResolvedValue([]);
  mocks.identities.mockResolvedValue([]);
  mocks.usage.mockResolvedValue(null);
  mocks.device.mockResolvedValue(null);
  mocks.projects.mockResolvedValue([]);
  mocks.projectRepos.mockResolvedValue([]);
});

test("all granted repositories remain visible, including zero-work and failed-sync rows", async () => {
  mocks.access.mockResolvedValue([repository("r1", "api"), repository("r2", "web"), repository("r3", "docs", "error")]);
  mocks.allocationGroups.mockResolvedValue([
    { repositoryId: "r1", costKind: "verified_usage", method: "commit_split", _sum: { costMicros: 2_000_000n } },
    { repositoryId: "r2", costKind: "estimated_api", method: "commit_split", _sum: { costMicros: 3_000_000n } },
    { repositoryId: null, costKind: "estimated_api", method: "unattributed", _sum: { costMicros: 1_000_000n } },
  ]);
  mocks.commitGroups.mockImplementation(({ by }: { by: string[] }) => Promise.resolve(by.length === 1 ? [{ repositoryId: "r1", _count: { _all: 3 }, _max: { authoredAt: new Date("2026-09-22") } }] : []));
  mocks.prGroups.mockResolvedValue([{ repositoryId: "r1", _count: { _all: 1 }, _max: { githubCreatedAt: new Date("2026-09-22"), mergedAt: null, closedAt: null } }]);
  mocks.raw.mockResolvedValueOnce([{ repositoryId: "r1", type: "Features", count: 3n }]).mockResolvedValueOnce([{ hasTickets: true }]);
  const { loadWorkSpendPage } = await import("@/lib/app-pages/work-spend");
  const page = await loadWorkSpendPage(principal, { days: "30" });
  assert.deepEqual(page.repositories.map((row) => row.fullName), ["acme/api", "acme/web", "acme/docs"]);
  assert.equal(page.repositories[2]?.commitCount, 0);
  assert.equal(page.repositories[2]?.syncStatus, "error");
  assert.equal(page.connection.state, "partial");
  assert.deepEqual(page.coverage, {
    eligibleMicros: "6000000", attributedMicros: "5000000", unattributedMicros: "1000000",
    verifiedMicros: "2000000", estimatedMicros: "4000000", attributedPct: 83.3,
  });
  assert.equal(page.repositories[0]?.verifiedMicros, "2000000");
  assert.equal(page.repositories[1]?.estimatedMicros, "3000000");
  assert.equal(page.repositories[2]?.estimatedMicros, "0");
});

test("no granted repositories does not invent work or fetch commit headlines", async () => {
  const { loadWorkSpendPage } = await import("@/lib/app-pages/work-spend");
  const page = await loadWorkSpendPage(principal);
  assert.deepEqual(page.repositories, []);
  assert.deepEqual(page.repositoryOptions, []);
  assert.deepEqual(page.changeMix, []);
  assert.equal(page.hasTicketKeys, false);
  assert.equal(mocks.raw.mock.calls.length, 0);
});

test("repository filters retain workspace coverage including unlinked usage", async () => {
  mocks.access.mockResolvedValue([repository("r1", "api"), repository("r2", "web")]);
  mocks.allocationGroups.mockResolvedValue([
    { repositoryId: "r2", costKind: "estimated_api", method: "commit_split", _sum: { costMicros: 900_000n } },
    { repositoryId: "r1", costKind: "verified_usage", method: "commit_split", _sum: { costMicros: 100_000n } },
    { repositoryId: null, costKind: "estimated_api", method: "unattributed", _sum: { costMicros: 1_000_000n } },
  ]);
  mocks.raw.mockResolvedValueOnce([{ repositoryId: "r2", type: "Fixes", count: 2n }]).mockResolvedValueOnce([{ hasTickets: false }]);
  const { loadWorkSpendPage } = await import("@/lib/app-pages/work-spend");
  const page = await loadWorkSpendPage(principal, { days: "30", repositoryId: "r2" });
  assert.equal(page.selectedRepositoryId, "r2");
  assert.deepEqual(page.repositories.map((row) => row.id), ["r2"]);
  assert.deepEqual(page.repositoryOptions.map((row) => row.id), ["r1", "r2"]);
  assert.equal(page.coverage.eligibleMicros, "2000000");
  assert.equal(page.coverage.attributedPct, 50);
  assert.equal(page.coverage.unattributedMicros, "1000000");
  assert.equal(page.repositories[0]?.estimatedMicros, "900000");
  assert.deepEqual(page.changeMix, [{ type: "Fixes", count: 2 }]);
  assert.equal(mocks.allocationGroups.mock.calls[0]?.[0].where.repositoryId, undefined);
});

test("owners can view people allocation and managers cannot", async () => {
  mocks.access.mockResolvedValue([repository("r1", "api")]);
  const { loadWorkSpendPage } = await import("@/lib/app-pages/work-spend");
  const owner = await loadWorkSpendPage(principal);
  assert.equal(owner.canViewPeople, true);
  const manager = await loadWorkSpendPage({ ...principal, role: "manager" });
  assert.equal(manager.canViewPeople, false);
  assert.equal(manager.canMapIdentities, false);
});
