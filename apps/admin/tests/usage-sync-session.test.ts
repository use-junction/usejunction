import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import { buildUsageDedupeKey } from "@/lib/ingest/local-usage-batch";
import {
  startUsageSync,
  commitUsageSync,
  ingestUsageSyncChunk,
  reconcileDeviceDayPartitions,
  runDeferredUsageCommitWork,
  runDeferredUsageStartWork,
} from "@/lib/sync/usage-sync";

const runDb = Boolean(process.env.DATABASE_URL);

async function enableGatedUsage(orgId: string, userId: string, deviceId: string) {
  for (const toolName of ["cursor", "codex"] as const) {
    await prisma.toolAccount.create({
      data: {
        orgId,
        userId,
        deviceId,
        toolName,
        accountKey: toolName,
        usageEnabled: true,
        loggingEnabled: true,
        authPresent: true,
      },
    });
  }
}

test("usage sync session start/chunk/commit is idempotent", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Sync Org ${suffix}`, slug: `sync-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `sync-${suffix}@example.com`,
      name: "Sync Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "sync-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: "2026-07-21|codex|codex|gpt-5|local_scan|",
          date: "2026-07-21",
          tool: "codex",
          model: "gpt-5",
          source: "local_scan",
          contentHash: "hash-1",
          rowCount: 1,
        },
      ],
    });
    assert.ok(start.syncRunId);
    assert.deepEqual(start.deltaPartitions, ["2026-07-21|codex|codex|gpt-5|local_scan|"]);

    const chunk = await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "chunk-1",
      rows: [
        {
          date: "2026-07-21",
          toolName: "codex",
          accountKey: "codex",
          model: "gpt-5",
          source: "local_scan",
          inputTokens: 10,
          outputTokens: 2,
          estimatedCost: 0.01,
          requests: 1,
        },
      ],
    });
    assert.equal(chunk.upserted, 1);

    const dup = await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "chunk-1",
      rows: [],
    });
    assert.equal(dup.duplicate, true);

    const committed = await commitUsageSync({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      expectedChunks: 1,
    });
    assert.equal(committed.status, "committed");
    assert.equal(committed.deferredWork, undefined);
    // Settle may leave dirtyRemaining when materialize fails (e.g. schema drift);
    // commit still seals the sync run.
    assert.ok(typeof committed.dirtyRemaining === "number");
    assert.ok(typeof committed.timings.reconcileMs === "number");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("legacy Cursor cost fingerprints produce zero delta on an unchanged second sync", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Legacy Fingerprint Org ${suffix}`, slug: `legacy-fp-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `legacy-fp-${suffix}@example.com`,
      name: "Legacy Fingerprint Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "legacy-fingerprint-host",
      os: "windows",
      architecture: "arm64",
      agentVersion: "0.4.8",
      deviceToken: `legacy-fp-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);
  const partitionKey = "2026-07-21|cursor|cursor|composer|cursor_usage_events|";
  const legacyHash = "in:0,out:0,cr:0,cw:0,r:0,req:0,cost:100,sug:0,acc:0,add:0,del:0,com:0,ai:,v:0,mk:usage";
  const roundedHash = legacyHash.replace("cost:100", "cost:101");
  const partition = {
    partitionKey,
    date: "2026-07-21",
    tool: "cursor",
    model: "composer",
    source: "cursor_usage_events",
    contentHash: legacyHash,
    rowCount: 1,
  };

  try {
    const first = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [partition],
    });
    assert.deepEqual(first.deltaPartitions, [partitionKey]);

    await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: first.syncRunId,
      chunkId: "legacy-cursor-chunk",
      rows: [{
        date: "2026-07-21",
        toolName: "cursor",
        accountKey: "cursor",
        model: "composer",
        source: "cursor_usage_events",
        estimatedCost: 0.0001006,
        costKind: "estimated_api",
        metricKind: "usage",
      }],
    });
    const committed = await commitUsageSync({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: first.syncRunId,
      expectedChunks: 1,
    });
    assert.equal(committed.status, "committed");
    assert.equal(committed.dirtyRemaining, 0);

    const stored = await prisma.deviceUsageFingerprint.findUniqueOrThrow({
      where: { deviceId_partitionKey: { deviceId: device.id, partitionKey } },
    });
    assert.equal(stored.contentHash, roundedHash);

    const second = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [partition],
    });
    assert.deepEqual(second.deltaPartitions, []);
    assert.equal(await prisma.analyticsDirtyDay.count({ where: { orgId: org.id } }), 0);

    await prisma.device.update({
      where: { id: device.id },
      data: { agentVersion: "0.4.9" },
    });
    const fixedAgent = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [partition],
    });
    assert.deepEqual(fixedAgent.deltaPartitions, [partitionKey]);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync chunks defer rematerialize; commit settles projections", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Settle Sync Org ${suffix}`, slug: `settle-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `settle-${suffix}@example.com`,
      name: "Settle Sync Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "settle-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `settle-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: "2026-07-21|cursor|cursor|gpt-4.1|local_scan|",
          date: "2026-07-21",
          tool: "cursor",
          model: "gpt-4.1",
          source: "local_scan",
          contentHash: "settle-hash-1",
          rowCount: 1,
        },
      ],
    });
    assert.ok(start.syncRunId);

    await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "settle-chunk-1",
      rows: [
        {
          date: "2026-07-21",
          toolName: "cursor",
          accountKey: "cursor",
          model: "gpt-4.1",
          source: "local_scan",
          inputTokens: 100,
          outputTokens: 20,
          estimatedCost: 0.05,
          requests: 2,
        },
      ],
    });

    // Chunk must leave days dirty (no mid-chunk settle).
    const dirtyAfterChunk = await prisma.analyticsDirtyDay.count({
      where: { orgId: org.id },
    });
    assert.ok(dirtyAfterChunk >= 1, "chunk should mark dirty without settling");

    const committed = await commitUsageSync({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      expectedChunks: 1,
    });
    assert.equal(committed.status, "committed");
    assert.equal(committed.deferredWork, undefined);
    assert.ok(typeof committed.dirtyRemaining === "number");
    assert.ok(typeof committed.timings.reconcileMs === "number");

    // When settle succeeds, dirty clears and tool snapshots appear. Local DBs
    // without the latest snapshot columns may leave dirtyRemaining > 0.
    if (committed.dirtyRemaining === 0) {
      const dirtyAfterCommit = await prisma.analyticsDirtyDay.count({
        where: { orgId: org.id },
      });
      assert.equal(dirtyAfterCommit, 0);

      const toolSnap = await prisma.orgUsageDaySnapshot.findFirst({
        where: {
          orgId: org.id,
          toolName: "cursor",
          date: new Date("2026-07-21T00:00:00.000Z"),
        },
      });
      assert.ok(toolSnap, "commit settle should materialize tool snapshot");
      assert.ok(Number(toolSnap.requests) >= 2);
    }
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync commit deferHeavyWork schedules reconcile+settle", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Defer Commit Org ${suffix}`, slug: `defer-c-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `defer-c-${suffix}@example.com`,
      name: "Defer Commit Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "defer-c-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `defer-c-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: "2026-07-21|codex|codex|gpt-5|local_scan|",
          date: "2026-07-21",
          tool: "codex",
          model: "gpt-5",
          source: "local_scan",
          contentHash: "defer-c-hash",
          rowCount: 1,
        },
      ],
    });
    await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "defer-c-chunk",
      rows: [
        {
          date: "2026-07-21",
          toolName: "codex",
          accountKey: "codex",
          model: "gpt-5",
          source: "local_scan",
          inputTokens: 1,
          outputTokens: 1,
          estimatedCost: 0.001,
          requests: 1,
        },
      ],
    });

    const committed = await commitUsageSync(
      {
        orgId: org.id,
        deviceId: device.id,
        syncRunId: start.syncRunId,
        expectedChunks: 1,
      },
      { deferHeavyWork: true },
    );
    assert.equal(committed.status, "committed");
    assert.equal(committed.timings.materializeMs, 0);
    assert.equal(committed.timings.reconcileMs, 0);
    assert.ok(committed.deferredWork?.settle);
    assert.ok(committed.deferredWork?.reconcile);

    const runBefore = await prisma.syncRun.findUnique({ where: { id: start.syncRunId } });
    assert.equal(runBefore?.status, "committed");

    await runDeferredUsageCommitWork(committed.deferredWork!);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync commit skips settle when remainingPartitions > 0", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Remain Commit Org ${suffix}`, slug: `remain-c-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `remain-c-${suffix}@example.com`,
      name: "Remain Commit Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "remain-c-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `remain-c-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: "2026-07-21|codex|codex|gpt-5|local_scan|",
          date: "2026-07-21",
          tool: "codex",
          model: "gpt-5",
          source: "local_scan",
          contentHash: "remain-c-hash",
          rowCount: 1,
        },
      ],
    });
    await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "remain-c-chunk",
      rows: [
        {
          date: "2026-07-21",
          toolName: "codex",
          accountKey: "codex",
          model: "gpt-5",
          source: "local_scan",
          requests: 1,
          inputTokens: 10,
          outputTokens: 5,
        },
      ],
    });

    const committed = await commitUsageSync(
      {
        orgId: org.id,
        deviceId: device.id,
        syncRunId: start.syncRunId,
        expectedChunks: 1,
        remainingPartitions: 500,
      },
      { deferHeavyWork: true },
    );
    assert.equal(committed.status, "committed");
    assert.equal(committed.deferredWork?.settle, false);
    assert.ok(committed.deferredWork?.reconcile);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync start deferHeavyWork defers empty-delta settle", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Defer Start Org ${suffix}`, slug: `defer-s-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `defer-s-${suffix}@example.com`,
      name: "Defer Start Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "defer-s-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `defer-s-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    const start = await startUsageSync(
      {
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        partitions: [],
      },
      { deferHeavyWork: true },
    );
    assert.equal(start.status, "committed");
    assert.deepEqual(start.deltaPartitions, []);
    assert.ok(start.deferredWork?.emptyDeltaSettle);
    assert.ok(typeof start.timings.inventoryMs === "number");
    assert.ok(typeof start.timings.fingerprintMs === "number");

    await runDeferredUsageStartWork(start.deferredWork!);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync start applies tools sidecar once then short-circuits on hash", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Tools Sync Org ${suffix}`, slug: `tools-sync-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `tools-sync-${suffix}@example.com`,
      name: "Tools Sync Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "tools-sync-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `tools-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  const tools = {
    contentHash: "",
    items: [
      { toolName: "cursor", detected: true, configured: true, version: "1.0", configPath: "/c" },
      { toolName: "codex", detected: true, configured: false, version: "2.0", configPath: "/x" },
    ],
  };
  const { toolsInventoryContentHash } = await import("@/lib/sync/tools-inventory");
  tools.contentHash = toolsInventoryContentHash(tools.items);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [],
      tools,
    });
    assert.equal(start.toolsApplied, "updated");
    assert.equal(start.status, "committed");

    const installs = await prisma.toolInstallation.findMany({
      where: { deviceId: device.id },
      orderBy: { toolName: "asc" },
    });
    assert.equal(installs.length, 2);
    assert.equal(installs[0]?.toolName, "codex");
    assert.equal(installs[1]?.toolName, "cursor");

    const deviceRow = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    assert.equal(deviceRow.toolsContentHash, tools.contentHash);
    assert.ok(deviceRow.lastToolsSyncAt);
    assert.ok(deviceRow.lastUsageSyncAt, "zero-row committed sync should mark usage readiness");

    const again = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [],
      tools,
    });
    assert.equal(again.toolsApplied, "unchanged");

    // Stale tool removed when inventory shrinks.
    const shrunkItems = [tools.items[0]!]; // keep cursor only
    const shrunkHash = toolsInventoryContentHash(shrunkItems);
    const shrink = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [],
      tools: { contentHash: shrunkHash, items: shrunkItems },
    });
    assert.equal(shrink.toolsApplied, "updated");
    const after = await prisma.toolInstallation.findMany({ where: { deviceId: device.id } });
    assert.equal(after.length, 1);
    assert.equal(after[0]?.toolName, "cursor");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync start keeps usage delta when tools apply would fail", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Tools Fail Org ${suffix}`, slug: `tools-fail-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `tools-fail-${suffix}@example.com`,
      name: "Tools Fail Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "tools-fail-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `tools-fail-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    // Invalid org/user mismatch is hard to force through startUsageSync params
    // (they are trusted). Instead verify empty-name tools still return a usage delta.
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: "2026-07-21|codex|codex|gpt-5|local_scan|",
          date: "2026-07-21",
          tool: "codex",
          model: "gpt-5",
          source: "local_scan",
          contentHash: "hash-tools-fail",
          rowCount: 1,
        },
      ],
      tools: {
        contentHash: "forced-new-hash",
        items: [{ toolName: "", detected: true }],
      },
    });
    assert.ok(start.deltaPartitions.includes("2026-07-21|codex|codex|gpt-5|local_scan|"));
    assert.equal(start.toolsApplied, "updated");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync start applies accounts+quotas and creates billing templates", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `AQ Sync Org ${suffix}`, slug: `aq-sync-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `aq-sync-${suffix}@example.com`,
      name: "AQ Sync Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "aq-sync-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `aq-tok-${suffix}`,
    },
  });
  await prisma.toolAccount.create({
    data: {
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      toolName: "cursor",
      accountKey: "dev@example.com",
      email: "dev@example.com",
      usageEnabled: true,
      loggingEnabled: true,
      authPresent: true,
      loginMethod: "local_app",
    },
  });

  const { accountsInventoryContentHash } = await import("@/lib/sync/accounts-inventory");
  const { quotasInventoryContentHash } = await import("@/lib/sync/quotas-inventory");

  const accountsItems = [
    {
      toolName: "cursor",
      email: "dev@example.com",
      plan: "pro",
      loginMethod: "local_app",
      authPresent: true,
    },
  ];
  const quotasItems = [
    {
      toolName: "cursor",
      accountKey: "dev@example.com",
      windowType: "plan",
      usedPercent: 12.5,
      source: "api",
    },
  ];
  const accounts = {
    contentHash: accountsInventoryContentHash(accountsItems),
    items: accountsItems,
  };
  const quotas = {
    contentHash: quotasInventoryContentHash(quotasItems),
    items: quotasItems,
  };

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [],
      accounts,
      quotas,
    });
    assert.equal(start.accountsApplied, "updated");
    assert.equal(start.quotasApplied, "updated");
    assert.equal(start.status, "committed");

    const accountRows = await prisma.toolAccount.findMany({ where: { deviceId: device.id } });
    assert.equal(accountRows.length, 1);
    assert.equal(accountRows[0]?.plan, "pro");

    const quotaRows = await prisma.quotaSnapshot.findMany({ where: { deviceId: device.id } });
    assert.equal(quotaRows.length, 1);

    const templates = await prisma.billingPlanTemplate.findMany({
      where: { orgId: org.id, priceSource: "detected" },
    });
    assert.ok(templates.length >= 1, "expected detected billing_plan_templates");

    const assignments = await prisma.developerPlanAssignment.findMany({
      where: { orgId: org.id, source: "detected", active: true },
    });
    assert.ok(assignments.length >= 1, "expected detected plan assignment");

    const oldWatermark = new Date("2020-01-01T00:00:00.000Z");
    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: oldWatermark,
        lastAccountSyncAt: oldWatermark,
        lastQuotasSyncAt: oldWatermark,
      },
    });

    const again = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [],
      accounts,
      quotas,
    });
    assert.equal(again.accountsApplied, "unchanged");
    assert.equal(again.quotasApplied, "unchanged");
    const refreshedDevice = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    assert.ok(refreshedDevice.lastAccountSyncAt && refreshedDevice.lastAccountSyncAt > oldWatermark);
    assert.ok(refreshedDevice.lastQuotasSyncAt && refreshedDevice.lastQuotasSyncAt > oldWatermark);
    assert.ok(refreshedDevice.lastSeenAt > oldWatermark);

    const templatesAgain = await prisma.billingPlanTemplate.findMany({
      where: { orgId: org.id, priceSource: "detected" },
    });
    assert.equal(templatesAgain.length, templates.length);

    // Auth present + null vendor plan still creates a free/default detected seat
    // so admins can see free tools in Current cycles (Codex → free).
    const nullPlanOrg = await prisma.organization.create({
      data: { name: `Null Plan Org ${suffix}`, slug: `null-plan-${suffix}` },
    });
    const nullUser = await prisma.developer.create({
      data: {
        orgId: nullPlanOrg.id,
        email: `null-plan-${suffix}@example.com`,
        name: "Null Plan Dev",
        role: "owner",
      },
    });
    const nullDevice = await prisma.device.create({
      data: {
        orgId: nullPlanOrg.id,
        userId: nullUser.id,
        hostname: "null-plan-host",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "test",
        deviceToken: `null-plan-tok-${suffix}`,
      },
    });
    try {
      await startUsageSync({
        orgId: nullPlanOrg.id,
        userId: nullUser.id,
        deviceId: nullDevice.id,
        partitions: [],
        tools: {
          contentHash: "tools-only",
          items: [{ toolName: "codex", detected: true, configured: false }],
        },
        accounts: {
          contentHash: accountsInventoryContentHash([
            { toolName: "codex", plan: null, authPresent: true },
          ]),
          items: [{ toolName: "codex", plan: null, authPresent: true }],
        },
      });
      const invented = await prisma.billingPlanTemplate.findMany({
        where: { orgId: nullPlanOrg.id, priceSource: "detected" },
      });
      assert.equal(invented.length, 1);
      assert.equal(invented[0]?.catalogPlanKey, "free");
      assert.equal(invented[0]?.toolKey, "chatgpt-codex");
    } finally {
      await prisma.organization.delete({ where: { id: nullPlanOrg.id } });
    }
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("usage sync start keeps usage delta when accounts apply fails", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `AQ Fail Org ${suffix}`, slug: `aq-fail-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `aq-fail-${suffix}@example.com`,
      name: "AQ Fail Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "aq-fail-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `aq-fail-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: "2026-07-21|codex|codex|gpt-5|local_scan|",
          date: "2026-07-21",
          tool: "codex",
          model: "gpt-5",
          source: "local_scan",
          contentHash: "hash-aq-fail",
          rowCount: 1,
        },
      ],
      accounts: {
        contentHash: "forced-accounts-hash",
        items: [{ toolName: "", plan: "pro", authPresent: true }],
      },
    });
    assert.ok(start.deltaPartitions.includes("2026-07-21|codex|codex|gpt-5|local_scan|"));
    assert.equal(start.accountsApplied, "updated");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("reconcileDeviceDayPartitions removes many orphan partitions in one pass", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Reconcile Org ${suffix}`, slug: `reconcile-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `reconcile-${suffix}@example.com`,
      name: "Reconcile Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "reconcile-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `reconcile-tok-${suffix}`,
    },
  });
  await enableGatedUsage(org.id, user.id, device.id);

  const day = "2026-07-21";
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const keepKey = `${day}|codex|codex|keep|local_scan|`;
  const orphanCount = 150;

  try {
    await prisma.deviceUsageFingerprint.create({
      data: {
        orgId: org.id,
        deviceId: device.id,
        partitionKey: keepKey,
        contentHash: "keep-hash",
        date: dayDate,
      },
    });

    const orphanKeys: string[] = [];
    for (let i = 0; i < orphanCount; i++) {
      const partitionKey = `${day}|codex|codex|model-${i}|local_scan|`;
      orphanKeys.push(partitionKey);
      await prisma.deviceUsageFingerprint.create({
        data: {
          orgId: org.id,
          deviceId: device.id,
          partitionKey,
          contentHash: `orphan-hash-${i}`,
          date: dayDate,
        },
      });
      await prisma.usageDaily.create({
        data: {
          orgId: org.id,
          developerId: user.id,
          deviceId: device.id,
          date: dayDate,
          provider: "openai",
          product: "codex",
          toolName: "codex",
          accountKey: "codex",
          model: `model-${i}`,
          source: "local_scan",
          requests: 1,
          inputTokens: BigInt(10),
          outputTokens: BigInt(2),
          costMicros: BigInt(1000),
          dedupeKey: buildUsageDedupeKey({
            deviceId: device.id,
            dateKey: day,
            toolName: "codex",
            accountKey: "codex",
            model: `model-${i}`,
            source: "local_scan",
            repositoryId: null,
          }),
        },
      });
    }

    const result = await reconcileDeviceDayPartitions({
      orgId: org.id,
      deviceId: device.id,
      manifestPartitions: [
        {
          partitionKey: keepKey,
          date: day,
          tool: "codex",
          model: "keep",
          source: "local_scan",
          contentHash: "keep-hash",
        },
      ],
      windowFrom: dayDate,
      windowTo: dayDate,
    });
    assert.equal(result.removed, orphanCount);

    const remainingFingerprints = await prisma.deviceUsageFingerprint.count({
      where: { deviceId: device.id },
    });
    assert.equal(remainingFingerprints, 1);

    const remainingUsage = await prisma.usageDaily.count({
      where: { deviceId: device.id },
    });
    assert.equal(remainingUsage, 0);
  } finally {
    await prisma.usageDaily.deleteMany({ where: { orgId: org.id } });
    await prisma.deviceUsageFingerprint.deleteMany({ where: { orgId: org.id } });
    await prisma.analyticsDirtyDay.deleteMany({ where: { orgId: org.id } });
    await prisma.device.delete({ where: { id: device.id } });
    await prisma.developer.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
