import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usageDelete: vi.fn(),
  snapshotDelete: vi.fn(),
  quotaDelete: vi.fn(),
  requestDelete: vi.fn(),
  reportDelete: vi.fn(),
  providerDelete: vi.fn(),
  bucketDelete: vi.fn(),
  auditDelete: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    usageDaily: { deleteMany: mocks.usageDelete },
    orgUsageDaySnapshot: { deleteMany: mocks.snapshotDelete },
    quotaObservation: { deleteMany: mocks.quotaDelete },
    requestMetadata: { deleteMany: mocks.requestDelete },
    dailyReportUsageSnapshot: { deleteMany: mocks.reportDelete },
    providerSourceRecord: { deleteMany: mocks.providerDelete },
    rateLimitBucket: { deleteMany: mocks.bucketDelete },
    auditLog: { deleteMany: mocks.auditDelete },
  },
}));

vi.mock("@/lib/rbac", () => ({
  audit: vi.fn(),
}));

vi.mock("@/lib/privacy/erase", () => ({
  eraseDeveloperData: vi.fn(),
}));

vi.mock("@/lib/signals/service", () => ({
  enforceSignalsRetention: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mocks)) fn.mockResolvedValue({ count: 2 });
});

test("usage retention labels whole years without a deletion schedule", async () => {
  const { DEFAULT_USAGE_RETENTION_DAYS, formatUsageRetention, USAGE_RETENTION_ENFORCEMENT_ENABLED } =
    await import("@/lib/legal/versions");
  assert.equal(DEFAULT_USAGE_RETENTION_DAYS, 1095);
  assert.equal(formatUsageRetention(1095), "3 years");
  assert.equal(formatUsageRetention(365), "1 year");
  assert.equal(formatUsageRetention(90), "90 days");
  assert.equal(USAGE_RETENTION_ENFORCEMENT_ENABLED, false);
});

test("usage retention deletes facts and snapshots older than the cutoff", async () => {
  const { enforceUsageRetention } = await import("@/lib/privacy/retention");
  const now = new Date("2026-09-18T00:00:00.000Z");
  const result = await enforceUsageRetention("org_1", 365, now);

  assert.equal(result.usage, 2);
  assert.equal(result.snapshots, 2);
  const usageWhere = mocks.usageDelete.mock.calls[0][0].where;
  assert.equal(usageWhere.orgId, "org_1");
  assert.ok(usageWhere.date.lt instanceof Date);
  assert.equal(mocks.snapshotDelete.mock.calls[0][0].where.orgId, "org_1");
});

test("global TTLs keep privacy audit rows", async () => {
  const { enforceGlobalTtls } = await import("@/lib/privacy/retention");
  const now = new Date("2026-09-18T00:00:00.000Z");
  await enforceGlobalTtls(now);
  const auditWhere = mocks.auditDelete.mock.calls[0][0].where;
  assert.deepEqual(auditWhere.NOT, { action: { startsWith: "privacy." } });
  assert.ok(auditWhere.createdAt.lt instanceof Date);
});
