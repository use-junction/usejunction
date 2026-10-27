import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import {
  ORG_DAY_SNAPSHOT_VERSION,
  ensureOrgUsageDaySnapshots,
  markOrgUsageDaysDirty,
  materializeDirtyOrgUsageDays,
  materializeOrgUsageRange,
} from "@/lib/analytics/snapshots";
import { invalidateAnalyticsCache } from "@/lib/analytics/query/invalidation";

const runDb = Boolean(process.env.DATABASE_URL);

test("ensure stubs missing days without rematerializing sealed days", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Stub Org ${suffix}`, slug: `stub-${suffix}` },
  });
  const earlyFrom = new Date("2026-05-01T00:00:00.000Z");
  const midFrom = new Date("2026-06-10T00:00:00.000Z");
  const midTo = new Date("2026-06-12T00:00:00.000Z");
  const lateTo = new Date("2026-06-20T00:00:00.000Z");
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `stub-${suffix}@example.com`,
      name: "Stub Dev",
      role: "user",
    },
  });

  try {
    for (let i = 0; i < 3; i += 1) {
      const date = new Date(midFrom.getTime() + i * 86_400_000);
      await prisma.usageDaily.create({
        data: {
          orgId: org.id,
          developerId: developer.id,
          date,
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          model: "gpt-4.1",
          source: "device_observed",
          requests: 7,
          inputTokens: BigInt(100),
          outputTokens: BigInt(20),
          costMicros: BigInt(100_000),
          costKind: "estimated_api",
          dedupeKey: `stub-test:${suffix}:${i}`,
          observedAt: date,
        },
      });
    }

    await materializeOrgUsageRange(org.id, midFrom, midTo);
    const sealedBefore = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: midFrom,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(sealedBefore);
    assert.equal(sealedBefore.requests, 7);
    const computedAtBefore = sealedBefore.computedAt.getTime();

    // Leave dirty markers that would have triggered min→max rebuilds before the fix.
    await markOrgUsageDaysDirty(org.id, [earlyFrom, lateTo]);

    const result = await ensureOrgUsageDaySnapshots(org.id, earlyFrom, lateTo);
    assert.ok(result.stubbed > 0);
    assert.equal(result.hadCoverage, true);
    assert.equal(result.recovered, 0);

    const sealedAfter = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: midFrom,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(sealedAfter);
    assert.equal(sealedAfter.requests, 7);
    assert.equal(sealedAfter.computedAt.getTime(), computedAtBefore);

    const earlyStub = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: earlyFrom,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    // Dirty days are not stub-sealed — prefer gaps over authoritative zeros.
    assert.equal(earlyStub, null);

    // Dirty rows must remain for cron / Sync now — ensure does not rematerialize
    // sealed days when stubs do not conflict with usage_daily.
    const dirty = await prisma.analyticsDirtyDay.count({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    assert.equal(dirty, 2);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("ensure does not rematerialize today based on snapshot age", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Today Org ${suffix}`, slug: `today-${suffix}` },
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const staleComputedAt = new Date(Date.now() - 10 * 60_000);

  try {
    await prisma.orgUsageDaySnapshot.create({
      data: {
        orgId: org.id,
        date: today,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
        requests: 42,
        inputTokens: BigInt(0),
        outputTokens: BigInt(0),
        verifiedUsageCostMicros: BigInt(0),
        estimatedApiCostMicros: BigInt(0),
        actualSpendCostMicros: BigInt(0),
        activeDevelopers: 0,
        activeDeveloperIds: [],
        computedAt: staleComputedAt,
        sourceObservedThrough: null,
      },
    });

    const result = await ensureOrgUsageDaySnapshots(org.id, today, today);
    assert.equal(result.stubbed, 0);
    assert.equal(result.hadCoverage, true);
    assert.equal(result.recovered, 0);

    const row = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: today,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(row);
    assert.equal(row.requests, 42);
    assert.equal(row.computedAt.getTime(), staleComputedAt.getTime());
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("materializeDirtyOrgUsageDays rematerializes contiguous ranges only", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Dirty Org ${suffix}`, slug: `dirty-${suffix}` },
  });
  const day1 = new Date("2026-06-01T00:00:00.000Z");
  const day2 = new Date("2026-06-02T00:00:00.000Z");
  const day3 = new Date("2026-06-03T00:00:00.000Z");
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `dirty-${suffix}@example.com`,
      name: "Dirty Dev",
      role: "user",
    },
  });

  try {
    for (const [i, date] of [day1, day2, day3].entries()) {
      await prisma.usageDaily.create({
        data: {
          orgId: org.id,
          developerId: developer.id,
          date,
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          model: "gpt-4.1",
          source: "device_observed",
          requests: i === 1 ? 99 : 5,
          inputTokens: BigInt(10),
          outputTokens: BigInt(2),
          costMicros: BigInt(10_000),
          costKind: "estimated_api",
          dedupeKey: `dirty-test:${suffix}:${i}`,
          observedAt: date,
        },
      });
    }

    // Seed all three days, then leave day2 as a stale stub while only day1+day3 are dirty.
    await materializeOrgUsageRange(org.id, day1, day3);
    await prisma.orgUsageDaySnapshot.updateMany({
      where: {
        orgId: org.id,
        date: day2,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
      data: {
        requests: 1,
        computedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.analyticsDirtyDay.deleteMany({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    await markOrgUsageDaysDirty(org.id, [day1, day3]);

    const result = await materializeDirtyOrgUsageDays(org.id);
    assert.equal(result.days, 2);

    const rows = await prisma.orgUsageDaySnapshot.findMany({
      where: {
        orgId: org.id,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
        date: { in: [day1, day2, day3] },
      },
      orderBy: { date: "asc" },
    });
    assert.equal(rows[0]?.requests, 5);
    // Gap day stays stale — contiguous rematerialize must not collapse day1→day3 into one range.
    assert.equal(rows[1]?.requests, 1);
    assert.equal(rows[2]?.requests, 5);

    const remainingDirty = await prisma.analyticsDirtyDay.count({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    assert.equal(remainingDirty, 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("invalidateAnalyticsCache rematerializes small dirty sets inline", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Inv Small ${suffix}`, slug: `invs-${suffix}` },
  });
  const day = new Date("2026-07-15T00:00:00.000Z");
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `invs-${suffix}@example.com`,
      name: "Inv Small Dev",
      role: "user",
    },
  });

  try {
    await prisma.usageDaily.create({
      data: {
        orgId: org.id,
        developerId: developer.id,
        date: day,
        provider: "cursor",
        product: "cursor",
        toolName: "cursor",
        model: "gpt-4.1",
        source: "device_observed",
        requests: 11,
        inputTokens: BigInt(50),
        outputTokens: BigInt(10),
        costMicros: BigInt(50_000),
        costKind: "estimated_api",
        dedupeKey: `invs-test:${suffix}`,
        observedAt: day,
      },
    });

    const result = await invalidateAnalyticsCache(org.id, { dirtyDates: [day] });
    assert.equal(result.rematerialized, true);

    const dirty = await prisma.analyticsDirtyDay.count({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    assert.equal(dirty, 0);

    const snap = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: day,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(snap);
    assert.equal(snap.requests, 11);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("invalidateAnalyticsCache rematerialize:false never settles inline", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Inv Defer ${suffix}`, slug: `invd-${suffix}` },
  });
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `invd-${suffix}@example.com`,
      name: "Inv Defer Dev",
      role: "user",
    },
  });
  const day = new Date("2026-07-10T00:00:00.000Z");

  try {
    await prisma.usageDaily.create({
      data: {
        orgId: org.id,
        developerId: developer.id,
        date: day,
        provider: "cursor",
        product: "cursor",
        toolName: "cursor",
        model: "gpt-4.1",
        source: "device_observed",
        requests: 1,
        inputTokens: BigInt(10),
        outputTokens: BigInt(2),
        costMicros: BigInt(1_000),
        costKind: "estimated_api",
        dedupeKey: `invd-test:${suffix}`,
        observedAt: day,
      },
    });

    const result = await invalidateAnalyticsCache(org.id, {
      dirtyDates: [day],
      rematerialize: false,
    });
    assert.equal(result.rematerialized, false);
    assert.ok(result.marked.length >= 1);

    const dirty = await prisma.analyticsDirtyDay.count({ where: { orgId: org.id } });
    assert.ok(dirty >= 1);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("invalidateAnalyticsCache keeps large dirty sets dirty-only", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Inv Large ${suffix}`, slug: `invl-${suffix}` },
  });
  const from = new Date("2026-06-01T00:00:00.000Z");
  const dates = Array.from({ length: 10 }, (_, i) => new Date(from.getTime() + i * 86_400_000));
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `invl-${suffix}@example.com`,
      name: "Inv Large Dev",
      role: "user",
    },
  });

  try {
    for (const [i, date] of dates.entries()) {
      await prisma.usageDaily.create({
        data: {
          orgId: org.id,
          developerId: developer.id,
          date,
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          model: "gpt-4.1",
          source: "device_observed",
          requests: 1,
          inputTokens: BigInt(10),
          outputTokens: BigInt(2),
          costMicros: BigInt(1_000),
          costKind: "estimated_api",
          dedupeKey: `invl-test:${suffix}:${i}`,
          observedAt: date,
        },
      });
    }

    // Seed a sealed snapshot so first-sync rematerialize does not fire.
    await materializeOrgUsageRange(org.id, dates[0]!, dates[0]!);
    await prisma.analyticsDirtyDay.deleteMany({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });

    const result = await invalidateAnalyticsCache(org.id, { dirtyDates: dates });
    assert.equal(result.rematerialized, false);

    const dirty = await prisma.analyticsDirtyDay.count({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    assert.equal(dirty, 10);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("ensure enqueues rematerialize when snapshots were wiped but usage_daily remains", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Wipe Org ${suffix}`, slug: `wipe-${suffix}` },
  });
  const from = new Date("2026-07-01T00:00:00.000Z");
  const to = new Date("2026-07-05T00:00:00.000Z");
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `wipe-${suffix}@example.com`,
      name: "Wipe Dev",
      role: "user",
    },
  });

  try {
    for (let i = 0; i < 5; i += 1) {
      const date = new Date(from.getTime() + i * 86_400_000);
      await prisma.usageDaily.create({
        data: {
          orgId: org.id,
          developerId: developer.id,
          date,
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          model: "gpt-4.1",
          source: "device_observed",
          requests: 4,
          inputTokens: BigInt(80),
          outputTokens: BigInt(20),
          costMicros: BigInt(80_000),
          costKind: "estimated_api",
          dedupeKey: `wipe-test:${suffix}:${i}`,
          observedAt: date,
        },
      });
    }

    await materializeOrgUsageRange(org.id, from, to);
    await prisma.orgUsageDaySnapshot.deleteMany({ where: { orgId: org.id } });

    const result = await ensureOrgUsageDaySnapshots(org.id, from, to);
    // Read path never rematerializes — missing-with-usage days are enqueued dirty.
    assert.equal(result.recovered, 0);
    assert.ok(result.pendingDirty > 0, "expected dirty days enqueued for worker");

    await materializeDirtyOrgUsageDays(org.id);

    const total = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: from,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(total);
    assert.equal(total.requests, 4);

    // Second ensure stays warm — no further recovery.
    const again = await ensureOrgUsageDaySnapshots(org.id, from, to);
    assert.equal(again.recovered, 0);
    assert.equal(again.pendingDirty, 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("ensure marks token/cost-only stubs dirty after first ingest (requests=0)", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Token Stub Org ${suffix}`, slug: `token-stub-${suffix}` },
  });
  const day = new Date("2026-07-21T00:00:00.000Z");
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `token-stub-${suffix}@example.com`,
      name: "Token Stub Dev",
      role: "user",
    },
  });

  try {
    // Codex local_scan shape: tokens + estimated cost, but requests stay 0.
    await prisma.usageDaily.create({
      data: {
        orgId: org.id,
        developerId: developer.id,
        date: day,
        provider: "openai",
        product: "codex",
        toolName: "codex",
        model: "gpt-5.6-sol",
        source: "device_observed",
        requests: 0,
        inputTokens: BigInt(7_225_706),
        outputTokens: BigInt(30_733),
        costMicros: BigInt(18_371_595),
        costKind: "estimated_api",
        dedupeKey: `token-stub-test:${suffix}`,
        observedAt: day,
      },
    });

    // Seed an empty stub then ensure — should mark dirty, not rematerialize inline.
    await prisma.orgUsageDaySnapshot.create({
      data: {
        orgId: org.id,
        date: day,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
        requests: 0,
        inputTokens: BigInt(0),
        outputTokens: BigInt(0),
        verifiedUsageCostMicros: BigInt(0),
        estimatedApiCostMicros: BigInt(0),
        actualSpendCostMicros: BigInt(0),
        activeDevelopers: 0,
        activeDeveloperIds: [],
        computedAt: new Date(),
        sourceObservedThrough: null,
      },
    });

    const stubbed = await ensureOrgUsageDaySnapshots(org.id, day, day);
    assert.equal(stubbed.recovered, 0, "ensure must not rematerialize on read path");
    assert.ok(stubbed.pendingDirty > 0, "expected corrupt stub marked dirty");

    await materializeDirtyOrgUsageDays(org.id);

    const total = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: day,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(total);
    assert.equal(total.requests, 0);
    assert.equal(total.inputTokens, BigInt(7_225_706));
    assert.equal(total.estimatedApiCostMicros, BigInt(18_371_595));
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("ensure enqueues undercounted snaps (codex-only while cursor vendor exists)", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Undercount Org ${suffix}`, slug: `undercount-${suffix}` },
  });
  const day = new Date("2026-07-22T00:00:00.000Z");
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `undercount-${suffix}@example.com`,
      name: "Undercount Dev",
      role: "user",
    },
  });

  try {
    await prisma.usageDaily.createMany({
      data: [
        {
          orgId: org.id,
          developerId: developer.id,
          date: day,
          provider: "openai",
          product: "codex",
          toolName: "codex",
          model: "gpt-5.6-sol",
          source: "device_observed",
          requests: 0,
          inputTokens: BigInt(7_225_706),
          outputTokens: BigInt(30_733),
          costMicros: BigInt(18_371_595),
          costKind: "estimated_api",
          dedupeKey: `undercount-codex:${suffix}`,
          observedAt: day,
        },
        {
          orgId: org.id,
          developerId: developer.id,
          date: day,
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          model: "cursor-grok-4.5-high",
          source: "vendor_verified",
          verified: true,
          requests: 94,
          inputTokens: BigInt(4_464_889),
          outputTokens: BigInt(775_604),
          costMicros: BigInt(42_683_012),
          costKind: "verified_usage",
          dedupeKey: `undercount-cursor:${suffix}`,
          observedAt: day,
        },
      ],
    });

    // Simulate a stale sealed day that only captured Codex.
    await prisma.orgUsageDaySnapshot.createMany({
      data: [
        {
          orgId: org.id,
          date: day,
          toolName: "",
          developerId: "",
          metricVersion: ORG_DAY_SNAPSHOT_VERSION,
          requests: 0,
          inputTokens: BigInt(7_225_706),
          outputTokens: BigInt(30_733),
          verifiedUsageCostMicros: BigInt(0),
          estimatedApiCostMicros: BigInt(18_371_595),
          actualSpendCostMicros: BigInt(0),
          activeDevelopers: 1,
          activeDeveloperIds: [developer.id],
          computedAt: new Date(),
          sourceObservedThrough: day,
        },
        {
          orgId: org.id,
          date: day,
          toolName: "codex",
          developerId: "",
          metricVersion: ORG_DAY_SNAPSHOT_VERSION,
          requests: 0,
          inputTokens: BigInt(7_225_706),
          outputTokens: BigInt(30_733),
          verifiedUsageCostMicros: BigInt(0),
          estimatedApiCostMicros: BigInt(18_371_595),
          actualSpendCostMicros: BigInt(0),
          activeDevelopers: 1,
          activeDeveloperIds: [developer.id],
          computedAt: new Date(),
          sourceObservedThrough: day,
        },
      ],
    });

    const result = await ensureOrgUsageDaySnapshots(org.id, day, day);
    assert.equal(result.recovered, 0, "ensure must not rematerialize on read path");
    assert.ok(result.pendingDirty > 0, "expected undercount marked dirty");

    await materializeDirtyOrgUsageDays(org.id);

    const total = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: day,
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(total);
    assert.equal(total.requests, 94);
    assert.equal(total.verifiedUsageCostMicros, BigInt(42_683_012));
    assert.equal(total.estimatedApiCostMicros, BigInt(18_371_595));

    const { readOrgUsageFromSnapshots } = await import("@/lib/analytics/snapshots/read");
    const overview = await readOrgUsageFromSnapshots(
      org.id,
      { from: day, to: day, timezone: "UTC", grain: "day" },
      { ensure: false, includeTools: true },
    );
    assert.equal(overview.kpis.modelCalls, 94);
    assert.ok(overview.kpis.verifiedUsageCost > 40);
    assert.ok(overview.tools.some((tool) => tool.toolName === "cursor" && tool.requests === 94));
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("a drain reseals history under a new snapshot version instead of leaving it empty", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Version Bump Org ${suffix}`, slug: `bump-${suffix}` },
  });
  const developer = await prisma.developer.create({
    data: { orgId: org.id, email: `bump-${suffix}@example.com`, name: "Bump Dev", role: "user" },
  });
  const previousVersion = `org-day-snap-v2:usage-v2:previous-${suffix}`;
  const firstDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - 5 * 86_400_000);
  const days = [0, 1, 2].map((offset) => new Date(firstDay.getTime() + offset * 86_400_000));

  try {
    for (const [index, date] of days.entries()) {
      await prisma.usageDaily.create({
        data: {
          orgId: org.id,
          developerId: developer.id,
          date,
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          model: "gpt-4.1",
          source: "device_observed",
          requests: 5,
          inputTokens: BigInt(50),
          outputTokens: BigInt(10),
          costMicros: BigInt(80_000),
          costKind: "estimated_api",
          dedupeKey: `bump-test:${suffix}:${index}`,
          observedAt: date,
        },
      });
    }

    // History was sealed under the version that ran before the deploy.
    await materializeOrgUsageRange(org.id, days[0]!, days[2]!, previousVersion);
    const underCurrentBefore = await prisma.orgUsageDaySnapshot.count({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION, toolName: "", developerId: "", date: { in: days } },
    });
    assert.equal(underCurrentBefore, 0, "the new version starts with no sealed days");

    const { rematerializeOrgSnapshots } = await import("@/lib/analytics/snapshots");
    const result = await rematerializeOrgSnapshots(org.id, { includeToday: false });
    assert.ok(result.dirtyDays >= 3, `expected the three usage days to be resealed, got ${result.dirtyDays}`);
    assert.equal(result.dirtyRemaining, 0);

    const resealed = await prisma.orgUsageDaySnapshot.findMany({
      where: { orgId: org.id, metricVersion: ORG_DAY_SNAPSHOT_VERSION, toolName: "", developerId: "", modelName: "", date: { in: days } },
      orderBy: { date: "asc" },
    });
    assert.equal(resealed.length, 3);
    for (const row of resealed) assert.equal(row.requests, 5);

    // A second drain finds nothing left to heal.
    const again = await rematerializeOrgSnapshots(org.id, { includeToday: false });
    assert.equal(again.dirtyDays, 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
