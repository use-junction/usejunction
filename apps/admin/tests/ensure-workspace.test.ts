import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organizationCreate: vi.fn(),
  teamCreate: vi.fn(),
  membershipCreate: vi.fn(),
  membershipFindFirst: vi.fn(),
  developerCreate: vi.fn(),
  planInterestUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    organizationMembership: {
      findFirst: mocks.membershipFindFirst,
    },
  },
}));

vi.mock("@/lib/ensure-auth-user", () => ({
  resolveAuthUser: async (user: { id: string; email: string; name?: string | null }) => user,
  AuthUserNotFoundError: class AuthUserNotFoundError extends Error {},
  isMissingAuthUserPrismaError: () => false,
}));

const onboardingMocks = vi.hoisted(() => ({
  hasPendingWorkspaceInvite: vi.fn(async () => false),
}));

vi.mock("@/lib/onboarding-status", () => ({
  hasPendingWorkspaceInvite: (...args: unknown[]) => onboardingMocks.hasPendingWorkspaceInvite(...args),
}));

vi.mock("@/lib/errors/public", () => ({
  logServerError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  onboardingMocks.hasPendingWorkspaceInvite.mockResolvedValue(false);
  mocks.membershipFindFirst.mockResolvedValue(null);
  mocks.organizationCreate.mockResolvedValue({
    id: "org_1",
    name: "Alice workspace",
    slug: "alice-workspace-ab",
    color: null,
  });
  mocks.teamCreate.mockResolvedValue({ id: "team_1" });
  mocks.membershipCreate.mockResolvedValue({ id: "mem_1" });
  mocks.developerCreate.mockResolvedValue({ id: "dev_1" });
  mocks.planInterestUpdateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      organization: { create: mocks.organizationCreate },
      team: { create: mocks.teamCreate },
      organizationMembership: { create: mocks.membershipCreate },
      developer: { create: mocks.developerCreate },
      planInterest: { updateMany: mocks.planInterestUpdateMany },
    };
    return fn(tx);
  });
});

test("createWorkspaceForUser does not create a Team row", async () => {
  const { createWorkspaceForUser } = await import("../lib/ensure-workspace");
  const result = await createWorkspaceForUser({
    id: "user_1",
    email: "alice@example.com",
    name: "Alice",
  });

  assert.equal(result.orgId, "org_1");
  assert.equal(result.created, true);
  assert.equal(mocks.teamCreate.mock.calls.length, 0);
  assert.equal(mocks.organizationCreate.mock.calls.length, 1);
  assert.equal(mocks.membershipCreate.mock.calls.length, 1);
  assert.equal(mocks.developerCreate.mock.calls.length, 1);
  const developerData = mocks.developerCreate.mock.calls[0][0].data;
  assert.equal(developerData.orgId, "org_1");
  assert.equal(developerData.authUserId, "user_1");
  assert.equal("teamId" in developerData, false);
  assert.equal(mocks.organizationCreate.mock.calls[0][0].data.dataRegion, "us");
});

test("provisionWorkspaceOnCreateUser creates a personal workspace for OAuth signup", async () => {
  const { provisionWorkspaceOnCreateUser } = await import("../lib/ensure-workspace");
  const result = await provisionWorkspaceOnCreateUser({
    id: "user_1",
    email: "alice@example.com",
    name: "Alice",
  });

  assert.deepEqual(result, { provisioned: true });
  assert.equal(mocks.organizationCreate.mock.calls.length, 1);
  assert.equal(onboardingMocks.hasPendingWorkspaceInvite.mock.calls.length, 1);
});

test("provisionWorkspaceOnCreateUser skips invitees", async () => {
  onboardingMocks.hasPendingWorkspaceInvite.mockResolvedValue(true);
  const { provisionWorkspaceOnCreateUser } = await import("../lib/ensure-workspace");
  const result = await provisionWorkspaceOnCreateUser({
    id: "user_1",
    email: "invitee@example.com",
    name: "Invitee",
  });

  assert.deepEqual(result, { provisioned: false, reason: "invite_pending" });
  assert.equal(mocks.organizationCreate.mock.calls.length, 0);
});

test("provisionWorkspaceOnCreateUser skips missing identity", async () => {
  const { provisionWorkspaceOnCreateUser } = await import("../lib/ensure-workspace");
  const result = await provisionWorkspaceOnCreateUser({ email: "a@example.com" });
  assert.deepEqual(result, { provisioned: false, reason: "missing_identity" });
});
