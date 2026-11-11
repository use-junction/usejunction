import { test } from "vitest";
import assert from "node:assert/strict";
import { prisma } from "@usejunction/db";
import {
  ORG_DAY_SNAPSHOT_VERSION,
  countUnbackedDeviceRows,
  ensureOrgUsageDaySnapshots,
  getDashboardReadiness,
  materializeOrgUsageRange,
  readOrgUsageFromSnapshots,
} from "@/lib/analytics/snapshots";
import { UTC_TIMEZONE } from "@/lib/analytics/contracts/time-window";

const runDb = Boolean(process.env.DATABASE_URL);

const BACKED_DAY = new Date("2026-09-01T00:00:00.000Z");
const UNBACKED_DAY = new Date("2026-09-05T00:00:00.000Z");
const ONLY_UNBACKED_DAY = new Date("2026-09-06T00:00:00.000Z");
const LEGACY_DAY = new Date("2026-07-01T00:00:00.000Z");
// Rows uploaded today, long after the legacy route was removed.
const OBSERVED_NOW = new Date("2026-11-11T09:00:00.000Z");

async function seedOrg(suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `Sync Trail Org ${suffix}`, slug: `sync-trail-${suffix}` },
  });
  const developer = await prisma.developer.create({
    data: { orgId: org.id, email: `trail-${suffix}@example.com`, name: "Trail Dev", role: "user" },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: developer.id,
      hostname: "trail-mac.local",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "1.0.0",
      deviceToken: `trail-token-${suffix}`,
    },
  });
  return { org, developer, device };
}

function claudeRow(input: {
  orgId: string;
  developerId: string;
  deviceId: string | null;
  date: Date;
  costMicros: number;
  requests: number;
  dedupeKey: string;
  source?: string;
  costKind?: string;
  observedAt?: Date;
}) {
  return prisma.usageDaily.create({
    data: {
      orgId: input.orgId,
      developerId: input.developerId,
      deviceId: input.deviceId,
      date: input.date,
      provider: "anthropic",
      product: "claude",
      toolName: "claude",
      accountKey: "trail@example.com",
      model: "claude-opus-5-5",
      source: input.source ?? "device_observed",
      requests: input.requests,
      inputTokens: BigInt(input.requests * 2),
      outputTokens: BigInt(input.requests * 500),
      costMicros: BigInt(input.costMicros),
      costKind: input.costKind ?? "estimated_api",
      dedupeKey: input.dedupeKey,
      observedAt: input.observedAt ?? OBSERVED_NOW,
    },
  });
}

async function orgTotal(orgId: string, day: Date) {
  return prisma.orgUsageDaySnapshot.findFirst({
    where: { orgId, date: day, toolName: "", developerId: "", modelName: "", metricVersion: ORG_DAY_SNAPSHOT_VERSION },
  });
}

