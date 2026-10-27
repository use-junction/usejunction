import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { Prisma, ProviderConnection } from "@prisma/client";
import { DEFAULT_BRANCH_HISTORY_QUERY, REPO_PULL_REQUESTS_QUERY } from "@/lib/features/github-mapper";

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      providerConnection: { update: fn(), findFirst: fn() },
      providerConnectionCapability: { upsert: fn(), findUnique: fn(), update: fn() },
      gitHubRepositoryAccess: { updateMany: fn(), findMany: fn(), update: fn() },
      externalIdentity: { findMany: fn() },
      developer: { findMany: fn() },
      account: { findMany: fn() },
      gitPullRequest: { findMany: fn() },
      gitCommit: { groupBy: fn(), findMany: fn() },
      $queryRaw: fn(),
      $executeRaw: fn(),
      $transaction: fn(),
    },
    getGitHubInstallation: fn(),
    githubInstallationToken: fn(),
    githubGraphql: fn(),
    listGitHubOrgMembers: fn(),
    fetchJson: fn(),
    reconcile: fn(),
    readUsageMetrics: fn(),
    wake: fn(),
    logServerError: fn(),
  };
});

vi.mock("@usejunction/db", async () => {
  const actual = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return { prisma: mocks.prisma, Prisma: actual.Prisma };
});
vi.mock("@/lib/integrations/github-app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/github-app")>("@/lib/integrations/github-app");
  return {
    ...actual,
    getGitHubInstallation: mocks.getGitHubInstallation,
    githubInstallationToken: mocks.githubInstallationToken,
    githubGraphql: mocks.githubGraphql,
    listGitHubOrgMembers: mocks.listGitHubOrgMembers,
  };
});
vi.mock("@/lib/integrations/http", () => ({ fetchJson: mocks.fetchJson, providerFetch: vi.fn() }));
vi.mock("@/lib/features/github-repository-access", () => ({ reconcileGitHubRepositoryAccess: mocks.reconcile }));
vi.mock("@/lib/analytics/query/read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/analytics/query/read")>("@/lib/analytics/query/read");
  return { ...actual, readUsageMetrics: mocks.readUsageMetrics };
});
vi.mock("@/lib/features/autosync", () => ({ wakeGitHubAuthorDaemons: mocks.wake }));
vi.mock("@/lib/errors/public", () => ({ logServerError: mocks.logServerError }));

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY = 86_400_000;
const WINDOW_CUTOFF = new Date(NOW.getTime() - 90 * DAY);
const REPOS = ["alpha", "beta", "gamma"] as const;

