import { randomUUID } from "crypto";
import * as Ably from "ably";
import { Prisma, prisma } from "@usejunction/db";
import type { AppPrincipal } from "@/lib/api/app-auth";
import { activeDeviceWhere } from "@/lib/devices/decommission";
import {
  DEVICE_STALE_AFTER_MS,
  deviceHealthState,
  isRepairRequired,
  outageKey,
} from "@/lib/devices/health";
import { isDeviceActivelyReporting } from "@/lib/devices/presence";
import { sendDeviceRecoveryEmail } from "@/lib/email/device-recovery";
import {
  UndeliverableEmailRecipientError,
  isUndeliverableEmailRecipient,
} from "@/lib/email/recipient";
import { notifyServerIssue } from "@/lib/notifications/slack";
import { hasCapability } from "@/lib/rbac/permissions";
import { REMOTE_SYNC_PROTOCOL } from "@/lib/sync/protocol";
import {
  resolveLinkedDeveloper,
  type SyncRequestScope,
} from "@/lib/sync/remote-sync-context";

export type { SyncRequestScope } from "@/lib/sync/remote-sync-context";
export type DeviceSyncTargetStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "expired";

const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_WINDOW_MS = 30 * 1000;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECOVERY_EMAIL_ATTEMPTS = 5;
const TERMINAL_RECOVERY_NOTICE_STATUSES = new Set(["sent", "skipped"]);

type SyncRequestWithTargets = Prisma.SyncRequestGetPayload<{
  include: {
    targets: {
      include: {
        device: {
          select: {
            id: true;
            hostname: true;
            os: true;
            architecture: true;
            agentVersion: true;
            remoteSyncProtocol: true;
            lastSeenAt: true;
            user: { select: { id: true; name: true; email: true } };
          };
        };
      };
    };
  };
}>;

export type DeviceHealthReconcileResult = {
  scanned: number;
  stale: number;
  autoRequestsCreated: number;
  repairRequired: number;
  noticesSent: number;
  noticesFailed: number;
};

export type SyncRequestView = ReturnType<typeof serializeSyncRequest>;

function channelForScope(scope: SyncRequestScope, orgId: string, developerId: string | null) {
  if (scope === "you") {
    if (!developerId) throw new Error("developerId is required for personal sync");
    return `device-sync:developer:${developerId}`;
  }
  return `device-sync:org:${orgId}`;
}

function statusCounts(targets: Array<{ status: string }>) {
  const counts = {
    queued: 0,
    claimed: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    expired: 0,
  };
  for (const target of targets) {
    if (target.status in counts) counts[target.status as DeviceSyncTargetStatus] += 1;
  }
  return counts;
}

function sanitizeWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => item.slice(0, 500));
}

function serializeSyncRequest(request: SyncRequestWithTargets) {
  const counts = statusCounts(request.targets);
  const total = request.targets.length;
  const active = request.targets.filter((target) => target.status === "claimed" || target.status === "running").length;
  const done = counts.succeeded + counts.failed + counts.expired;
  return {
    id: request.id,
    scope: request.scope as SyncRequestScope,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    dispatchStatus: request.dispatchStatus,
    dispatchError: request.dispatchError,
    realtimeChannel: request.realtimeChannel,
    publishedAt: request.publishedAt?.toISOString() ?? null,
    totals: {
      total,
      waiting: counts.queued,
      accepted: counts.claimed,
      running: counts.running,
      active,
      succeeded: counts.succeeded,
      failed: counts.failed,
      expired: counts.expired,
      done,
      pending: Math.max(0, total - done),
    },
    targets: request.targets
      .slice()
      .sort((a, b) => a.device.hostname.localeCompare(b.device.hostname))
      .map((target) => ({
        id: target.id,
        deviceId: target.deviceId,
        status: target.status as DeviceSyncTargetStatus,
        attemptCount: target.attemptCount,
        claimedAt: target.claimedAt?.toISOString() ?? null,
        runningAt: target.runningAt?.toISOString() ?? null,
        completedAt: target.completedAt?.toISOString() ?? null,
        tools: target.toolsCount ?? null,
        accounts: target.accountsCount ?? null,
        quotas: target.quotasCount ?? null,
        usageRows: target.usageRowsCount ?? null,
        warnings: sanitizeWarnings(target.warnings),
        errorMessage: target.errorMessage?.slice(0, 500) ?? null,
        device: {
          id: target.device.id,
          hostname: target.device.hostname,
          os: target.device.os,
          architecture: target.device.architecture,
          agentVersion: target.device.agentVersion,
          remoteSyncProtocol: target.device.remoteSyncProtocol,
          online: isDeviceActivelyReporting(target.device.lastSeenAt),
          developer: target.device.user,
        },
      })),
  };
}