test("snapshots leave out device usage that no sync run uploaded", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, developer, device } = await seedOrg(suffix);
  const base = { orgId: org.id, developerId: developer.id };

  try {
    // A real upload: the device declared a window covering BACKED_DAY.
    await prisma.syncRun.create({
      data: {
        orgId: org.id,
        deviceId: device.id,
        status: "committed",
        windowFrom: new Date("2026-08-15T00:00:00.000Z"),
        windowTo: new Date("2026-09-02T00:00:00.000Z"),
        committedAt: new Date("2026-09-02T08:00:00.000Z"),
      },
    });
    await claudeRow({ ...base, deviceId: device.id, date: BACKED_DAY, costMicros: 40_000_000, requests: 400, dedupeKey: `trail:${suffix}:backed` });

    // Same device, a date no sync run ever covered: written outside the pipeline.
    await claudeRow({ ...base, deviceId: device.id, date: UNBACKED_DAY, costMicros: 900_000_000, requests: 5_000, dedupeKey: `trail:${suffix}:unbacked` });
    // Vendor rows never come from a device sync and keep counting.
    await claudeRow({
      ...base, deviceId: null, date: UNBACKED_DAY, costMicros: 7_000_000, requests: 70,
      dedupeKey: `trail:${suffix}:vendor`, source: "vendor_verified", costKind: "verified_usage",
    });
    // A day whose only usage is an unbacked device row with no device at all.
    await claudeRow({ ...base, deviceId: null, date: ONLY_UNBACKED_DAY, costMicros: 800_000_000, requests: 4_000, dedupeKey: `trail:${suffix}:orphan` });
    // Uploaded through the legacy route before sync runs existed.
    await claudeRow({
      ...base, deviceId: device.id, date: LEGACY_DAY, costMicros: 12_000_000, requests: 120,
      dedupeKey: `trail:${suffix}:legacy`, observedAt: new Date("2026-07-02T10:00:00.000Z"),
    });

    await materializeOrgUsageRange(org.id, LEGACY_DAY, ONLY_UNBACKED_DAY);

    const backed = await orgTotal(org.id, BACKED_DAY);
    assert.equal(Number(backed?.estimatedApiCostMicros ?? 0), 40_000_000);
    assert.equal(backed?.requests, 400);

    const unbacked = await orgTotal(org.id, UNBACKED_DAY);
    assert.equal(Number(unbacked?.estimatedApiCostMicros ?? 0), 0, "unbacked device spend must not count");
    assert.equal(Number(unbacked?.verifiedUsageCostMicros ?? 0), 7_000_000, "vendor spend still counts");

    const legacy = await orgTotal(org.id, LEGACY_DAY);
    assert.equal(Number(legacy?.estimatedApiCostMicros ?? 0), 12_000_000, "legacy uploads keep counting");

    const overview = await readOrgUsageFromSnapshots(org.id, {
      from: LEGACY_DAY, to: ONLY_UNBACKED_DAY, timezone: UTC_TIMEZONE, grain: "day",
    });
    assert.equal(overview.kpis.estimatedApiCost, 52);

    const excluded = await countUnbackedDeviceRows(org.id, "2026-07-01", "2026-09-06");
    assert.equal(excluded.rows, 2);
    assert.equal(excluded.costMicros, BigInt(1_700_000_000));
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("erasing a person keeps their synced spend in org totals", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, developer, device } = await seedOrg(suffix);

  try {
    await prisma.syncRun.create({
      data: {
        orgId: org.id, deviceId: device.id, status: "committed",
        windowFrom: new Date("2026-08-15T00:00:00.000Z"), windowTo: new Date("2026-09-02T00:00:00.000Z"),
      },
    });
    await claudeRow({
      orgId: org.id, developerId: developer.id, deviceId: device.id, date: BACKED_DAY,
      costMicros: 40_000_000, requests: 400, dedupeKey: `trail:${suffix}:erased`,
    });

    // Erasure deletes the device, which deletes its sync runs.
    const { eraseDeveloperData } = await import("@/lib/privacy/erase");
    const erased = await eraseDeveloperData({ orgId: org.id, developerId: developer.id });
    assert.equal(erased.ok, true);
    assert.equal(await prisma.syncRun.count({ where: { orgId: org.id } }), 0);

    await materializeOrgUsageRange(org.id, BACKED_DAY, BACKED_DAY);
    const total = await orgTotal(org.id, BACKED_DAY);
    assert.equal(Number(total?.estimatedApiCostMicros ?? 0), 40_000_000, "erased spend must stay in org totals");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("a day with only unbacked device usage seals instead of staying dirty", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, developer, device } = await seedOrg(suffix);

  try {
    await claudeRow({
      orgId: org.id, developerId: developer.id, deviceId: device.id, date: ONLY_UNBACKED_DAY,
      costMicros: 800_000_000, requests: 4_000, dedupeKey: `trail:${suffix}:only`,
    });

    const sealed = await ensureOrgUsageDaySnapshots(org.id, ONLY_UNBACKED_DAY, ONLY_UNBACKED_DAY);
    assert.equal(sealed.pendingDirty, 0, "zero-seal guard must not treat unbacked rows as usage");
    assert.equal(sealed.stubbed, 1);

    const dirty = await prisma.analyticsDirtyDay.count({
      where: { orgId: org.id, date: ONLY_UNBACKED_DAY, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    assert.equal(dirty, 0);

    // Re-checking the sealed stub must not flag it as corrupt or as a stub conflict.
    const again = await ensureOrgUsageDaySnapshots(org.id, ONLY_UNBACKED_DAY, ONLY_UNBACKED_DAY);
    assert.equal(again.pendingDirty, 0, "corrupt-day check must not reopen the day");
    const readiness = await getDashboardReadiness(org.id, { from: ONLY_UNBACKED_DAY, to: ONLY_UNBACKED_DAY });
    assert.equal(readiness.stubConflictDayCount, 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