const connection = {
  id: "conn-1",
  orgId: "org-1",
  provider: "github",
  product: "copilot",
  method: "oauth",
  status: "active",
  externalOrgId: "ada",
  config: { installationId: "42", accountType: "User", org: "ada" },
  permissions: {},
  lastSyncedAt: null,
} as unknown as ProviderConnection;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Let every pending microtask and mocked database call settle (only Date is faked). */
async function settle() {
  for (let round = 0; round < 5; round += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

function commitNode(sha: string, options: { prNumber?: number; login?: string } = {}) {
  return {
    oid: sha,
    authoredDate: "2026-10-26T09:00:00.000Z",
    committedDate: "2026-10-26T09:00:00.000Z",
    messageHeadline: `feat: ${sha}`,
    additions: 3,
    deletions: 1,
    author: { email: "ada@example.com", user: { login: options.login ?? "ada", databaseId: 11 } },
    associatedPullRequests: options.prNumber
      ? { totalCount: 1, nodes: [{ number: options.prNumber, state: "MERGED", merged: true }] }
      : { totalCount: 0, nodes: [] },
  };
}

/** GraphQL responses per repository; `gates` hold a repository's first call open until released. */
function graphqlFor(gates: Map<string, { promise: Promise<void> }>, historySince: Map<string, string>) {
  return async (_token: string, query: string, variables: Record<string, unknown>) => {
    const name = String(variables.name);
    if (query === REPO_PULL_REQUESTS_QUERY) {
      await gates.get(name)?.promise;
      const nodes = name === "alpha"
        ? [{
            number: 7, title: "Ship it", state: "MERGED", createdAt: "2026-10-25T08:00:00.000Z", updatedAt: "2026-10-26T10:00:00.000Z", mergedAt: "2026-10-26T10:00:00.000Z",
            author: { login: "ada", databaseId: 11 }, commits: { totalCount: 1, nodes: [{ commit: commitNode("c7", { prNumber: 7 }) }] },
          }]
        : [];
      return { repository: { pullRequests: { nodes, pageInfo: { hasNextPage: false } } } };
    }
    if (query === DEFAULT_BRANCH_HISTORY_QUERY) {
      historySince.set(name, String(variables.since));
      const nodes = name === "alpha"
        ? [commitNode("c7", { prNumber: 7 }), commitNode("direct-1")]
        : [commitNode(`${name}-1`)];
      return { repository: { defaultBranchRef: { target: { history: { nodes, pageInfo: { hasNextPage: false } } } } } };
    }
    throw new Error(`unexpected query for ${name}`);
  };
}

function arrange(options: { gates?: Map<string, { promise: Promise<void> }>; grants?: Record<string, { lastSuccessAt: Date | null; syncStatus: string }> } = {}) {
  const historySince = new Map<string, string>();
  const accessUpdates: Array<{ repositoryId: string; data: Record<string, unknown> }> = [];
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "ada", type: "User" },
    permissions: { pull_requests: "read", contents: "read", metadata: "read" },
  });
  mocks.githubInstallationToken.mockResolvedValue("token");
  mocks.githubGraphql.mockImplementation(graphqlFor(options.gates ?? new Map(), historySince));
  mocks.fetchJson.mockImplementation(async (url: string) => {
    if (url.includes("/installation/repositories")) {
      return { repositories: REPOS.map((name) => ({ name, owner: { login: "ada" }, pushed_at: "2026-10-26T00:00:00.000Z" })), total_count: REPOS.length };
    }
    return [];
  });
  mocks.reconcile.mockResolvedValue(new Map(REPOS.map((name) => [`ada/${name}`, `repo-${name}`])));
  const grants = options.grants ?? {
    alpha: { lastSuccessAt: null, syncStatus: "pending" },
    beta: { lastSuccessAt: new Date(NOW.getTime() - DAY), syncStatus: "available" },
    gamma: { lastSuccessAt: new Date(NOW.getTime() - DAY), syncStatus: "error" },
  };
  mocks.prisma.gitHubRepositoryAccess.findMany.mockResolvedValue(
    REPOS.map((name) => ({ repositoryId: `repo-${name}`, ...grants[name]! })),
  );
  mocks.prisma.gitHubRepositoryAccess.update.mockImplementation(async (args: { where: { connectionId_repositoryId: { repositoryId: string } }; data: Record<string, unknown> }) => {
    accessUpdates.push({ repositoryId: args.where.connectionId_repositoryId.repositoryId, data: args.data });
    return {};
  });
  mocks.prisma.gitHubRepositoryAccess.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.providerConnection.update.mockResolvedValue({});
  mocks.prisma.providerConnectionCapability.findUnique.mockResolvedValue(null);
  mocks.prisma.providerConnectionCapability.upsert.mockResolvedValue({});
  mocks.prisma.externalIdentity.findMany.mockResolvedValue([]);
  mocks.prisma.developer.findMany.mockResolvedValue([{ id: "dev-1", email: "ada@example.com", authUserId: null }]);
  mocks.prisma.account.findMany.mockResolvedValue([]);
  mocks.prisma.gitPullRequest.findMany.mockResolvedValue([]);
  mocks.prisma.gitCommit.groupBy.mockResolvedValue([{ authorLogin: "ada" }]);
  mocks.prisma.gitCommit.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ featureCostAllocation: { deleteMany: vi.fn(), createMany: vi.fn() } }),
  );
  mocks.readUsageMetrics.mockResolvedValue({ data: { rows: [] } });
  mocks.prisma.$queryRaw.mockImplementation(async (statement: Prisma.Sql) => {
    if (statement.sql.includes("INSERT INTO git_pull_requests")) {
      return Array.from({ length: statement.values.length / 21 }, (_, index) => ({
        id: `pr-${statement.values[index * 21 + 4]}`, number: statement.values[index * 21 + 4], repository_id: statement.values[index * 21 + 3],
      }));
    }
    if (statement.sql.includes("INSERT INTO external_identities")) {
      return Array.from({ length: statement.values.length / 11 }, (_, index) => ({
        id: `id-${index}`, external_user_id: statement.values[index * 11 + 4], email: statement.values[index * 11 + 5],
        developer_id: statement.values[index * 11 + 6], matched_by: statement.values[index * 11 + 8], metadata: JSON.parse(String(statement.values[index * 11 + 9])),
      }));
    }
    return [];
  });
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.wake.mockResolvedValue({});
  return { historySince, accessUpdates };
}

