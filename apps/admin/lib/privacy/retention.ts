import { prisma } from "@usejunction/db";
import { AUDIT_RETENTION_DAYS, DEFAULT_USAGE_RETENTION_DAYS, USAGE_RETENTION_ENFORCEMENT_ENABLED } from "@/lib/legal/versions";
import { enforceSignalsRetention } from "@/lib/signals/service";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { eraseDeveloperData } from "@/lib/privacy/erase";
import { audit } from "@/lib/rbac";

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function cutoffDate(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function enforceUsageRetention(orgId: string, retentionDays: number, now = new Date()) {
  const cutoff = cutoffDate(retentionDays, now);
  const day = isoDay(cutoff);
  const [usage, snapshots, quotas, requests, reports] = await Promise.all([
    prisma.usageDaily.deleteMany({ where: { orgId, date: { lt: cutoff } } }),
    prisma.orgUsageDaySnapshot.deleteMany({ where: { orgId, date: { lt: cutoff } } }),
    prisma.quotaObservation.deleteMany({ where: { orgId, observedAt: { lt: cutoff } } }),
    prisma.requestMetadata.deleteMany({ where: { orgId, createdAt: { lt: cutoff } } }),
    prisma.dailyReportUsageSnapshot.deleteMany({ where: { orgId, localDate: { lt: day } } }),
  ]);
  return {
    usage: usage.count,
    snapshots: snapshots.count,
    quotas: quotas.count,
    requests: requests.count,
    reports: reports.count,
  };
}

export async function enforceGlobalTtls(now = new Date()) {
  const [provider, buckets, auditLogs] = await Promise.all([
    prisma.providerSourceRecord.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate(AUDIT_RETENTION_DAYS, now) },
        NOT: { action: { startsWith: "privacy." } },
      },
    }),
  ]);
  return { provider: provider.count, rateLimits: buckets.count, auditLogs: auditLogs.count };
}

export async function processDueErasureRequests(now = new Date()) {
  const due = await prisma.privacyRequest.findMany({
    where: { type: "erasure", status: "pending", scheduledFor: { lte: now } },
    take: 50,
  });
  let completed = 0;
  for (const request of due) {
    if (!request.subjectDeveloperId) {
      await prisma.privacyRequest.update({
        where: { id: request.id },
        data: { status: "failed", metadata: { reason: "missing_developer" } },
      });
      continue;
    }
    const result = await eraseDeveloperData({
      orgId: request.orgId,
      developerId: request.subjectDeveloperId,
    });
    await prisma.privacyRequest.update({
      where: { id: request.id },
      data: {
        status: result.ok ? "completed" : "failed",
        completedAt: result.ok ? now : null,
        metadata: result.ok ? { developerId: result.developerId } : { reason: result.reason },
      },
    });
    if (result.ok) {
      completed += 1;
      await audit({
        orgId: request.orgId,
        actorType: "system",
        action: PRIVACY_AUDIT_ACTIONS.erasureCompleted,
        targetType: "developer",
        targetId: request.subjectDeveloperId,
        metadata: { requestId: request.id, scheduled: true },
      });
    }
  }
  return { due: due.length, completed };
}

export async function enforceAllRetention(now = new Date()) {
  const global = await enforceGlobalTtls(now);
  const orgs = await prisma.organization.findMany({
    select: { id: true, usageRetentionDays: true },
  });
  const orgResults = [];
  for (const org of orgs) {
    const retentionDays = org.usageRetentionDays || DEFAULT_USAGE_RETENTION_DAYS;
    const usage = USAGE_RETENTION_ENFORCEMENT_ENABLED
      ? await enforceUsageRetention(org.id, retentionDays, now)
      : { usage: 0, snapshots: 0, quotas: 0, requests: 0, reports: 0 };
    const policy = await prisma.signalsPolicy.findFirst({
      where: { orgId: org.id },
      select: { retentionDays: true },
    });
    await enforceSignalsRetention(org.id, policy?.retentionDays ?? 90);
    orgResults.push({ orgId: org.id, ...usage });
  }
  const erasures = await processDueErasureRequests(now);
  return { global, orgs: orgResults.length, erasures };
}
