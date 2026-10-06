import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";
import { MY_DATA_PREFERENCE_EVENT_LIMIT } from "@/lib/privacy/my-data-constants";

const mocks = vi.hoisted(() => ({
  orgFind: vi.fn(),
  membershipFind: vi.fn(),
  userFind: vi.fn(),
  usageGroupBy: vi.fn(),
  deviceAggregate: vi.fn(),
  erasureFind: vi.fn(),
  listGatedAccounts: vi.fn(),
  listCollectionEvents: vi.fn(),
  resolveDeveloper: vi.fn(),
  signalsAllowed: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    organization: { findUnique: mocks.orgFind },
    organizationMembership: { findUnique: mocks.membershipFind },
    user: { findUnique: mocks.userFind },
    usageDaily: { groupBy: mocks.usageGroupBy },
    device: { aggregate: mocks.deviceAggregate },
    privacyRequest: { findFirst: mocks.erasureFind },
  },
}));

vi.mock("@/lib/privacy/account-collection", () => ({
  listGatedAccounts: mocks.listGatedAccounts,
  listCollectionEvents: mocks.listCollectionEvents,
}));

vi.mock("@/lib/queries/me/resolve-developer", () => ({
  resolveLinkedDeveloperId: mocks.resolveDeveloper,
}));

vi.mock("@/lib/region", async () => {
  const actual = await vi.importActual<typeof import("@/lib/region")>("@/lib/region");
  return { ...actual, signalsAllowed: mocks.signalsAllowed };
});

const principal = { userId: "user_1", orgId: "org_1", role: "user" as const, email: "dev@example.com" };

const workAccount = {
  id: "acc-work",
  deviceId: "device-1",
  hostname: "laptop",
  toolName: "cursor",
  displayName: "Cursor",
  accountKey: "work",
  email: "me@work.com",
  plan: "pro",
  authPresent: true,
  usageEnabled: true,
  loggingEnabled: false,
  usageAdminLocked: false,
  loggingAdminLocked: false,
  usageAllowed: true,
  loggingAllowed: false,
  updatedAt: "2026-09-23T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.orgFind.mockResolvedValue({ name: "Acme", dataRegion: "eu", usageRetentionDays: 90 });
  mocks.membershipFind.mockResolvedValue({
    collectionNoticeAckAt: new Date("2026-09-18T00:00:00.000Z"),
    collectionNoticeVersion: COLLECTION_NOTICE_VERSION,
    role: "user",
  });
  mocks.userFind.mockResolvedValue({
    name: "Dev",
    email: "dev@example.com",
    termsAcceptedAt: new Date("2026-09-18T00:00:00.000Z"),
    termsVersion: "2026-09-18",
    privacyVersion: "2026-09-18",
  });
  mocks.resolveDeveloper.mockResolvedValue("dev_1");
  mocks.listGatedAccounts.mockResolvedValue([workAccount]);
  mocks.listCollectionEvents.mockResolvedValue([
    {
      id: "evt-1",
      deviceId: "device-1",
      toolName: "cursor",
      accountKey: "work",
      stream: "usage",
      enabled: true,
      actor: "developer",
      createdAt: "2026-09-22T12:00:00.000Z",
    },
  ]);
  mocks.usageGroupBy.mockResolvedValue([
    { deviceId: "device-1", toolName: "cursor", accountKey: "work", _max: { date: new Date("2026-09-21T00:00:00.000Z") } },
    { deviceId: "device-1", toolName: "cursor", accountKey: "", _max: { date: new Date("2026-09-20T00:00:00.000Z") } },
    { deviceId: null, toolName: "cursor", accountKey: "work", _max: { date: new Date("2026-09-19T00:00:00.000Z") } },
  ]);
  mocks.deviceAggregate.mockResolvedValue({
    _count: { _all: 2 },
    _max: { lastSeenAt: new Date("2026-09-23T08:00:00.000Z") },
  });
  mocks.erasureFind.mockResolvedValue({
    id: "erase_1",
    scheduledFor: new Date("2026-10-23T00:00:00.000Z"),
  });
  mocks.signalsAllowed.mockReturnValue(false);
});

test("My data payload attaches stored usage, pending erasure, and notice in one response", async () => {
  const { loadMyDataPage } = await import("@/lib/app-pages/my-data");
  const payload = await loadMyDataPage(principal);

  assert.equal(payload.developerId, "dev_1");
  assert.equal(payload.signalsAvailable, false);
  assert.equal(payload.membership.collectionNoticeAcked, true);
  assert.equal(payload.membership.collectionNoticeAckAt, "2026-09-18T00:00:00.000Z");
  assert.match(payload.notice.usageDefinition, /Turning Usage off stops new uploads/);
  assert.equal(payload.summary.accountCount, 1);
  assert.equal(payload.summary.collectingCount, 1);
  assert.equal(payload.summary.usageCollectingCount, 1);
  assert.equal(payload.summary.deviceCount, 2);
  assert.equal(payload.summary.lastDeviceSeenAt, "2026-09-23T08:00:00.000Z");
  assert.equal(payload.summary.latestStoredUsageDay, "2026-09-21");
  assert.equal(payload.summary.hasUnattributedUsage, true);
  assert.equal(payload.collection.accounts[0]?.usageStorage.state, "active_day");
  assert.equal(payload.collection.accounts[0]?.usageStorage.lastUsageDay, "2026-09-21");
  assert.equal(payload.collection.preferenceEvents[0]?.email, "me@work.com");
  assert.equal(payload.rights.erasure.pending, true);
  assert.equal(payload.rights.erasure.scheduledFor, "2026-10-23T00:00:00.000Z");
  assert.ok(payload.rights.legalLinks.some((link) => link.href === "/gdpr"));
  assert.ok(payload.rights.legalLinks.some((link) => /employee-notice-template/.test(link.href)));

  const groupWhere = mocks.usageGroupBy.mock.calls[0]?.[0]?.where;
  assert.deepEqual(groupWhere.requests, { gt: 0 });
  assert.ok(groupWhere.date.gte instanceof Date);
  assert.equal(mocks.listCollectionEvents.mock.calls[0]?.[0]?.take, MY_DATA_PREFERENCE_EVENT_LIMIT);
});

test("zero-request placeholders are excluded by the stored-usage query", async () => {
  const { loadMyDataPage } = await import("@/lib/app-pages/my-data");
  await loadMyDataPage(principal);
  assert.deepEqual(mocks.usageGroupBy.mock.calls[0]?.[0]?.by, ["deviceId", "toolName", "accountKey"]);
  assert.deepEqual(mocks.usageGroupBy.mock.calls[0]?.[0]?.where.requests, { gt: 0 });
});

test("missing developer still returns notice, rights, and empty collection", async () => {
  mocks.resolveDeveloper.mockResolvedValue(null);
  const { loadMyDataPage } = await import("@/lib/app-pages/my-data");
  const payload = await loadMyDataPage(principal);
  assert.equal(payload.developerId, null);
  assert.equal(payload.summary.accountCount, 0);
  assert.equal(payload.collection.accounts.length, 0);
  assert.equal(payload.rights.exportHref, "/api/app/me/privacy/export");
  assert.equal(mocks.usageGroupBy.mock.calls.length, 0);
});