function statements(kind: "queryRaw" | "executeRaw") {
  const calls = kind === "queryRaw" ? mocks.prisma.$queryRaw.mock.calls : mocks.prisma.$executeRaw.mock.calls;
  return calls.map((call) => (call[0] as Prisma.Sql).sql);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("GITHUB_CODE_SYNC_CONCURRENCY", "");
  vi.stubEnv("GITHUB_CODE_SYNC_FULL_REFETCH", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("one run reads identities once and writes each repository in a handful of statements", async () => {
  const { accessUpdates } = arrange();
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  const result = await syncGitHubCode({ ...connection }, {});
  assert.equal(result.skipped, false);
  assert.equal(result.repositories, 3);
  assert.equal(result.deferredRepositories, 0);
  assert.equal(result.pullRequests, 1);

  assert.equal(mocks.prisma.externalIdentity.findMany.mock.calls.length, 1, "identities load once for the whole run");
  assert.equal(mocks.prisma.developer.findMany.mock.calls.length, 1, "the roster loads once for the whole run");

  const queries = statements("queryRaw");
  assert.equal(queries.filter((sql) => sql.includes("INSERT INTO git_pull_requests")).length, 1, "only alpha has pull requests");
  assert.ok(queries.some((sql) => sql.includes("INSERT INTO external_identities")), "authors are written in bulk");
  const executes = statements("executeRaw");
  assert.equal(executes.filter((sql) => sql.includes("INSERT INTO git_commits")).length, 3, "one commit statement per repository");
  assert.equal(executes.filter((sql) => sql.includes("UPDATE git_commits AS t")).length, 1, "authors are restamped in one pass");
  assert.equal(executes.filter((sql) => sql.includes("UPDATE git_pull_requests AS t")).length, 1);

  for (const name of REPOS) {
    const started = accessUpdates.find((row) => row.repositoryId === `repo-${name}` && row.data.syncStatus === "syncing");
    const sealed = accessUpdates.find((row) => row.repositoryId === `repo-${name}` && row.data.syncStatus === "available");
    assert.ok(started && sealed, `${name} is marked syncing then available`);
    assert.equal((sealed.data.lastSuccessAt as Date).getTime(), (started.data.lastAttemptAt as Date).getTime(), "lastSuccessAt records when the fetch started");
  }
});

test("a sealed repository fetches from two days before its last success; errored and new ones take the full window", async () => {
  const { historySince } = arrange();
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  await syncGitHubCode({ ...connection }, {});
  assert.equal(historySince.get("alpha"), WINDOW_CUTOFF.toISOString(), "never synced");
  assert.equal(historySince.get("gamma"), WINDOW_CUTOFF.toISOString(), "last run errored");
  assert.equal(historySince.get("beta"), new Date(NOW.getTime() - DAY - 2 * DAY).toISOString(), "incremental with overlap");
});

test("the full-refetch flag forces the whole window for every repository", async () => {
  vi.stubEnv("GITHUB_CODE_SYNC_FULL_REFETCH", "1");
  const { historySince } = arrange();
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  await syncGitHubCode({ ...connection }, {});
  assert.equal(historySince.get("beta"), WINDOW_CUTOFF.toISOString());
});

test("repositories run side by side up to the configured concurrency", async () => {
  vi.stubEnv("GITHUB_CODE_SYNC_CONCURRENCY", "2");
  const gates = new Map(REPOS.map((name) => [name, deferred()]));
  const { accessUpdates } = arrange({ gates });
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  const run = syncGitHubCode({ ...connection }, {});
  await settle();
  const inFlight = () => accessUpdates.filter((row) => row.data.syncStatus === "syncing").map((row) => row.repositoryId);
  assert.deepEqual(inFlight(), ["repo-alpha", "repo-beta"], "two repositories start before any finishes");
  gates.get("beta")!.resolve();
  await settle();
  assert.deepEqual(inFlight(), ["repo-alpha", "repo-beta", "repo-gamma"], "finishing one starts the next in order");
  gates.get("alpha")!.resolve();
  gates.get("gamma")!.resolve();
  const result = await run;
  assert.equal(result.deferredRepositories, 0);
  assert.equal(accessUpdates.filter((row) => row.data.syncStatus === "available").length, 3);
});

test("a stop request is consumed once and defers everything not yet started", async () => {
  vi.stubEnv("GITHUB_CODE_SYNC_CONCURRENCY", "1");
  arrange();
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  const stopRequested = vi.fn().mockResolvedValue(true);
  const result = await syncGitHubCode({ ...connection }, { stopRequested });
  assert.equal(result.stopped, true);
  assert.equal(result.deferredRepositories, 3);
  assert.equal(stopRequested.mock.calls.length, 1, "later picks see the stop without asking again");
  const capability = mocks.prisma.providerConnectionCapability.upsert.mock.calls.at(-1)?.[0] as { update: { status: string; lastError: string } };
  assert.equal(capability.update.status, "partial");
  assert.match(capability.update.lastError, /stopped at your request after 0 of 3/);
});

test("a stop that arrives after the first repository started lets that repository finish", async () => {
  vi.stubEnv("GITHUB_CODE_SYNC_CONCURRENCY", "1");
  arrange();
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  const stopRequested = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const result = await syncGitHubCode({ ...connection }, { stopRequested });
  assert.equal(result.stopped, true);
  assert.equal(result.deferredRepositories, 2);
  assert.equal(result.repositories - (result.deferredRepositories ?? 0), 1);
});

test("a deadline already inside the reserve defers every repository and reports partial", async () => {
  arrange();
  const { syncGitHubCode } = await import("@/lib/features/github-code-sync");
  const result = await syncGitHubCode({ ...connection }, { deadline: new Date(NOW.getTime() + 19_000) });
  assert.equal(result.deferredRepositories, 3);
  assert.equal(result.stopped, false);
  const capability = mocks.prisma.providerConnectionCapability.upsert.mock.calls.at(-1)?.[0] as { update: { status: string; lastError: string } };
  assert.equal(capability.update.status, "partial");
  assert.match(capability.update.lastError, /Synced 0 of 3 repositories/);
});
