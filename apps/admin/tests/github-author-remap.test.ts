import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerConnection: { findFirst: vi.fn(), findMany: vi.fn() },
  developer: { findMany: vi.fn() },
  gitCommit: { groupBy: vi.fn(), findMany: vi.fn() },
  externalIdentity: { findMany: vi.fn(), findFirst: vi.fn() },
  account: { findMany: vi.fn() },
  featureCostAllocation: { deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
  restampGitAuthors: vi.fn(),
  bulkUpsertGitHubIdentities: vi.fn(),
}));

vi.mock("@usejunction/db", async () => {
  const actual = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return { prisma: mocks, Prisma: actual.Prisma };
});
vi.mock("@/lib/features/github-code-writes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/features/github-code-writes")>("@/lib/features/github-code-writes");
  return { ...actual, restampGitAuthors: mocks.restampGitAuthors, bulkUpsertGitHubIdentities: mocks.bulkUpsertGitHubIdentities };
});
vi.mock("@/lib/analytics/query/read", () => ({
  readUsageMetrics: vi.fn(async () => ({ data: { rows: [] } })),
  dimension: () => null,
  metricBigInt: () => 0n,
}));
vi.mock("@/lib/features/autosync", () => ({ wakeGitHubAuthorDaemons: vi.fn() }));
vi.mock("@/lib/errors/public", () => ({ logServerError: vi.fn() }));

// The use-junction organization install lists only Dinuda as a member; Harindulk is
// in scope only through their own personal install.
const orgConnection = {
  id: "conn-org", orgId: "org-1", provider: "github", status: "active", externalOrgId: "use-junction",
  config: { accountType: "Organization", org: "use-junction", githubMemberLogins: ["dinuda"] },
};
const personalConnection = {
  id: "conn-harindulk", orgId: "org-1", provider: "github", status: "active", externalOrgId: "Harindulk",
  config: { accountType: "User", org: "Harindulk" },
};
const developers = [
  { id: "dev-dinuda", email: "dinuda@example.com", authUserId: null },
  { id: "dev-harindulk", email: "harindulk@example.com", authUserId: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerConnection.findFirst.mockResolvedValue(orgConnection);
  mocks.providerConnection.findMany.mockResolvedValue([orgConnection, personalConnection]);
  mocks.developer.findMany.mockResolvedValue(developers);
  mocks.gitCommit.groupBy.mockResolvedValue([{ authorLogin: "dinuda" }, { authorLogin: "harindulk" }]);
  mocks.gitCommit.findMany.mockResolvedValue([]);
  mocks.externalIdentity.findMany.mockResolvedValue([]);
  mocks.externalIdentity.findFirst.mockResolvedValue({ id: "identity-dinuda" });
  mocks.bulkUpsertGitHubIdentities.mockImplementation(async (rows: Array<{ login: string; email: string | null; developerId: string | null; matchedBy: string | null; metadata: unknown }>) =>
    rows.map((row) => ({ id: `identity-${row.login}`, externalUserId: row.login, email: row.email, developerId: row.developerId, matchedBy: row.matchedBy, metadata: row.metadata })));
  mocks.account.findMany.mockResolvedValue([]);
  mocks.$transaction.mockImplementation(async (run: (tx: typeof mocks) => Promise<unknown>) => run(mocks));
});

function stampFor(login: string) {
  const entries = mocks.restampGitAuthors.mock.calls.flatMap(([, rows]: [string, Array<{ login: string; developerId: string | null }>]) => rows);
  return entries.find((entry) => entry.login === login)?.developerId;
}

test("a device usage sync keeps authors who are in scope only on another GitHub connection", async () => {
  const { remapGitHubAuthorAfterUsageSync } = await import("@/lib/features/github-code-sync");
  await remapGitHubAuthorAfterUsageSync("org-1", "dev-dinuda");
  expect(stampFor("dinuda")).toBe("dev-dinuda");
  expect(stampFor("harindulk")).toBe("dev-harindulk");
});

test("syncing the organization install does not clear a personal install's author", async () => {
  const { runCommitUsageMapping } = await import("@/lib/features/github-code-sync");
  await runCommitUsageMapping("org-1", { from: new Date("2026-08-01"), to: new Date("2026-10-27") }, {
    connectionId: "conn-org",
    scope: { kind: "organization", memberLogins: new Set(["dinuda"]) },
  });
  expect(stampFor("harindulk")).toBe("dev-harindulk");
});

test("an author outside every connection's scope is still cleared", async () => {
  mocks.gitCommit.groupBy.mockResolvedValue([{ authorLogin: "dinuda" }, { authorLogin: "outsider" }]);
  const { runCommitUsageMapping } = await import("@/lib/features/github-code-sync");
  await runCommitUsageMapping("org-1", { from: new Date("2026-08-01"), to: new Date("2026-10-27") }, { connectionId: "conn-org" });
  expect(stampFor("outsider")).toBeNull();
});