async function loadRequestForView(requestId: string): Promise<SyncRequestWithTargets | null> {
  return prisma.syncRequest.findUnique({
    where: { id: requestId },
    include: {
      targets: {
        include: {
          device: {
            select: {
              id: true,
              hostname: true,
              os: true,
              architecture: true,
              agentVersion: true,
              remoteSyncProtocol: true,
              lastSeenAt: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });
}

export async function expireSyncTargets(now = new Date()) {
  await prisma.deviceSyncRequestTarget.updateMany({
    where: {
      status: { in: ["queued", "claimed", "running"] },
      syncRequest: { expiresAt: { lt: now } },
    },
    data: {
      status: "expired",
      completedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

export async function pruneSyncRequests(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  await prisma.syncRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

async function publishWake(request: { id: string; orgId: string; scope: string; developerId: string | null; realtimeChannel: string | null }) {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) {
    return { ok: false as const, status: "degraded", error: "ABLY_API_KEY is not configured" };
  }
  const channel = request.realtimeChannel ?? channelForScope(request.scope as SyncRequestScope, request.orgId, request.developerId);
  const rest = new Ably.Rest(key);
  await rest.channels.get(channel).publish("sync-request", { requestId: request.id });
  return { ok: true as const, status: "published", channel };
}

async function createAutomaticDeviceSyncRequest(device: {
  id: string;
  orgId: string;
  userId: string;
  lastSeenAt: Date;
}, now: Date) {
  const automationKey = outageKey(device.id, device.lastSeenAt);
  const existing = await prisma.syncRequest.findUnique({
    where: { automationKey },
    select: { id: true },
  });
  if (existing) return false;

  const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
  let request: { id: string };
  try {
    request = await prisma.$transaction(async (tx) => {
      const created = await tx.syncRequest.create({
        data: {
          orgId: device.orgId,
          requesterUserId: null,
          scope: "you",
          trigger: "stale_auto",
          automationKey,
          developerId: device.userId,
          realtimeChannel: channelForScope("you", device.orgId, device.userId),
          dispatchStatus: "pending",
          expiresAt,
          targets: {
            create: {
              orgId: device.orgId,
              deviceId: device.id,
              status: "queued",
            },
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          orgId: device.orgId,
          actorType: "system",
          actorId: null,
          action: "sync_request.stale_auto",
          targetType: "sync_request",
          targetId: created.id,
          metadata: {
            deviceId: device.id,
            automationKey,
            lastSeenAt: device.lastSeenAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return created;
    });
  } catch (error) {
    // A concurrent cron/page fallback may win the unique outage key race.
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return false;
    throw error;
  }

  try {
    const dispatch = await publishWake({
      id: request.id,
      orgId: device.orgId,
      scope: "you",
      developerId: device.userId,
      realtimeChannel: `device-sync:developer:${device.userId}`,
    });
    await prisma.syncRequest.update({
      where: { id: request.id },
      data: dispatch.ok
        ? { dispatchStatus: "published", publishedAt: new Date(), dispatchError: null }
        : { dispatchStatus: dispatch.status, dispatchError: dispatch.error },
    });
    if (!dispatch.ok) {
      notifyServerIssue({
        severity: "warning",
        scope: "device-health/ably",
        error: dispatch.error,
        details: { requestId: request.id, deviceId: device.id },
      });
    }
  } catch (error) {
    await prisma.syncRequest.update({
      where: { id: request.id },
      data: {
        dispatchStatus: "degraded",
        dispatchError: (error instanceof Error ? error.message : "Ably publish failed").slice(0, 2000),
      },
    });
    notifyServerIssue({
      severity: "warning",
      scope: "device-health/ably",
      error,
      details: { requestId: request.id, deviceId: device.id },
    });
  }
  return true;
}

export type FeaturesGitHubAuthorSyncResult = {
  skipped: boolean;
  reason?: string;
  developers: number;
  devices: number;
  requestsCreated: number;
};

/**
 * Queues a durable remote usage sync for each mapped GitHub author's devices
 * and publishes an Ably wake on that developer's channel. Deduped by the
 * caller-supplied automation key (Features uses a 15-minute bucket).
 */
export async function createFeaturesGitHubAuthorSyncRequest(input: {
  orgId: string;
  developerIds: string[];
  now: Date;
  automationKeyFor: (developerId: string) => string;
}): Promise<FeaturesGitHubAuthorSyncResult> {
  if (input.developerIds.length === 0) {
    return { skipped: true, reason: "no_mapped_authors", developers: 0, devices: 0, requestsCreated: 0 };
  }

  const devices = await prisma.device.findMany({
    where: {
      orgId: input.orgId,
      ...activeDeviceWhere,
      userId: { in: input.developerIds },
      remoteSyncProtocol: { gte: REMOTE_SYNC_PROTOCOL },
    },
    select: { id: true, userId: true },
  });
  if (devices.length === 0) {
    return {
      skipped: true,
      reason: "no_remote_capable_devices",
      developers: input.developerIds.length,
      devices: 0,
      requestsCreated: 0,
    };
  }

  const devicesByDeveloper = new Map<string, string[]>();
  for (const device of devices) {
    const current = devicesByDeveloper.get(device.userId) ?? [];
    current.push(device.id);
    devicesByDeveloper.set(device.userId, current);
  }

  let requestsCreated = 0;
  for (const [developerId, deviceIds] of devicesByDeveloper) {
    if (await createFeaturesAuthorDeviceSyncRequest({
      orgId: input.orgId,
      developerId,
      deviceIds,
      automationKey: input.automationKeyFor(developerId),
      now: input.now,
    })) {
      requestsCreated += 1;
    }
  }

  return {
    skipped: requestsCreated === 0,
    reason: requestsCreated === 0 ? "already_queued" : undefined,
    developers: devicesByDeveloper.size,
    devices: devices.length,
    requestsCreated,
  };
}

async function createFeaturesAuthorDeviceSyncRequest(input: {
  orgId: string;
  developerId: string;
  deviceIds: string[];
  automationKey: string;
  now: Date;
}) {
  const existing = await prisma.syncRequest.findUnique({
    where: { automationKey: input.automationKey },
    select: { id: true },
  });
  if (existing) return false;

  const expiresAt = new Date(input.now.getTime() + REQUEST_TTL_MS);
  let request: { id: string };
  try {
    request = await prisma.$transaction(async (tx) => {
      const created = await tx.syncRequest.create({
        data: {
          orgId: input.orgId,
          requesterUserId: null,
          scope: "you",
          trigger: "features_github",
          automationKey: input.automationKey,
          developerId: input.developerId,
          realtimeChannel: channelForScope("you", input.orgId, input.developerId),
          dispatchStatus: "pending",
          expiresAt,
          targets: {
            createMany: {
              data: input.deviceIds.map((deviceId) => ({
                orgId: input.orgId,
                deviceId,
                status: "queued",
              })),
            },
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          orgId: input.orgId,
          actorType: "system",
          actorId: null,
          action: "sync_request.features_github",
          targetType: "sync_request",
          targetId: created.id,
          metadata: {
            developerId: input.developerId,
            automationKey: input.automationKey,
            deviceIds: input.deviceIds,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return created;
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return false;
    throw error;
  }

  try {
    const dispatch = await publishWake({
      id: request.id,
      orgId: input.orgId,
      scope: "you",
      developerId: input.developerId,
      realtimeChannel: `device-sync:developer:${input.developerId}`,
    });
    await prisma.syncRequest.update({
      where: { id: request.id },
      data: dispatch.ok
        ? { dispatchStatus: "published", publishedAt: new Date(), dispatchError: null }
        : { dispatchStatus: dispatch.status, dispatchError: dispatch.error },
    });
    if (!dispatch.ok) {
      notifyServerIssue({
        severity: "warning",
        scope: "features-github/ably",
        error: dispatch.error,
        details: { requestId: request.id, developerId: input.developerId },
      });
    }
  } catch (error) {
    await prisma.syncRequest.update({
      where: { id: request.id },
      data: {
        dispatchStatus: "degraded",
        dispatchError: (error instanceof Error ? error.message : "Ably publish failed").slice(0, 2000),
      },
    });
    notifyServerIssue({
      severity: "warning",
      scope: "features-github/ably",
      error,
      details: { requestId: request.id, developerId: input.developerId },
    });
  }
  return true;
}

/**
 * Reconciles liveness without requiring a signed-in browser. Page visits call
 * this with notifications disabled as a fast fallback; the cron enables the
 * one-per-outage recovery email.
 */
export async function reconcileDeviceHealth(input: {
  orgId: string;
  developerId?: string;
  now?: Date;
  sendNotifications?: boolean;
}): Promise<DeviceHealthReconcileResult> {
  const now = input.now ?? new Date();
  const devices = await prisma.device.findMany({
    where: {
      orgId: input.orgId,
      ...activeDeviceWhere,
      ...(input.developerId ? { userId: input.developerId } : {}),
      lastSeenAt: { lt: new Date(now.getTime() - DEVICE_STALE_AFTER_MS) },
    },
    select: {
      id: true,
      orgId: true,
      userId: true,
      hostname: true,
      os: true,
      architecture: true,
      agentVersion: true,
      lastSeenAt: true,
      remoteSyncProtocol: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { lastSeenAt: "asc" },
  });

  let autoRequestsCreated = 0;
  let noticesSent = 0;
  let noticesFailed = 0;
  for (const device of devices) {
    await prisma.deviceRecoveryNotice.updateMany({
      where: {
        deviceId: device.id,
        recoveredAt: null,
        lastSeenAtSnapshot: { lt: device.lastSeenAt },
      },
      data: { recoveredAt: now, status: "recovered" },
    });

    const state = deviceHealthState(device.lastSeenAt, now);
    if (state === "auto_recovery" && device.remoteSyncProtocol >= REMOTE_SYNC_PROTOCOL) {
      if (await createAutomaticDeviceSyncRequest(device, now)) autoRequestsCreated += 1;
    }

    if (state !== "repair_required" || !input.sendNotifications) continue;
    const notice = await prisma.deviceRecoveryNotice.upsert({
      where: {
        deviceId_lastSeenAtSnapshot: {
          deviceId: device.id,
          lastSeenAtSnapshot: device.lastSeenAt,
        },
      },
      create: {
        orgId: device.orgId,
        deviceId: device.id,
        lastSeenAtSnapshot: device.lastSeenAt,
        status: "pending",
      },
      update: {},
      select: { id: true, status: true, attemptCount: true },
    });
    if (TERMINAL_RECOVERY_NOTICE_STATUSES.has(notice.status)) continue;

    if (isUndeliverableEmailRecipient(device.user.email)) {
      await prisma.deviceRecoveryNotice.update({
        where: { id: notice.id },
        data: {
          status: "skipped",
          lastError: "undeliverable recipient",
        },
      });
      continue;
    }

    await prisma.deviceRecoveryNotice.update({
      where: { id: notice.id },
      data: { status: "sending", attemptCount: { increment: 1 } },
    });
    const attemptCount = notice.attemptCount + 1;
    try {
      await sendDeviceRecoveryEmail({
        to: device.user.email,
        recipientName: device.user.name,
        hostname: device.hostname,
        os: device.os,
        deviceId: device.id,
        lastSeenAt: device.lastSeenAt,
      });
      await prisma.deviceRecoveryNotice.update({
        where: { id: notice.id },
        data: { status: "sent", sentAt: now, lastError: null },
      });
      noticesSent += 1;
    } catch (error) {
      if (error instanceof UndeliverableEmailRecipientError) {
        await prisma.deviceRecoveryNotice.update({
          where: { id: notice.id },
          data: {
            status: "skipped",
            lastError: error.message.slice(0, 1000),
          },
        });
        continue;
      }

      const exhausted = attemptCount >= MAX_RECOVERY_EMAIL_ATTEMPTS;
      await prisma.deviceRecoveryNotice.update({
        where: { id: notice.id },
        data: {
          status: exhausted ? "skipped" : "failed",
          lastError: (error instanceof Error ? error.message : "recovery email failed").slice(0, 1000),
        },
      });
      noticesFailed += 1;
      if (!exhausted) {
        notifyServerIssue({
          severity: "warning",
          scope: "device-health/recovery-email",
          error,
          details: { deviceId: device.id, orgId: device.orgId },
        });
      }
    }
  }

  return {
    scanned: devices.length,
    stale: devices.length,
    autoRequestsCreated,
    repairRequired: devices.filter((device) => isRepairRequired(device.lastSeenAt, now)).length,
    noticesSent,
    noticesFailed,
  };
}

export async function createRemoteSyncRequest(input: {
  principal: AppPrincipal;
  scope: SyncRequestScope;
  idempotencyKey?: string | null;
}): Promise<SyncRequestView> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
  const { principal, scope } = input;
  if (scope === "team" && !hasCapability(principal.role, "org_overview")) {
    throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  }
  if (!hasCapability(principal.role, "self_view")) {
    throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  }

  await expireSyncTargets(now);
  void pruneSyncRequests(now).catch((error) => {
    notifyServerIssue({
      severity: "warning",
      scope: "sync-request/prune",
      error,
      details: { orgId: principal.orgId },
    });
  });
  const developer = scope === "you" ? await resolveLinkedDeveloper(principal.orgId, principal.userId) : null;
  if (scope === "you" && !developer) {
    throw Object.assign(new Error("LINKED_DEVELOPER_REQUIRED"), { status: 409 });
  }
  const developerId = developer?.id ?? null;
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 128) || null;

  if (idempotencyKey) {
    const duplicate = await prisma.syncRequest.findFirst({
      where: {
        orgId: principal.orgId,
        requesterUserId: principal.userId,
        idempotencyKey,
        scope,
        developerId,
        createdAt: { gte: new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (duplicate) {
      const existing = await loadRequestForView(duplicate.id);
      if (existing) return serializeSyncRequest(existing);
    }
  }

  const devices = await prisma.device.findMany({
    where: {
      orgId: principal.orgId,
      ...activeDeviceWhere,
      createdAt: { lte: now },
      ...(scope === "you" ? { userId: developerId! } : {}),
    },
    select: { id: true },
  });
  const realtimeChannel = devices.length ? channelForScope(scope, principal.orgId, developerId) : null;

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.syncRequest.create({
      data: {
        orgId: principal.orgId,
        requesterUserId: principal.userId,
        scope,
        developerId,
        idempotencyKey,
        realtimeChannel,
        dispatchStatus: devices.length ? "pending" : "skipped",
        expiresAt,
        targets: {
          createMany: {
            data: devices.map((device) => ({
              orgId: principal.orgId,
              deviceId: device.id,
              status: "queued",
            })),
          },
        },
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        orgId: principal.orgId,
        actorType: "user",
        actorId: principal.userId,
        action: "sync_request.create",
        targetType: "sync_request",
        targetId: created.id,
        metadata: {
          scope,
          developerId,
          targetCount: devices.length,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
    return created;
  });

  if (devices.length) {
    try {
      const dispatch = await publishWake({
        id: request.id,
        orgId: principal.orgId,
        scope,
        developerId,
        realtimeChannel,
      });
      await prisma.syncRequest.update({
        where: { id: request.id },
        data: dispatch.ok
          ? { dispatchStatus: "published", publishedAt: new Date(), dispatchError: null }
          : { dispatchStatus: dispatch.status, dispatchError: dispatch.error },
      });
      if (!dispatch.ok) {
        notifyServerIssue({
          severity: "warning",
          scope: "sync-request/ably",
          error: dispatch.error,
          details: { requestId: request.id, orgId: principal.orgId },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ably publish failed";
      await prisma.syncRequest.update({
        where: { id: request.id },
        data: { dispatchStatus: "degraded", dispatchError: message.slice(0, 2000) },
      });
      notifyServerIssue({
        severity: "warning",
        scope: "sync-request/ably",
        error,
        details: { requestId: request.id, orgId: principal.orgId },
      });
    }
  }

  const loaded = await loadRequestForView(request.id);
  if (!loaded) throw new Error("Created sync request could not be reloaded");
  return serializeSyncRequest(loaded);
}

export async function getRemoteSyncRequest(principal: AppPrincipal, requestId: string): Promise<SyncRequestView | null> {
  await expireSyncTargets();
  const request = await loadRequestForView(requestId);
  if (!request || request.orgId !== principal.orgId) return null;
  const canReadTeam = hasCapability(principal.role, "org_overview");
  if (request.scope === "team" && !canReadTeam) return null;
  if (request.scope === "you" && !canReadTeam && request.requesterUserId !== principal.userId) return null;
  return serializeSyncRequest(request);
}

/** Stop an in-flight sync: expire the request and mark unfinished targets expired. */
export async function cancelRemoteSyncRequest(
  principal: AppPrincipal,
  requestId: string,
): Promise<SyncRequestView | null> {
  const existing = await getRemoteSyncRequest(principal, requestId);
  if (!existing) return null;

  const now = new Date();
  await prisma.$transaction([
    prisma.syncRequest.update({
      where: { id: requestId },
      data: { expiresAt: now, dispatchError: existing.dispatchError ?? "Cancelled by user" },
    }),
    prisma.deviceSyncRequestTarget.updateMany({
      where: {
        requestId,
        orgId: principal.orgId,
        status: { in: ["queued", "claimed", "running"] },
      },
      data: {
        status: "expired",
        completedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    }),
  ]);

  return getRemoteSyncRequest(principal, requestId);
}

export async function createDeviceRealtimeTokenRequest(device: {
  id: string;
  orgId: string;
  userId: string;
}) {
  const key = process.env.ABLY_API_KEY?.trim();
  if (!key) {
    throw Object.assign(new Error("ABLY_API_KEY is not configured"), { status: 503 });
  }
  const capability = JSON.stringify({
    [`device-sync:org:${device.orgId}`]: ["subscribe"],
    [`device-sync:developer:${device.userId}`]: ["subscribe"],
  });
  const rest = new Ably.Rest(key);
  return rest.auth.createTokenRequest({
    clientId: `device:${device.id}`,
    ttl: 60 * 60 * 1000,
    capability,
  });
}

export async function claimDeviceSyncTargets(device: { id: string; orgId: string }) {
  const now = new Date();
  await expireSyncTargets(now);
  const staleOrQueued = await prisma.deviceSyncRequestTarget.findMany({
    where: {
      deviceId: device.id,
      orgId: device.orgId,
      syncRequest: { expiresAt: { gt: now } },
      OR: [
        { status: "queued" },
        { status: { in: ["claimed", "running"] }, leaseExpiresAt: { lt: now } },
        { status: { in: ["claimed", "running"] }, leaseExpiresAt: null },
      ],
    },
    select: { id: true },
    take: 50,
  });
  if (staleOrQueued.length === 0) return { leaseToken: null, targets: [] };

  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
  const ids = staleOrQueued.map((target) => target.id);
  await prisma.deviceSyncRequestTarget.updateMany({
    where: {
      id: { in: ids },
      deviceId: device.id,
      orgId: device.orgId,
      syncRequest: { expiresAt: { gt: now } },
      OR: [
        { status: "queued" },
        { status: { in: ["claimed", "running"] }, leaseExpiresAt: { lt: now } },
        { status: { in: ["claimed", "running"] }, leaseExpiresAt: null },
      ],
    },
    data: {
      status: "claimed",
      leaseToken,
      leaseExpiresAt,
      claimedAt: now,
      attemptCount: { increment: 1 },
    },
  });
  const targets = await prisma.deviceSyncRequestTarget.findMany({
    where: { id: { in: ids }, leaseToken },
    select: {
      id: true,
      requestId: true,
      syncRequest: { select: { scope: true, expiresAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    leaseToken,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    targets: targets.map((target) => ({
      id: target.id,
      requestId: target.requestId,
      scope: target.syncRequest.scope as SyncRequestScope,
      expiresAt: target.syncRequest.expiresAt.toISOString(),
    })),
  };
}

export async function reportDeviceSyncTargets(input: {
  device: { id: string; orgId: string };
  leaseToken: string;
  targetIds: string[];
  status: "running" | "succeeded" | "failed";
  tools?: number;
  accounts?: number;
  quotas?: number;
  usageRows?: number;
  warnings?: string[];
  errorMessage?: string | null;
}) {
  const now = new Date();
  const ids = input.targetIds.slice(0, 50);
  if (ids.length === 0) return { updated: 0 };
  const data: Prisma.DeviceSyncRequestTargetUpdateManyMutationInput = {
    status: input.status,
    leaseToken: input.status === "running" ? input.leaseToken : null,
    leaseExpiresAt: input.status === "running" ? new Date(now.getTime() + CLAIM_LEASE_MS) : null,
    ...(input.status === "running" ? { runningAt: now } : { completedAt: now }),
    ...(input.status === "succeeded"
      ? {
          toolsCount: Math.max(0, input.tools ?? 0),
          accountsCount: Math.max(0, input.accounts ?? 0),
          quotasCount: Math.max(0, input.quotas ?? 0),
          usageRowsCount: Math.max(0, input.usageRows ?? 0),
          warnings: sanitizeWarnings(input.warnings),
          errorCode: null,
          errorMessage: null,
        }
      : {}),
    ...(input.status === "failed"
      ? {
          warnings: sanitizeWarnings(input.warnings),
          errorCode: "collect_failed",
          errorMessage: input.errorMessage?.slice(0, 2000) ?? "Remote sync failed",
        }
      : {}),
  };
  const updated = await prisma.deviceSyncRequestTarget.updateMany({
    where: {
      id: { in: ids },
      deviceId: input.device.id,
      orgId: input.device.orgId,
      leaseToken: input.leaseToken,
      status: { in: ["claimed", "running"] },
    },
    data,
  });
  return { updated: updated.count };
}

export { REMOTE_SYNC_PROTOCOL };
