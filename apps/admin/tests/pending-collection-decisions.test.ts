import { beforeEach, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({
  toolAccount: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  accountCollectionEvent: { findMany: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@usejunction/db", () => ({ prisma: db }));

import { listPendingCollectionDecisions, setDeveloperAccountOptIn } from "@/lib/privacy/account-collection";

const row = (over: Record<string, unknown>) => ({
  id: "a1",
  orgId: "org",
  userId: "dev",
  deviceId: "d1",
  toolName: "cursor",
  accountKey: "me@x.com",
  email: "me@x.com",
  plan: "Pro",
  loginMethod: "oauth",
  authPresent: true,
  usageEnabled: false,
  loggingEnabled: false,
  usageAdminLocked: false,
  loggingAdminLocked: false,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  device: { hostname: "MacBook.local" },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

test("only undecided, unlocked, off logins with an email are pending; a provider with no decisions is a new tool", async () => {
  db.toolAccount.findMany.mockResolvedValue([
    row({ id: "decided", accountKey: "old@x.com" }),
    row({ id: "new-account", accountKey: "work@x.com", email: "work@x.com" }),
    row({ id: "new-tool", toolName: "roo", accountKey: "local" }),
    row({ id: "unnamed", toolName: "claude", accountKey: "claude:uuid", email: null }),
    row({ id: "locked", toolName: "claude", accountKey: "c", usageAdminLocked: true, loggingAdminLocked: true }),
    row({ id: "already-on", toolName: "codex", accountKey: "k", usageEnabled: true }),
  ]);
  db.accountCollectionEvent.findMany.mockResolvedValue([{ deviceId: "d1", toolName: "cursor", accountKey: "old@x.com" }]);

  const pending = await listPendingCollectionDecisions({ orgId: "org", userId: "dev" });
  expect(pending.map((account) => [account.id, account.newProvider])).toEqual([
    ["new-account", false],
    ["new-tool", true],
  ]);
});

test("Not now records a decision even though the switch was already off", async () => {
  const account = row({});
  db.toolAccount.findFirst.mockResolvedValue(account);
  db.toolAccount.findMany.mockResolvedValue([account]);
  db.toolAccount.update.mockResolvedValue(account);

  await setDeveloperAccountOptIn({ orgId: "org", userId: "dev", actorId: "u", deviceId: "d1", toolName: "cursor", accountKey: "me@x.com", enabled: false });
  expect(db.accountCollectionEvent.create).not.toHaveBeenCalled();

  await setDeveloperAccountOptIn({ orgId: "org", userId: "dev", actorId: "u", deviceId: "d1", toolName: "cursor", accountKey: "me@x.com", enabled: false, recordDecision: true });
  expect(db.accountCollectionEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ enabled: false, stream: "usage", actor: "developer" }) }));
});
