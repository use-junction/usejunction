/**
 * Server-orchestrated usage sync sessions (UUS v1).
 * start → chunk* (facts) → commit + settle (projections).
 */
import { createHash } from "crypto";
import { prisma } from "@usejunction/db";
import { normalizeUusWireRecord, uusContentFingerprint, uusPartitionKey } from "@usejunction/usage-schema";
import { ingestLocalUsageBatch, type LocalUsageInputRow } from "@/lib/ingest/local-usage-batch";
import { filterGatedUsageToolNames } from "@/lib/privacy/account-collection";
import { keepUsageRow } from "@/lib/privacy/account-collection-policy";
import { invalidateAnalyticsCache } from "@/lib/analytics/query/invalidation";
import { markOrgUsageDaysDirty, ORG_DAY_SNAPSHOT_VERSION } from "@/lib/analytics/snapshots";
import { enqueueMaterializationJob, materializeOrgNow } from "@/lib/analytics/snapshots/jobs";
import { logServerError } from "@/lib/errors/public";
import {
  applyDeviceToolInventory,
  toolsInventoryContentHash,
  type ToolInventoryItem,
  type ToolsAppliedStatus,
} from "@/lib/sync/tools-inventory";
import {
  applyDeviceAccountInventory,
  accountsInventoryContentHash,
  type AccountInventoryItem,
  type SidecarAppliedStatus,
} from "@/lib/sync/accounts-inventory";
import {
  applyDeviceQuotaInventory,
  pruneQuotaToolsMissingWindows,
  recordQuotaObservations,
  quotasInventoryContentHash,
  type QuotaInventoryItem,
} from "@/lib/sync/quotas-inventory";
import { repairDetectedPlanCycles, syncDetectedPlansForDevice } from "@/lib/tools/sync-detected";
import { bulkUpsertDeviceUsageFingerprints } from "@/lib/sync/device-usage-fingerprints";
import {
  allowsLegacyCostFingerprint,
  usageFingerprintsEquivalent,
} from "@/lib/sync/usage-fingerprint";

/** Soft time budget for settle so daemon sync returns before serverless 60s cap. */
export const SYNC_SETTLE_BUDGET_MS = 12_000;

/**
 * Budget for settle deferred via next/server after() — nobody is waiting on the
 * HTTP response. Sized under Hobby Fluid maxDuration (300s) with headroom.
 */
export const SYNC_SETTLE_DEFERRED_BUDGET_MS = 240_000;

/**
 * Sync-pipeline settle: project dirty usage_daily days into org_usage_day_snapshots.
 * Chunks only mark dirty; commit (and empty-delta start) call this once.
 */
export async function settleSyncProjections(
  orgId: string,
  options: { maxDurationMs?: number; entryPoint?: "commit" | "empty_delta" | "poll" } = {},
): Promise<{ dirtyRemaining: number; materializeMs: number; claimed?: boolean }> {
  const materializeStart = performance.now();
  const result = await materializeOrgNow(orgId, {
    // Ingest/reconciliation explicitly marks every changed date dirty. Do not
    // manufacture today/yesterday work for an unchanged sync; cron owns the
    // rolling-day maintenance refresh.
    includeToday: false,
    maxDurationMs: options.maxDurationMs ?? SYNC_SETTLE_BUDGET_MS,
    entryPoint: options.entryPoint ?? "commit",
  });
  return {
    dirtyRemaining: result.dirtyRemaining,
    materializeMs: performance.now() - materializeStart,
    claimed: result.claimed,
  };
}
export type ManifestPartition = {
  partitionKey: string;
  date: string;
  tool: string;
  model: string;
  source: string;
  repository?: { host: string; owner: string; name: string } | null;
  contentHash: string;
  rowCount?: number;
};

