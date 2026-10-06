import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { usageDailyToCsv } from "@/lib/privacy/export";
import { sanitizeWorkTraceForViewer } from "@/lib/privacy/sanitize-work-trace";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  usageUpdate: vi.fn(),
  externalDelete: vi.fn(),
  seatDelete: vi.fn(),
  interestDelete: vi.fn(),
  interestFind: vi.fn(),
  prefsDelete: vi.fn(),
  prefsFind: vi.fn(),
  reportDelete: vi.fn(),
  membershipDelete: vi.fn(),
  membershipCount: vi.fn(),
  membershipFind: vi.fn(),
  developerUpdate: vi.fn(),
  userDelete: vi.fn(),
  auditFind: vi.fn(),
  auditUpdate: vi.fn(),
  decommission: vi.fn(),
  deviceDelete: vi.fn(),
  rematerialize: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    developer: { findFirst: mocks.findFirst, update: mocks.developerUpdate },
    usageDaily: { updateMany: mocks.usageUpdate },
    externalIdentity: { deleteMany: mocks.externalDelete },
    seatAssignment: { deleteMany: mocks.seatDelete },
    planInterest: { deleteMany: mocks.interestDelete, findMany: mocks.interestFind },
    userNotificationPreference: { deleteMany: mocks.prefsDelete, findUnique: mocks.prefsFind },
    dailyReportDelivery: { deleteMany: mocks.reportDelete },
    organizationMembership: {
      deleteMany: mocks.membershipDelete,
      count: mocks.membershipCount,
      findUnique: mocks.membershipFind,
    },
    user: { delete: mocks.userDelete },
    auditLog: { findMany: mocks.auditFind, update: mocks.auditUpdate },
    device: { deleteMany: mocks.deviceDelete },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/devices/decommission", () => ({
  decommissionDevices: mocks.decommission,
}));

vi.mock("@/lib/analytics/snapshots", () => ({
  ORG_DAY_SNAPSHOT_VERSION: "test",
  rematerializeOrgSnapshots: mocks.rematerialize,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.findFirst.mockResolvedValue({
    id: "dev_1",
    email: "person@example.com",
    name: "Person",
    authUserId: "user_1",
    devices: [{ id: "device_1" }],
  });
  mocks.auditFind.mockResolvedValue([
    { id: "log_1", metadata: { email: "person@example.com", name: "Person" } },
  ]);
  mocks.membershipCount.mockResolvedValue(0);
  mocks.userDelete.mockResolvedValue({ id: "user_1" });
  mocks.prefsFind.mockResolvedValue({ emailReports: true });
  mocks.interestFind.mockResolvedValue([]);
  mocks.membershipFind.mockResolvedValue({ role: "user" });
  mocks.transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const tx = {
      usageDaily: { updateMany: mocks.usageUpdate },
      externalIdentity: { deleteMany: mocks.externalDelete },
      seatAssignment: { deleteMany: mocks.seatDelete },
      planInterest: { deleteMany: mocks.interestDelete },
      userNotificationPreference: { deleteMany: mocks.prefsDelete },
      dailyReportDelivery: { deleteMany: mocks.reportDelete },
      organizationMembership: { deleteMany: mocks.membershipDelete },
      developer: { update: mocks.developerUpdate },
      device: { deleteMany: mocks.deviceDelete },
    };
    mocks.decommission.mockResolvedValue(undefined);
    return fn(tx);
  });
});

test("export bundle includes every person-linked category", async () => {
  mocks.findFirst.mockResolvedValue({
    id: "dev_1",
    name: "Person",
    email: "person@example.com",
    role: "user",
    removedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    authUserId: "user_1",
    authUser: { id: "user_1", email: "person@example.com" },
    devices: [{ id: "device_1" }],
    toolInstallations: [],
    toolAccounts: [],
    localModels: [],
    usageDaily: [
      {
        date: new Date("2026-09-01T00:00:00.000Z"),
        toolName: "cursor",
        model: "gpt-4.1",
        requests: 1,
        inputTokens: 1,
        outputTokens: 1,
      },
    ],
    localWorkSessions: [{ id: "work_1" }],
    signalsSessions: [],
    deviceActivityEvents: [],
    planAssignments: [],
    externalIdentities: [],
    seatAssignments: [],
  });
  const { exportDeveloperData } = await import("@/lib/privacy/export");
  const bundle = await exportDeveloperData("org_1", "dev_1");
  assert.ok(bundle);
  for (const key of [
    "developer",
    "account",
    "membership",
    "devices",
    "toolInstallations",
    "toolAccounts",
    "usageDaily",
    "workSessions",
    "signalsSessions",
    "deviceActivity",
    "planAssignments",
    "externalIdentities",
    "seatAssignments",
    "notificationPreferences",
    "planInterests",
    "usageCsv",
  ]) {
    assert.equal(key in bundle, true, `missing ${key}`);
  }
});

test("usage CSV includes the expected columns", () => {
  const csv = usageDailyToCsv([
    {
      date: new Date("2026-09-01T00:00:00.000Z"),
      toolName: "cursor",
      model: "gpt-4.1",
      requests: 4,
      inputTokens: 10,
      outputTokens: 20,
    },
  ]);
  assert.match(csv, /^date,toolName,model,requests,inputTokens,outputTokens\n/);
  assert.match(csv, /2026-09-01,cursor,gpt-4.1,4,10,20/);
});

test("manager traces drop userTurns", () => {
  const sanitized = sanitizeWorkTraceForViewer(
    { userTurns: [{ text: "secret ask" }], tools: ["Read"] } as never,
    false,
  );
  assert.equal(sanitized && "userTurns" in sanitized, false);
  assert.deepEqual(sanitized?.tools, ["Read"]);
  const kept = sanitizeWorkTraceForViewer(
    { userTurns: [{ text: "secret ask" }] } as never,
    true,
  );
  assert.equal(kept?.userTurns?.[0]?.text, "secret ask");
});

test("erasure anonymises the developer and scrubs usage plus audit email", async () => {
  const { eraseDeveloperData } = await import("@/lib/privacy/erase");
  const result = await eraseDeveloperData({ orgId: "org_1", developerId: "dev_1" });
  assert.equal(result.ok, true);
  const update = mocks.developerUpdate.mock.calls[0][0].data;
  assert.equal(update.name, "Erased member");
  assert.match(update.email, /erased-dev_1@erased\.invalid/);
  assert.equal(update.authUserId, null);
  assert.deepEqual(mocks.usageUpdate.mock.calls[0][0].data, {
    developerId: null,
    deviceId: null,
    metadata: {},
  });
  assert.equal(mocks.userDelete.mock.calls.length, 1);
  const redacted = mocks.auditUpdate.mock.calls[0][0].data.metadata;
  assert.equal(redacted.email, "[redacted-email]");
});
