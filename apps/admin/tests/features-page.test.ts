import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  developerFindMany: vi.fn(),
  allocationFindMany: vi.fn(),
  commitGroupBy: vi.fn(),
  commitFindMany: vi.fn(),
  identityFindMany: vi.fn(),
  usageFindFirst: vi.fn(),
  deviceFindFirst: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    providerConnection: { findMany: mocks.connectionFindFirst },
    developer: { findMany: mocks.developerFindMany },
    featureCostAllocation: { findMany: mocks.allocationFindMany },
    gitCommit: { groupBy: mocks.commitGroupBy, findMany: mocks.commitFindMany },
    externalIdentity: { findMany: mocks.identityFindMany },
    usageDaily: { findFirst: mocks.usageFindFirst },
    device: { findFirst: mocks.deviceFindFirst },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectionFindFirst.mockResolvedValue([{
    id: "conn-1",
    lastSyncedAt: new Date("2026-07-10T00:00:00.000Z"),
    lastError: null,
    externalOrgId: "acme",
    permissions: { pull_requests: "read", contents: "read", members: "read" },
    config: { org: "acme", accountType: "Organization", installationId: "99", githubMemberLogins: "ada" },
    capabilities: [
      { capability: "pull_requests", status: "available", lastError: null },
      { capability: "org_members", status: "available", lastError: null },
    ],
  }]);
  mocks.developerFindMany.mockResolvedValue([{ id: "dev-1", name: "Ada", email: "ada@acme.com" }]);
  mocks.allocationFindMany.mockResolvedValue([
    {
      id: "alloc-1",
      ticketKey: "PAY-219",
      commitSha: null,
      costKind: "verified_usage",
      method: "commit_split",
      costMicros: 4_000_000n,
      weight: 2,
      developer: { id: "dev-1", name: "Ada" },
      repository: { owner: "acme", name: "app" },
    },
    {
      id: "alloc-2",
      ticketKey: null,
      commitSha: "bbb111",
      costKind: "verified_usage",
      method: "commit_split",
      costMicros: 1_000_000n,
      weight: 1,
      developer: { id: "dev-1", name: "Ada" },
      repository: { owner: "acme", name: "app" },
    },
  ]);
  mocks.commitGroupBy.mockResolvedValue([
    { authorLogin: "ada", _count: { _all: 2 } },
    { authorLogin: "ghost", _count: { _all: 9 } },
  ]);
  mocks.commitFindMany.mockResolvedValue([
    {
      sha: "aaa111",
      messageHeadline: "PAY-219 implement checkout",
      ticketKeys: ["PAY-219"],
      authorLogin: "ada",
      authoredAt: new Date("2026-07-10T12:00:00.000Z"),
      repository: { owner: "acme", name: "app" },
    },
    {
      sha: "bbb111",
      messageHeadline: "readme",
      ticketKeys: [],
      authorLogin: "ada",
      authoredAt: new Date("2026-07-10T08:00:00.000Z"),
      repository: { owner: "acme", name: "app" },
    },
  ]);
  mocks.identityFindMany.mockResolvedValue([]);
  mocks.usageFindFirst.mockResolvedValue(null);
  mocks.deviceFindFirst.mockResolvedValue(null);
});

test("features page groups cost on commits and hides non-org authors", async () => {
  vi.resetModules();
  const { loadFeaturesPage } = await import("@/lib/app-pages/features");
  const payload = await loadFeaturesPage({ orgId: "org-1", userId: "u-1", role: "owner", email: "ada@acme.com" });
  assert.equal(payload.connection.state, "ready");
  assert.equal(payload.connection.needsMembers, false);
  assert.equal(payload.features.length, 1);
  assert.equal(payload.features[0]?.ticketKey, "PAY-219");
  assert.equal(payload.features[0]?.commitCount, 1);
  assert.equal(payload.features[0]?.verifiedMicros, "4000000");
  assert.equal(payload.unlinkedCommits.length, 1);
  assert.equal(payload.unlinkedCommits[0]?.sha, "bbb111");
  assert.equal(payload.unlinkedCommits[0]?.verifiedMicros, "1000000");
  assert.equal(payload.emptyReason, null);
  assert.deepEqual(payload.unmappedAuthors.map((row) => row.login), ["ada"]);
  assert.ok(!payload.unmappedAuthors.some((row) => row.login === "ghost"));
  assert.equal(payload.kpis.medianCostPerCommit, "1500000");
});

