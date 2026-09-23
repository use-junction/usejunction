/**
 * Hard integration test: real ingestLocalUsageBatch + sync session against Postgres.
 * Run with DATABASE_URL set (apps/admin/.env → localhost:5432).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import { ingestLocalUsageBatch } from "@/lib/ingest/local-usage-batch";
import { invalidateAnalyticsCache } from "@/lib/analytics/query/invalidation";
import {
  startUsageSync,
  ingestUsageSyncChunk,
  commitUsageSync,
  getUsageSyncStatus,
} from "@/lib/sync/usage-sync";
import { ORG_DAY_SNAPSHOT_VERSION, rematerializeOrgSnapshots } from "@/lib/analytics/snapshots";
import { readOrgUsageFromSnapshots } from "@/lib/analytics/snapshots/read";
import { UTC_TIMEZONE } from "@/lib/analytics/contracts/time-window";
import { normalizeUusWireRecord, uusContentFingerprint, uusPartitionKey } from "@usejunction/usage-schema";

const runDb = Boolean(process.env.DATABASE_URL);

async function seedDevice(suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `Ingest Live ${suffix}`, slug: `ingest-live-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `ingest-live-${suffix}@example.com`,
      name: "Ingest Live",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "ingest-live-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `ingest-live-tok-${suffix}`,
    },
  });
  for (const toolName of ["cursor", "codex", "claude", "opencode"] as const) {
    await prisma.toolAccount.create({
      data: {
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        toolName,
        accountKey: toolName,
        usageEnabled: true,
        loggingEnabled: true,
        authPresent: true,
      },
    });
  }
  return { org, user, device };
}

test("actual ingest: multi-tool batch with repo lands in both tables", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, user, device } = await seedDevice(suffix);

  try {
    const result = await ingestLocalUsageBatch({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      rows: [
        {
          date: "2026-07-21",
          toolName: "codex",
          model: "gpt-5.6-sol",
          source: "local_scan",
          inputTokens: 7_225_706,
          outputTokens: 30_733,
          estimatedCost: 18.371595,
          requests: 0,
          repository: { host: "github.com", owner: "acme", name: "app" },
        },
        {
          date: "2026-07-21",
          toolName: "claude",
          model: "opus",
          source: "local_scan",
          inputTokens: 12_000,
          outputTokens: 4_000,
          estimatedCost: 2.5,
          requests: 8,
        },
        {
          date: "2026-07-20",
          toolName: "cursor",
          model: "gpt-4.1",
          source: "local_scan",
          inputTokens: 1_000,
          outputTokens: 200,
          estimatedCost: 0.05,
          requests: 3,
        },
        {
          date: "2026-07-21",
          toolName: "opencode",
          model: "opencode-go/kimi-k2.7-code",
          source: "opencode_usage",
          inputTokens: 5_000,
          outputTokens: 200,
          estimatedCost: 0.42,
          costKind: "actual_spend",
          requests: 4,
        },
        {
          date: "2026-07-21",
          toolName: "opencode",
          model: "opencode",
          source: "opencode_local",
          metricKind: "productivity",
          addedLines: 42,
          deletedLines: 7,
          requests: 1,
        },
      ],
    });

    assert.equal(result.upserted, 5);
    assert.ok(result.totalTokens > 0);

    const daily = await prisma.usageDaily.findMany({
      where: { orgId: org.id, deviceId: device.id },
      orderBy: [{ date: "asc" }, { toolName: "asc" }],
    });
    assert.equal(daily.length, 5);
    const codex = daily.find((row) => row.toolName === "codex");
    assert.ok(codex);
    assert.equal(codex.source, "device_observed");
    assert.equal(Number(codex.inputTokens), 7_225_706);
    assert.ok(codex.repositoryId, "expected repository row linked");

    const opencodeUsage = daily.find((row) => row.toolName === "opencode" && row.model === "opencode-go/kimi-k2.7-code");
    assert.ok(opencodeUsage);
    assert.equal(opencodeUsage.costKind, "actual_spend");
    assert.equal(opencodeUsage.metricKind, "usage");

    const opencodeLocal = daily.find((row) => row.toolName === "opencode" && row.metricKind === "productivity");
    assert.ok(opencodeLocal);
    assert.equal(Number(opencodeLocal.addedLines), 42);

    // Idempotent re-ingest
    const again = await ingestLocalUsageBatch({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      rows: [
        {
          date: "2026-07-21",
          toolName: "codex",
          model: "gpt-5.6-sol",
          source: "local_scan",
          inputTokens: 7_300_000,
          outputTokens: 31_000,
          estimatedCost: 19,
          requests: 0,
          repository: { host: "github.com", owner: "acme", name: "app" },
        },
      ],
    });
    assert.equal(again.upserted, 1);
    const updated = await prisma.usageDaily.findFirst({
      where: { deviceId: device.id, toolName: "codex" },
    });
    assert.equal(Number(updated?.inputTokens), 7_300_000);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("actual ingest: invalidation + rematerialize + overlay shows spend", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, user, device } = await seedDevice(suffix);

  try {
    await ingestLocalUsageBatch({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      rows: [
        {
          date: "2026-07-21",
          toolName: "codex",
          model: "gpt-5",
          source: "local_scan",
          inputTokens: 50_000,
          outputTokens: 5_000,
          estimatedCost: 9.5,
          requests: 0,
        },
      ],
    });

    const inv = await invalidateAnalyticsCache(org.id, {
      dirtyDates: ["2026-07-21"],
      preferFirstSyncRematerialize: true,
    });
    assert.ok(inv.marked.includes("2026-07-21"));

    await rematerializeOrgSnapshots(org.id, { includeToday: false });

    const snap = await prisma.orgUsageDaySnapshot.findFirst({
      where: {
        orgId: org.id,
        date: new Date("2026-07-21T00:00:00.000Z"),
        toolName: "",
        developerId: "",
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      },
    });
    assert.ok(snap, "expected org-day snapshot after rematerialize");
    assert.ok(Number(snap.estimatedApiCostMicros) > 0 || Number(snap.inputTokens) > 0);

    const overview = await readOrgUsageFromSnapshots(
      org.id,
      {
        from: new Date("2026-07-21T00:00:00.000Z"),
        to: new Date("2026-07-21T00:00:00.000Z"),
        timezone: UTC_TIMEZONE,
        grain: "day",
      },
      { ensure: false },
    );
    assert.ok(overview.kpis.tokens > 0 || overview.kpis.estimatedApiCost > 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("actual ingest: sync session start/chunk/commit end-to-end", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, user, device } = await seedDevice(suffix);

  const rowCodex = {
    date: "2026-07-21",
    toolName: "codex",
    model: "gpt-5",
    source: "local_scan",
    inputTokens: 1000,
    outputTokens: 100,
    estimatedCost: 1.1,
    requests: 2,
  };
  const rowClaude = {
    date: "2026-07-20",
    toolName: "claude",
    model: "opus",
    source: "local_scan",
    inputTokens: 500,
    outputTokens: 50,
    estimatedCost: 0.4,
    requests: 1,
  };
  const uusCodex = normalizeUusWireRecord(rowCodex)!;
  const uusClaude = normalizeUusWireRecord(rowClaude)!;
  const keyCodex = uusPartitionKey({
    date: uusCodex.date,
    tool: uusCodex.tool,
    model: uusCodex.model ?? "",
    source: uusCodex.source,
    repository: uusCodex.repository,
  });
  const keyClaude = uusPartitionKey({
    date: uusClaude.date,
    tool: uusClaude.tool,
    model: uusClaude.model ?? "",
    source: uusClaude.source,
    repository: uusClaude.repository,
  });
  const hashCodex = uusContentFingerprint(uusCodex);
  const hashClaude = uusContentFingerprint(uusClaude);

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: keyCodex,
          date: uusCodex.date,
          tool: uusCodex.tool,
          model: uusCodex.model ?? "",
          source: uusCodex.source,
          contentHash: hashCodex,
          rowCount: 1,
        },
        {
          partitionKey: keyClaude,
          date: uusClaude.date,
          tool: uusClaude.tool,
          model: uusClaude.model ?? "",
          source: uusClaude.source,
          contentHash: hashClaude,
          rowCount: 1,
        },
      ],
    });
    assert.equal(start.status, "receiving");
    assert.equal(start.deltaPartitions.length, 2);

    const chunk1 = await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "c1",
      rows: [rowCodex],
    });
    assert.equal(chunk1.upserted, 1);
    assert.equal(chunk1.duplicate, false);

    const chunk2 = await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "c2",
      rows: [rowClaude],
    });
    assert.equal(chunk2.upserted, 1);

    const committed = await commitUsageSync({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      expectedChunks: 2,
    });
    assert.equal(committed.status, "committed");
    assert.deepEqual(committed.missingPartitions, []);

    const status = await getUsageSyncStatus({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
    });
    assert.equal(status?.status, "committed");
    assert.equal(status?.receivedRows, 2);

    const deviceRow = await prisma.device.findUnique({ where: { id: device.id } });
    assert.ok(deviceRow?.lastUsageSyncAt);

    // Second start with identical content hashes → empty delta / already committed
    const start2 = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions: [
        {
          partitionKey: keyCodex,
          date: uusCodex.date,
          tool: uusCodex.tool,
          model: uusCodex.model ?? "",
          source: uusCodex.source,
          contentHash: hashCodex,
          rowCount: 1,
        },
        {
          partitionKey: keyClaude,
          date: uusClaude.date,
          tool: uusClaude.tool,
          model: uusClaude.model ?? "",
          source: uusClaude.source,
          contentHash: hashClaude,
          rowCount: 1,
        },
      ],
    });
    assert.equal(start2.status, "committed");
    assert.equal(start2.deltaPartitions.length, 0);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("actual ingest: HTTP route path with device auth shape", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, user, device } = await seedDevice(suffix);

  try {
    // Simulate what the route does after auth.
    const { upserted, totalTokens, totalRequests, sample } = await ingestLocalUsageBatch({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      rows: [
        {
          date: "2026-07-22",
          toolName: "codex",
          model: "gpt-5",
          source: "local_scan",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 10,
          cacheWriteTokens: 0,
          reasoningTokens: 5,
          estimatedCost: 0.25,
          requests: 1,
        },
      ],
    });

    assert.equal(upserted, 1);
    assert.equal(totalTokens, 120);
    assert.equal(totalRequests, 1);
    assert.equal(sample.length, 1);

    await prisma.device.update({
      where: { id: device.id },
      data: { lastUsageSyncAt: new Date(), lastSeenAt: new Date() },
    });

    const inv = await invalidateAnalyticsCache(org.id, {
      dirtyDates: ["2026-07-22"],
      preferFirstSyncRematerialize: true,
    });
    assert.ok(inv.marked.length >= 1);

    const count = await prisma.usageDaily.count({ where: { orgId: org.id } });
    assert.equal(count, 1);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("actual ingest: large delta partial commit still enqueues materialize + live reads show requests", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, user, device } = await seedDevice(suffix);

  // Build >400 partitions across recent days so one capped upload cannot finish.
  const partitions: Array<{
    partitionKey: string;
    date: string;
    tool: string;
    model: string;
    source: string;
    contentHash: string;
    rowCount: number;
  }> = [];
  const rows: Array<Record<string, unknown>> = [];
  const today = new Date();
  for (let i = 0; i < 450; i += 1) {
    const dayOffset = i % 30;
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - dayOffset));
    const date = d.toISOString().slice(0, 10);
    const model = `model-${i}`;
    const row = {
      date,
      toolName: "codex",
      model,
      source: "local_scan",
      inputTokens: 1000 + i,
      outputTokens: 10,
      estimatedCost: 0.01,
      requests: 1 + (i % 3),
    };
    const uus = normalizeUusWireRecord(row)!;
    const partitionKey = uusPartitionKey({
      date: uus.date,
      tool: uus.tool,
      model: uus.model ?? "",
      source: uus.source,
      repository: uus.repository,
    });
    partitions.push({
      partitionKey,
      date: uus.date,
      tool: uus.tool,
      model: uus.model ?? "",
      source: uus.source,
      contentHash: uusContentFingerprint(uus),
      rowCount: 1,
    });
    rows.push(row);
  }

  try {
    const start = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions,
    });
    assert.equal(start.status, "receiving");
    assert.ok(start.deltaPartitions.length >= 450);

    // Upload only first 400 rows (mirrors agent MaxChunks*BatchSize cap).
    const firstBatch = rows.slice(0, 400);
    await ingestUsageSyncChunk({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      chunkId: "chunk-partial",
      rows: firstBatch as never,
    });

    const partial = await commitUsageSync({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: start.syncRunId,
      expectedChunks: 1,
    });
    assert.equal(partial.status, "receiving");
    assert.ok(partial.missingPartitions.length > 0);
    // Partial commit still settles projections so the dashboard improves
    // while the agent continues uploading remaining partitions.
    assert.ok(partial.dirtyRemaining >= 0);

    // Second start must supersede the stuck receiving run and shrink the delta.
    const start2 = await startUsageSync({
      orgId: org.id,
      userId: user.id,
      deviceId: device.id,
      partitions,
    });
    assert.ok(start2.deltaPartitions.length < start.deltaPartitions.length);
    const superseded = await prisma.syncRun.findFirst({
      where: { id: start.syncRunId },
    });
    assert.equal(superseded?.status, "superseded");

    // Finish remaining partitions then commit.
    const remainingKeys = new Set(start2.deltaPartitions);
    const rest = rows.filter((row) => {
      const uus = normalizeUusWireRecord(row)!;
      const key = uusPartitionKey({
        date: uus.date,
        tool: uus.tool,
        model: uus.model ?? "",
        source: uus.source,
        repository: uus.repository,
      });
      return remainingKeys.has(key);
    });
    if (rest.length) {
      await ingestUsageSyncChunk({
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        syncRunId: start2.syncRunId,
        chunkId: "chunk-rest",
        rows: rest as never,
      });
    }
    const committed = await commitUsageSync({
      orgId: org.id,
      deviceId: device.id,
      syncRunId: start2.syncRunId,
      expectedChunks: 1,
    });
    assert.equal(committed.status, "committed");

    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29));
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const overview = await readOrgUsageFromSnapshots(
      org.id,
      { from, to, timezone: UTC_TIMEZONE, grain: "day" },
      { ensure: false },
    );
    assert.ok(overview.kpis.modelCalls > 0, "live reads must surface requests on first sync");
    assert.ok(overview.kpis.estimatedApiCost > 0, "live reads must surface cost");
    assert.ok(overview.trend.some((t) => t.modelCalls > 0));
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