function hashManifest(partitions: ManifestPartition[]): string {
  const payload = partitions
    .map((p) => `${p.partitionKey}:${p.contentHash}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export type DeferredUsageStartWork = {
  planSync?: {
    orgId: string;
    userId: string;
    deviceId: string;
    accountsReported: Array<{
      toolName: string;
      plan: string | null;
      email: string | null;
      authPresent?: boolean;
    }>;
  };
  emptyDeltaSettle?: {
    orgId: string;
    deviceId: string;
    manifestPartitions: ManifestPartition[];
    windowFrom: Date | null;
    windowTo: Date | null;
  };
};

async function runInventoryPlanSync(params: {
  orgId: string;
  userId: string;
  deviceId: string;
  accountsReported: Array<{
    toolName: string;
    plan: string | null;
    email: string | null;
    authPresent?: boolean;
  }>;
}): Promise<void> {
  try {
    let accounts = params.accountsReported;
    if (!accounts.length) {
      const rows = await prisma.toolAccount.findMany({
        where: { deviceId: params.deviceId },
        select: { toolName: true, plan: true, email: true, authPresent: true },
      });
      accounts = rows.map((row) => ({
        toolName: row.toolName,
        plan: row.plan,
        email: row.email,
        authPresent: row.authPresent,
      }));
    }
    if (accounts.length) {
      await syncDetectedPlansForDevice({
        orgId: params.orgId,
        developerId: params.userId,
        accounts,
      });
    }
    await repairDetectedPlanCycles(params.orgId);
  } catch (error) {
    logServerError("sync/usage/start-plan-sync", error, {
      orgId: params.orgId,
      deviceId: params.deviceId,
    });
  }
}

async function runEmptyDeltaSettle(params: {
  orgId: string;
  deviceId: string;
  manifestPartitions: ManifestPartition[];
  windowFrom: Date | null;
  windowTo: Date | null;
}): Promise<void> {
  await reconcileDeviceDayPartitions({
    orgId: params.orgId,
    deviceId: params.deviceId,
    manifestPartitions: params.manifestPartitions,
    windowFrom: params.windowFrom,
    windowTo: params.windowTo,
  });
  await settleSyncProjections(params.orgId, {
    maxDurationMs: SYNC_SETTLE_DEFERRED_BUDGET_MS,
    entryPoint: "empty_delta",
  });
}

/** Plan sync + empty-delta settle deferred from the ingest route via next/server after(). */
export async function runDeferredUsageStartWork(work: DeferredUsageStartWork): Promise<void> {
  if (work.planSync) await runInventoryPlanSync(work.planSync);
  if (work.emptyDeltaSettle) await runEmptyDeltaSettle(work.emptyDeltaSettle);
}

export type DeferredUsageCommitWork = {
  orgId: string;
  deviceId: string;
  syncRunId: string;
  reconcile?: {
    manifestPartitions: ManifestPartition[];
    windowFrom: Date | null;
    windowTo: Date | null;
  };
  settle: boolean;
};

/** Reconcile + settle deferred from the commit ingest route via next/server after(). */
export async function runDeferredUsageCommitWork(work: DeferredUsageCommitWork): Promise<void> {
  const reconcileStart = performance.now();
  let reconcileMs = 0;
  if (work.reconcile) {
    await reconcileDeviceDayPartitions({
      orgId: work.orgId,
      deviceId: work.deviceId,
      manifestPartitions: work.reconcile.manifestPartitions,
      windowFrom: work.reconcile.windowFrom,
      windowTo: work.reconcile.windowTo,
    });
    reconcileMs = performance.now() - reconcileStart;
  }
  let materializeMs = 0;
  let dirtyRemaining = 0;
  let claimed: boolean | undefined;
  if (work.settle) {
    try {
      const settled = await settleSyncProjections(work.orgId, {
        maxDurationMs: SYNC_SETTLE_DEFERRED_BUDGET_MS,
        entryPoint: "commit",
      });
      materializeMs = settled.materializeMs;
      dirtyRemaining = settled.dirtyRemaining;
      claimed = settled.claimed;
    } catch (error) {
      logServerError("sync/usage/commit-deferred-settle", error, {
        orgId: work.orgId,
        deviceId: work.deviceId,
        syncRunId: work.syncRunId,
      });
      dirtyRemaining = await prisma.analyticsDirtyDay.count({
        where: { orgId: work.orgId, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
      });
    }
  }
  console.info("[sync/usage/commit-deferred]", {
    orgId: work.orgId,
    deviceId: work.deviceId,
    syncRunId: work.syncRunId,
    reconcileMs,
    materializeMs,
    dirtyRemaining,
    claimed: claimed ?? null,
    settle: work.settle,
  });
}

export async function startUsageSync(params: {
  orgId: string;
  userId: string;
  deviceId: string;
  partitions: ManifestPartition[];
  tools?: { contentHash?: string; items?: ToolInventoryItem[] } | null;
  accounts?: { contentHash?: string; items?: AccountInventoryItem[] } | null;
  quotas?: { contentHash?: string; items?: QuotaInventoryItem[] } | null;
}, options: { deferHeavyWork?: boolean } = {}): Promise<{
  syncRunId: string;
  deltaPartitions: string[];
  expectedRows: number;
  status: string;
  toolsApplied: ToolsAppliedStatus;
  toolsWarning?: string;
  accountsApplied: SidecarAppliedStatus;
  accountsWarning?: string;
  quotasApplied: SidecarAppliedStatus;
  quotasWarning?: string;
  deferredWork?: DeferredUsageStartWork;
  timings: { inventoryMs: number; fingerprintMs: number };
}> {
  let toolsApplied: ToolsAppliedStatus = "skipped";
  let toolsWarning: string | undefined;
  let accountsApplied: SidecarAppliedStatus = "skipped";
  let accountsWarning: string | undefined;
  let quotasApplied: SidecarAppliedStatus = "skipped";
  let quotasWarning: string | undefined;
  let accountsReported: Array<{
    toolName: string;
    plan: string | null;
    email: string | null;
    authPresent?: boolean;
  }> = [];
  let inventoryChanged = false;
  const inventoryStart = performance.now();

  if (params.tools && Array.isArray(params.tools.items)) {
    const items = params.tools.items;
    const contentHash =
      typeof params.tools.contentHash === "string" && params.tools.contentHash.trim()
        ? params.tools.contentHash.trim()
        : toolsInventoryContentHash(items);

    try {
      const device = await prisma.device.findFirst({
        where: { id: params.deviceId, orgId: params.orgId },
        select: { toolsContentHash: true, lastToolsSyncAt: true },
      });
      if (device?.toolsContentHash && device.toolsContentHash === contentHash) {
        await prisma.device.update({
          where: { id: params.deviceId },
          data: { lastToolsSyncAt: new Date(), lastSeenAt: new Date() },
        });
        toolsApplied = "unchanged";
      } else {
        await applyDeviceToolInventory({
          orgId: params.orgId,
          userId: params.userId,
          deviceId: params.deviceId,
          items,
          contentHash,
        });
        toolsApplied = "updated";
        inventoryChanged = true;
      }
    } catch (error) {
      toolsApplied = "failed";
      toolsWarning = error instanceof Error ? error.message : "tools apply failed";
      logServerError("sync/usage/start-tools", error, {
        orgId: params.orgId,
        deviceId: params.deviceId,
      });
    }
  }

  if (params.accounts && Array.isArray(params.accounts.items)) {
    const items = params.accounts.items;
    const contentHash =
      typeof params.accounts.contentHash === "string" && params.accounts.contentHash.trim()
        ? params.accounts.contentHash.trim()
        : accountsInventoryContentHash(items);

    try {
      const device = await prisma.device.findFirst({
        where: { id: params.deviceId, orgId: params.orgId },
        select: { accountsContentHash: true },
      });
      if (device?.accountsContentHash && device.accountsContentHash === contentHash) {
        const now = new Date();
        await prisma.device.update({
          where: { id: params.deviceId },
          data: { lastAccountSyncAt: now, lastSeenAt: now },
        });
        accountsApplied = "unchanged";
        // Still surface tools for quota prune even when account hash is unchanged.
        accountsReported = items.map((item) => ({
          toolName: String(item.toolName ?? "").trim(),
          plan: typeof item.plan === "string" ? item.plan.trim() || null : null,
          email: typeof item.email === "string" ? item.email.trim() || null : null,
          authPresent: Boolean(item.authPresent),
        })).filter((item) => item.toolName);
      } else {
        const applied = await applyDeviceAccountInventory({
          orgId: params.orgId,
          userId: params.userId,
          deviceId: params.deviceId,
          items,
          contentHash,
          // Defer plan sync until quotas also land in this same start.
          runPlanSync: false,
        });
        accountsReported = applied.reported;
        accountsApplied = "updated";
        inventoryChanged = true;
      }
    } catch (error) {
      accountsApplied = "failed";
      accountsWarning = error instanceof Error ? error.message : "accounts apply failed";
      logServerError("sync/usage/start-accounts", error, {
        orgId: params.orgId,
        deviceId: params.deviceId,
      });
    }
  }

  if (params.quotas && Array.isArray(params.quotas.items)) {
    const items = params.quotas.items;
    const contentHash =
      typeof params.quotas.contentHash === "string" && params.quotas.contentHash.trim()
        ? params.quotas.contentHash.trim()
        : quotasInventoryContentHash(items);

    try {
      const allowedQuotaTools = await filterGatedUsageToolNames(
        params.deviceId,
        items.map((item) => String(item.toolName ?? "")),
      );
      const allowedItems = items.filter((item) => keepUsageRow(String(item.toolName ?? ""), allowedQuotaTools));
      const device = await prisma.device.findFirst({
        where: { id: params.deviceId, orgId: params.orgId },
        select: { quotasContentHash: true },
      });
      if (device?.quotasContentHash && device.quotasContentHash === contentHash) {
        quotasApplied = "unchanged";
        await recordQuotaObservations({ deviceId: params.deviceId, items: allowedItems });
        const now = new Date();
        await prisma.device.update({
          where: { id: params.deviceId },
          data: { lastQuotasSyncAt: now, lastSeenAt: now },
        });
      } else {
        await applyDeviceQuotaInventory({
          orgId: params.orgId,
          userId: params.userId,
          deviceId: params.deviceId,
          items: allowedItems,
          contentHash,
        });
        quotasApplied = "updated";
        inventoryChanged = true;
      }

      // Claude Desktop can report a plan with zero windows; clear stale OAuth snapshots.
      if (accountsReported.length > 0 && (quotasApplied === "updated" || quotasApplied === "unchanged")) {
        await pruneQuotaToolsMissingWindows({
          deviceId: params.deviceId,
          accountTools: accountsReported.map((row) => row.toolName),
          quotaTools: items.map((item) => String(item.toolName ?? "").trim()).filter(Boolean),
        });
      }
    } catch (error) {
      quotasApplied = "failed";
      quotasWarning = error instanceof Error ? error.message : "quotas apply failed";
      logServerError("sync/usage/start-quotas", error, {
        orgId: params.orgId,
        deviceId: params.deviceId,
      });
    }
  }

  const shouldPlanSync =
    inventoryChanged &&
    (accountsApplied === "updated" || quotasApplied === "updated" || accountsReported.length > 0);
  const deferredWork: DeferredUsageStartWork = {};
  const inventoryMs = performance.now() - inventoryStart;

  const partitions = params.partitions.filter((p) => p.partitionKey && p.date && p.contentHash);
  const keys = partitions.map((p) => p.partitionKey);
  const fingerprintStart = performance.now();
  const [existing, fingerprintDevice] = await Promise.all([
    keys.length
      ? prisma.deviceUsageFingerprint.findMany({
          where: { deviceId: params.deviceId, partitionKey: { in: keys } },
          select: { partitionKey: true, contentHash: true },
        })
      : Promise.resolve([]),
    prisma.device.findFirst({
      where: { id: params.deviceId, orgId: params.orgId },
      select: { agentVersion: true },
    }),
  ]);
  const fingerprintMs = performance.now() - fingerprintStart;
  const byKey = new Map(existing.map((row) => [row.partitionKey, row.contentHash]));
  const allowLegacyCost = allowsLegacyCostFingerprint(fingerprintDevice?.agentVersion);
  const delta = partitions.filter(
    (partition) =>
      !usageFingerprintsEquivalent(
        byKey.get(partition.partitionKey),
        partition.contentHash,
        allowLegacyCost,
      ),
  );
  const expectedRows = delta.reduce((sum, p) => sum + Math.max(1, p.rowCount ?? 1), 0);
  const dates = partitions.map((p) => p.date).sort();
  const windowFrom = dates[0] ? utcDate(dates[0]) : null;
  const windowTo = dates.length ? utcDate(dates[dates.length - 1]!) : null;

  // Close orphaned receiving runs so a new collect cannot leave the device stuck
  // on a prior partial session (e.g. missing-partition commit failures).
  await prisma.syncRun.updateMany({
    where: {
      orgId: params.orgId,
      deviceId: params.deviceId,
      status: "receiving",
    },
    data: {
      status: "superseded",
      error: "superseded by new sync run",
      updatedAt: new Date(),
    },
  });

  const run = await prisma.syncRun.create({
    data: {
      orgId: params.orgId,
      deviceId: params.deviceId,
      kind: "usage",
      status: delta.length ? "receiving" : "committed",
      expectedChunks: 0,
      receivedChunks: 0,
      expectedRows,
      receivedRows: 0,
      manifestHash: hashManifest(partitions),
      deltaPartitions: delta.map((p) => p.partitionKey),
      manifestPartitions: partitions.map((p) => p.partitionKey),
      windowFrom,
      windowTo,
      committedAt: delta.length ? null : new Date(),
    },
  });

  if (shouldPlanSync) {
    const planSync = {
      orgId: params.orgId,
      userId: params.userId,
      deviceId: params.deviceId,
      accountsReported,
    };
    if (options.deferHeavyWork) {
      deferredWork.planSync = planSync;
    } else {
      await runInventoryPlanSync(planSync);
    }
  }

  if (!delta.length) {
    await prisma.device.update({
      where: { id: params.deviceId },
      data: { lastUsageSyncAt: new Date(), lastSeenAt: new Date() },
    });
    const emptyDeltaSettle = {
      orgId: params.orgId,
      deviceId: params.deviceId,
      manifestPartitions: partitions,
      windowFrom,
      windowTo,
    };
    if (options.deferHeavyWork) {
      deferredWork.emptyDeltaSettle = emptyDeltaSettle;
    } else {
      await runEmptyDeltaSettle(emptyDeltaSettle);
    }
  }

  return {
    syncRunId: run.id,
    deltaPartitions: delta.map((p) => p.partitionKey),
    expectedRows,
    status: run.status,
    toolsApplied,
    ...(toolsWarning ? { toolsWarning } : {}),
    accountsApplied,
    ...(accountsWarning ? { accountsWarning } : {}),
    quotasApplied,
    ...(quotasWarning ? { quotasWarning } : {}),
    ...(options.deferHeavyWork && (deferredWork.planSync || deferredWork.emptyDeltaSettle)
      ? { deferredWork }
      : {}),
    timings: { inventoryMs, fingerprintMs },
  };
}

export async function ingestUsageSyncChunk(params: {
  orgId: string;
  userId: string;
  deviceId: string;
  syncRunId: string;
  chunkId: string;
  contentHash?: string;
  rows: LocalUsageInputRow[];
  observedAt?: Date;
}): Promise<{
  upserted: number;
  duplicate: boolean;
  receivedChunks: number;
  receivedRows: number;
  timings: { upsertMs: number; fingerprintsMs: number };
}> {
  const run = await prisma.syncRun.findFirst({
    where: { id: params.syncRunId, orgId: params.orgId, deviceId: params.deviceId },
  });
  if (!run) throw new Error("sync run not found");
  if (run.status === "committed" || run.status === "failed") {
    throw new Error(`sync run is ${run.status}`);
  }

  const existing = await prisma.syncChunk.findUnique({
    where: { syncRunId_chunkId: { syncRunId: params.syncRunId, chunkId: params.chunkId } },
  });
  if (existing) {
    return {
      upserted: 0,
      duplicate: true,
      receivedChunks: run.receivedChunks,
      receivedRows: run.receivedRows,
      timings: { upsertMs: 0, fingerprintsMs: 0 },
    };
  }

  const observedAt = params.observedAt ?? new Date();
  const allowedGatedTools = await filterGatedUsageToolNames(
    params.deviceId,
    params.rows.map((row) => String(row.toolName ?? "")),
  );
  const rows = params.rows.filter((row) => keepUsageRow(String(row.toolName ?? ""), allowedGatedTools));
  const upsertStart = performance.now();
  const { upserted, changedDates } = await ingestLocalUsageBatch({
    orgId: params.orgId,
    userId: params.userId,
    deviceId: params.deviceId,
    rows,
    observedAt,
    monotonicObservedAt: true,
  });
  const upsertMs = performance.now() - upsertStart;

  // Update fingerprints for uploaded rows (one bulk ON CONFLICT per batch).
  const fps: Array<{ partitionKey: string; contentHash: string; date: Date }> = [];
  for (const raw of rows) {
    const normalized = normalizeUusWireRecord(raw as Record<string, unknown>);
    if (!normalized) continue;
    const partitionKey = uusPartitionKey({
      date: normalized.date,
      tool: normalized.tool,
      model: normalized.model ?? "",
      source: normalized.source,
      repository: normalized.repository,
    });
    fps.push({
      partitionKey,
      contentHash: uusContentFingerprint(normalized),
      date: utcDate(normalized.date),
    });
  }
  const fingerprintsStart = performance.now();
  await bulkUpsertDeviceUsageFingerprints({
    orgId: params.orgId,
    deviceId: params.deviceId,
    rows: fps,
  });
  const fingerprintsMs = performance.now() - fingerprintsStart;

  // Facts only: mark dirty for days that actually changed + enqueue. Commit settles once.
  if (changedDates.length) {
    await invalidateAnalyticsCache(params.orgId, {
      dirtyDates: changedDates,
      rematerialize: false,
    });
  }

  await prisma.syncChunk.create({
    data: {
      syncRunId: params.syncRunId,
      deviceId: params.deviceId,
      chunkId: params.chunkId,
      rowCount: upserted,
      contentHash: params.contentHash ?? "",
    },
  });

  const updated = await prisma.syncRun.update({
    where: { id: params.syncRunId },
    data: {
      status: "receiving",
      receivedChunks: { increment: 1 },
      receivedRows: { increment: upserted },
    },
  });

  return {
    upserted,
    duplicate: false,
    receivedChunks: updated.receivedChunks,
    receivedRows: updated.receivedRows,
    timings: { upsertMs, fingerprintsMs },
  };
}

export async function commitUsageSync(
  params: {
    orgId: string;
    deviceId: string;
    syncRunId: string;
    expectedChunks?: number;
    /** Agent-side rows still queued after this session; skip heavy settle until 0. */
    remainingPartitions?: number;
  },
  options: { deferHeavyWork?: boolean } = {},
): Promise<{
  status: string;
  receivedChunks: number;
  receivedRows: number;
  missingPartitions: string[];
  dirtyRemaining: number;
  timings: { materializeMs: number; reconcileMs: number };
  deferredWork?: DeferredUsageCommitWork;
}> {
  const run = await prisma.syncRun.findFirst({
    where: { id: params.syncRunId, orgId: params.orgId, deviceId: params.deviceId },
  });
  if (!run) throw new Error("sync run not found");
  if (run.status === "committed") {
    const dirtyRemaining = await prisma.analyticsDirtyDay.count({
      where: { orgId: params.orgId, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    return {
      status: "committed",
      receivedChunks: run.receivedChunks,
      receivedRows: run.receivedRows,
      missingPartitions: [],
      dirtyRemaining,
      timings: { materializeMs: 0, reconcileMs: 0 },
    };
  }

  const delta = Array.isArray(run.deltaPartitions) ? (run.deltaPartitions as string[]) : [];
  const received = await prisma.deviceUsageFingerprint.findMany({
    where: { deviceId: params.deviceId, partitionKey: { in: delta } },
    select: { partitionKey: true },
  });
  const have = new Set(received.map((row) => row.partitionKey));
  const missingPartitions = delta.filter((key) => !have.has(key));

  if (typeof params.expectedChunks === "number" && params.expectedChunks > 0) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { expectedChunks: params.expectedChunks },
    });
  }

  if (missingPartitions.length) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "receiving", error: `missing ${missingPartitions.length} partitions` },
    });
    // Partial progress still landed in usage_daily — settle so the dashboard
    // improves immediately while the agent continues uploading.
    if (options.deferHeavyWork) {
      await enqueueMaterializationJob(params.orgId);
      const dirtyRemaining = await prisma.analyticsDirtyDay.count({
        where: { orgId: params.orgId, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
      });
      return {
        status: "receiving",
        receivedChunks: run.receivedChunks,
        receivedRows: run.receivedRows,
        missingPartitions,
        dirtyRemaining,
        timings: { materializeMs: 0, reconcileMs: 0 },
        deferredWork: {
          orgId: params.orgId,
          deviceId: params.deviceId,
          syncRunId: run.id,
          settle: true,
        },
      };
    }
    let dirtyRemaining = 0;
    let materializeMs = 0;
    try {
      const settled = await settleSyncProjections(params.orgId);
      dirtyRemaining = settled.dirtyRemaining;
      materializeMs = settled.materializeMs;
    } catch (error) {
      logServerError("sync/partial-commit-settle", error, { orgId: params.orgId, syncRunId: run.id });
      dirtyRemaining = await prisma.analyticsDirtyDay.count({
        where: { orgId: params.orgId, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
      });
    }
    return {
      status: "receiving",
      receivedChunks: run.receivedChunks,
      receivedRows: run.receivedRows,
      missingPartitions,
      dirtyRemaining,
      timings: { materializeMs, reconcileMs: 0 },
    };
  }

  const manifestKeys = Array.isArray(run.manifestPartitions) ? (run.manifestPartitions as string[]) : [];
  const manifestPartitions: ManifestPartition[] = manifestKeys.map((partitionKey) => {
    const [date = "", tool = "", model = "", source = "", ...repoParts] = partitionKey.split("|");
    const repoStr = repoParts.join("|");
    const repoBits = repoStr ? repoStr.split("/") : [];
    return {
      partitionKey,
      date,
      tool,
      model,
      source,
      repository:
        repoBits.length === 3
          ? { host: repoBits[0]!, owner: repoBits[1]!, name: repoBits[2]! }
          : null,
      contentHash: "",
    };
  });

  if (options.deferHeavyWork) {
    await prisma.device.update({
      where: { id: params.deviceId },
      data: { lastUsageSyncAt: new Date(), lastSeenAt: new Date() },
    });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "committed", committedAt: new Date(), error: null },
    });
    await enqueueMaterializationJob(params.orgId);
    const dirtyRemaining = await prisma.analyticsDirtyDay.count({
      where: { orgId: params.orgId, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
    });
    // Agent still has more partitions to upload — enqueue only; settle on the final pass.
    const moreUploadsPending =
      typeof params.remainingPartitions === "number" && params.remainingPartitions > 0;
    return {
      status: "committed",
      receivedChunks: run.receivedChunks,
      receivedRows: run.receivedRows,
      missingPartitions: [],
      dirtyRemaining,
      timings: { materializeMs: 0, reconcileMs: 0 },
      deferredWork: {
        orgId: params.orgId,
        deviceId: params.deviceId,
        syncRunId: run.id,
        reconcile: {
          manifestPartitions,
          windowFrom: run.windowFrom,
          windowTo: run.windowTo,
        },
        settle: !moreUploadsPending,
      },
    };
  }

  const reconcileStart = performance.now();
  await reconcileDeviceDayPartitions({
    orgId: params.orgId,
    deviceId: params.deviceId,
    manifestPartitions,
    windowFrom: run.windowFrom,
    windowTo: run.windowTo,
  });
  const reconcileMs = performance.now() - reconcileStart;

  await prisma.device.update({
    where: { id: params.deviceId },
    data: { lastUsageSyncAt: new Date(), lastSeenAt: new Date() },
  });

  await prisma.syncRun.update({
    where: { id: run.id },
    data: { status: "committed", committedAt: new Date(), error: null },
  });

  // Sync-pipeline settle: project dirty days before commit returns (time-budgeted).
  // dirtyRemaining === 0 means dashboard history is caught up; cron is fallback.
  const { dirtyRemaining, materializeMs } = await settleSyncProjections(params.orgId);

  return {
    status: "committed",
    receivedChunks: run.receivedChunks,
    receivedRows: run.receivedRows,
    missingPartitions: [],
    dirtyRemaining,
    timings: { materializeMs, reconcileMs },
  };
}

export async function getUsageSyncStatus(params: {
  orgId: string;
  deviceId: string;
  syncRunId: string;
}) {
  const run = await prisma.syncRun.findFirst({
    where: { id: params.syncRunId, orgId: params.orgId, deviceId: params.deviceId },
  });
  if (!run) return null;
  const dirtyRemaining = await prisma.analyticsDirtyDay.count({
    where: { orgId: params.orgId, metricVersion: ORG_DAY_SNAPSHOT_VERSION },
  });
  return {
    syncRunId: run.id,
    status: run.status,
    expectedChunks: run.expectedChunks,
    receivedChunks: run.receivedChunks,
    expectedRows: run.expectedRows,
    receivedRows: run.receivedRows,
    error: run.error,
    committedAt: run.committedAt?.toISOString() ?? null,
    dirtyRemaining,
    progress:
      run.expectedRows > 0 ? Math.min(1, run.receivedRows / run.expectedRows) : run.status === "committed" ? 1 : 0,
  };
}

/**
 * Tombstone / delete stored partitions for days in the window that are absent
 * from the authoritative lookback manifest.
 */
export async function reconcileDeviceDayPartitions(params: {
  orgId: string;
  deviceId: string;
  manifestPartitions: ManifestPartition[];
  windowFrom: Date | null;
  windowTo: Date | null;
}): Promise<{ removed: number }> {
  if (!params.windowFrom || !params.windowTo) return { removed: 0 };

  const manifestByDay = new Map<string, Set<string>>();
  for (const part of params.manifestPartitions) {
    const day = part.date.slice(0, 10);
    const set = manifestByDay.get(day) ?? new Set<string>();
    set.add(part.partitionKey);
    manifestByDay.set(day, set);
  }

  const stored = await prisma.deviceUsageFingerprint.findMany({
    where: {
      deviceId: params.deviceId,
      date: { gte: params.windowFrom, lte: params.windowTo },
    },
    select: { id: true, partitionKey: true, date: true },
  });

  const orphanKeys: string[] = [];
  const orphanDays = new Set<string>();
  for (const row of stored) {
    const day = row.date.toISOString().slice(0, 10);
    const allowed = manifestByDay.get(day);
    // Only reconcile days present in the manifest (agent scanned that day).
    if (!allowed) continue;
    if (!allowed.has(row.partitionKey)) {
      orphanKeys.push(row.partitionKey);
      orphanDays.add(day);
    }
  }

  if (!orphanKeys.length) return { removed: 0 };

  const orphanUsageDailyOr = orphanKeys.map((key) => {
    const [date = "", tool = "", model = "", source = "", ...repoParts] = key.split("|");
    void source;
    void repoParts;
    return {
      date: utcDate(date),
      toolName: tool,
      model,
      dedupeKey: {
        contains: `:${date}:${tool}:${model}:`,
      },
    };
  });

  try {
    await prisma.usageDaily.deleteMany({
      where: {
        deviceId: params.deviceId,
        OR: orphanUsageDailyOr,
      },
    });
    await prisma.deviceUsageFingerprint.deleteMany({
      where: { deviceId: params.deviceId, partitionKey: { in: orphanKeys } },
    });

    if (orphanDays.size) {
      await markOrgUsageDaysDirty(params.orgId, [...orphanDays].map((d) => utcDate(d)));
    }
  } catch (error) {
    logServerError("sync/reconcile_partitions", error, {
      orgId: params.orgId,
      deviceId: params.deviceId,
      orphanCount: orphanKeys.length,
    });
  }

  return { removed: orphanKeys.length };
}