test("empty features with unmapped org members reports unmapped", async () => {
  mocks.allocationFindMany.mockResolvedValue([]);
  mocks.commitFindMany.mockResolvedValue([]);
  vi.resetModules();
  const { loadFeaturesPage } = await import("@/lib/app-pages/features");
  const payload = await loadFeaturesPage({ orgId: "org-1", userId: "u-1", role: "owner", email: "ada@acme.com" });
  assert.equal(payload.features.length, 0);
  assert.equal(payload.emptyReason, "unmapped");
  assert.deepEqual(payload.unmappedAuthors.map((row) => row.login), ["ada"]);
  assert.ok(!payload.unmappedAuthors.some((row) => row.login === "ghost"));
});

test("stale usage outside the window is distinguished from no usage", async () => {
  mocks.allocationFindMany.mockResolvedValue([]);
  mocks.commitGroupBy.mockResolvedValue([{ authorLogin: "ghost", _count: { _all: 9 } }]);
  mocks.commitFindMany.mockResolvedValue([]);
  mocks.usageFindFirst.mockResolvedValue({ date: new Date("2026-08-03T00:00:00.000Z") });
  vi.resetModules();
  const { loadFeaturesPage } = await import("@/lib/app-pages/features");
  const payload = await loadFeaturesPage(
    { orgId: "org-1", userId: "u-1", role: "owner", email: "ada@acme.com" },
    { days: "30" },
  );
  assert.equal(payload.emptyReason, "stale_usage");
  assert.equal(payload.lastUsageAt?.slice(0, 10), "2026-08-03");
});

test("empty features with mapped authors and no spend reports no usage", async () => {
  mocks.allocationFindMany.mockResolvedValue([]);
  mocks.commitGroupBy.mockResolvedValue([{ authorLogin: "ghost", _count: { _all: 9 } }]);
  mocks.commitFindMany.mockResolvedValue([]);
  vi.resetModules();
  const { loadFeaturesPage } = await import("@/lib/app-pages/features");
  const payload = await loadFeaturesPage({ orgId: "org-1", userId: "u-1", role: "owner", email: "ada@acme.com" });
  assert.equal(payload.emptyReason, "no_usage");
  assert.equal(payload.unmappedAuthors.length, 0);
  assert.equal(payload.unlinkedCommits.length, 0);
});

test("mapped commits without ticket keys stay unlinked and do not list unmapped authors", async () => {
  mocks.allocationFindMany.mockResolvedValue([
    {
      id: "alloc-2",
      ticketKey: null,
      commitSha: "bbb111",
      costKind: "verified_usage",
      method: "commit_split",
      costMicros: 1_000_000n,
      weight: 1,
      developer: { id: "dev-1", name: "Ada" },
      repository: { owner: "acme", name: "app" },
    },
  ]);
  mocks.commitGroupBy.mockResolvedValue([{ authorLogin: "ghost", _count: { _all: 9 } }]);
  mocks.commitFindMany.mockResolvedValue([
    {
      sha: "bbb111",
      messageHeadline: "readme",
      ticketKeys: [],
      authorLogin: "ada",
      authoredAt: new Date("2026-07-10T08:00:00.000Z"),
      repository: { owner: "acme", name: "app" },
    },
  ]);
  vi.resetModules();
  const { loadFeaturesPage } = await import("@/lib/app-pages/features");
  const payload = await loadFeaturesPage({ orgId: "org-1", userId: "u-1", role: "owner", email: "ada@acme.com" });
  assert.equal(payload.features.length, 0);
  assert.equal(payload.emptyReason, "no_ticket_keys");
  assert.equal(payload.unlinkedCommits.length, 1);
  assert.equal(payload.unlinkedCommits[0]?.sha, "bbb111");
  assert.equal(payload.unmappedAuthors.length, 0);
});
