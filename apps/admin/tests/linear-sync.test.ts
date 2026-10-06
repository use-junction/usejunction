import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectionFind: vi.fn(),
  connectionUpdate: vi.fn(),
  connectionUpdateMany: vi.fn(),
  issueUpsert: vi.fn(),
  issueDeleteMany: vi.fn(),
  transaction: vi.fn(),
  getIssuePage: vi.fn(),
  getWorkspace: vi.fn(),
  encryptTokens: vi.fn(),
  refreshToken: vi.fn(),
  decryptSecret: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    projectToolConnection: {
      findUnique: mocks.connectionFind,
      update: mocks.connectionUpdate,
      updateMany: mocks.connectionUpdateMany,
    },
    projectIssue: {
      upsert: mocks.issueUpsert,
      deleteMany: mocks.issueDeleteMany,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/security", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: vi.fn(),
}));
vi.mock("@/lib/integrations/linear", () => ({
  getLinearIssuePage: mocks.getIssuePage,
  refreshLinearToken: mocks.refreshToken,
  encryptLinearTokens: mocks.encryptTokens,
  getLinearWorkspace: mocks.getWorkspace,
  revokeLinearToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectionFind.mockResolvedValue({
    id: "linear-connection",
    orgId: "org-1",
    accessTokenCiphertext: "encrypted-access",
    refreshTokenCiphertext: "encrypted-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
  });
  mocks.decryptSecret.mockReturnValue("access-token");
  mocks.issueUpsert.mockResolvedValue({});
  mocks.issueDeleteMany.mockResolvedValue({ count: 2 });
  mocks.connectionUpdate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
});

test("connecting a different Linear workspace replaces the connection ID", async () => {
  mocks.getWorkspace.mockResolvedValue({ id: "workspace-new", name: "New workspace" });
  mocks.encryptTokens.mockReturnValue({
    accessTokenCiphertext: "new-access",
    refreshTokenCiphertext: "new-refresh",
    accessTokenExpiresAt: new Date(),
  });
  const deleted = vi.fn().mockResolvedValue({});
  const created = vi.fn().mockResolvedValue({ id: "connection-new", externalWorkspaceId: "workspace-new", externalWorkspaceName: "New workspace" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    projectToolConnection: {
      findUnique: vi.fn().mockResolvedValue({ id: "connection-old", externalWorkspaceId: "workspace-old" }),
      delete: deleted,
      create: created,
    },
  }));
  const { saveLinearConnection } = await import("@/lib/integrations/linear-sync");
  const result = await saveLinearConnection("org-1", "admin-1", {
    accessToken: "new-token",
    refreshToken: "new-refresh-token",
    expiresAt: new Date(),
  });
  assert.equal(result.id, "connection-new");
  assert.equal(deleted.mock.calls[0]?.[0]?.where?.id, "connection-old");
  assert.equal(created.mock.calls[0]?.[0]?.data?.externalWorkspaceId, "workspace-new");
});

test("reconnecting the same Linear workspace also rotates its connection ID", async () => {
  mocks.getWorkspace.mockResolvedValue({ id: "workspace-old", name: "Same workspace" });
  mocks.encryptTokens.mockReturnValue({ accessTokenCiphertext: "new-access", refreshTokenCiphertext: "new-refresh", accessTokenExpiresAt: new Date() });
  const deleted = vi.fn().mockResolvedValue({});
  const created = vi.fn().mockResolvedValue({ id: "connection-new", externalWorkspaceId: "workspace-old", externalWorkspaceName: "Same workspace" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    projectToolConnection: {
      findUnique: vi.fn().mockResolvedValue({ id: "connection-old", externalWorkspaceId: "workspace-old", refreshTokenCiphertext: "old-refresh" }),
      delete: deleted,
      create: created,
    },
  }));
  const { saveLinearConnection } = await import("@/lib/integrations/linear-sync");
  const result = await saveLinearConnection("org-1", "admin-1", { accessToken: "new-token", refreshToken: "new-refresh-token", expiresAt: new Date() });
  assert.equal(result.id, "connection-new");
  assert.equal(deleted.mock.calls.length, 1);
  assert.equal(created.mock.calls.length, 1);
});

test("Linear sync imports all cursor pages before pruning stale issues", async () => {
  const events: string[] = [];
  mocks.getIssuePage.mockImplementationOnce(async () => {
    events.push("page-1");
    return {
      nodes: [{ id: "a", identifier: "ENG-1", title: "First", status: "Done", url: "https://linear.app/team/issue/ENG-1", updatedAt: "2026-09-24T00:00:00Z", state: { name: "Done" } }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
    };
  }).mockImplementationOnce(async () => {
    events.push("page-2");
    return {
      nodes: [{ id: "b", identifier: "ENG-2", title: "Second", url: "https://linear.app/team/issue/ENG-2", updatedAt: "2026-09-24T00:00:00Z", state: { name: "Started" } }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  });
  mocks.issueDeleteMany.mockImplementation(async () => {
    events.push("prune");
    return { count: 2 };
  });
  const { syncLinearConnection } = await import("@/lib/integrations/linear-sync");
  const result = await syncLinearConnection("org-1");
  assert.deepEqual(result, { imported: 2, removed: 2 });
  assert.deepEqual(events, ["page-1", "page-2", "prune"]);
  assert.equal(mocks.getIssuePage.mock.calls[1]?.[1], "next");
  assert.equal(mocks.issueUpsert.mock.calls[0]?.[0]?.create?.status, "Done");
  assert.equal(mocks.issueUpsert.mock.calls[1]?.[0]?.create?.status, "Started");
});

test("Linear sync leaves existing issues intact after a page failure", async () => {
  mocks.getIssuePage.mockRejectedValue(new Error("rate limit"));
  const { syncLinearConnection } = await import("@/lib/integrations/linear-sync");
  await assert.rejects(syncLinearConnection("org-1"), /rate limit/);
  assert.equal(mocks.issueDeleteMany.mock.calls.length, 0);
  assert.equal(mocks.connectionUpdate.mock.calls[0]?.[0]?.data?.status, "error");
});
