import { prisma, type Prisma } from "@usejunction/db";
import { decommissionDevices } from "@/lib/devices/decommission";
import { ORG_DAY_SNAPSHOT_VERSION, rematerializeOrgSnapshots } from "@/lib/analytics/snapshots";

function anonymisedEmail(developerId: string) {
  return `erased-${developerId.slice(0, 12)}@erased.invalid`;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}

export async function eraseDeveloperData(input: {
  orgId: string;
  developerId: string;
}) {
  const developer = await prisma.developer.findFirst({
    where: { id: input.developerId, orgId: input.orgId },
    select: {
      id: true,
      email: true,
      name: true,
      authUserId: true,
      devices: { select: { id: true } },
    },
  });
  if (!developer) return { ok: false as const, reason: "not_found" as const };

  const deviceIds = developer.devices.map((device) => device.id);
  const now = new Date();
  const erasedEmail = anonymisedEmail(developer.id);

  await prisma.$transaction(async (tx) => {
    if (deviceIds.length) {
      await decommissionDevices(tx, deviceIds, now);
      await tx.device.deleteMany({ where: { id: { in: deviceIds } } });
    }

    await tx.usageDaily.updateMany({
      where: { orgId: input.orgId, developerId: developer.id },
      data: { developerId: null, deviceId: null, metadata: {} },
    });

    await tx.externalIdentity.deleteMany({ where: { developerId: developer.id } });
    await tx.seatAssignment.deleteMany({ where: { developerId: developer.id } });
    await tx.planInterest.deleteMany({
      where: {
        orgId: input.orgId,
        OR: [{ email: developer.email }, ...(developer.authUserId ? [{ userId: developer.authUserId }] : [])],
      },
    });

    if (developer.authUserId) {
      await tx.userNotificationPreference.deleteMany({
        where: { userId: developer.authUserId, orgId: input.orgId },
      });
      await tx.dailyReportDelivery.deleteMany({
        where: { userId: developer.authUserId, orgId: input.orgId },
      });
      await tx.organizationMembership.deleteMany({
        where: { userId: developer.authUserId, orgId: input.orgId },
      });
    }

    await tx.developer.update({
      where: { id: developer.id },
      data: {
        name: "Erased member",
        email: erasedEmail,
        authUserId: null,
        removedAt: developer.authUserId ? now : now,
      },
    });
  });

  const logs = await prisma.auditLog.findMany({
    where: { orgId: input.orgId, OR: [{ actorId: developer.authUserId ?? undefined }, { targetId: developer.id }] },
    select: { id: true, metadata: true },
    take: 2000,
  });
  for (const log of logs) {
    await prisma.auditLog.update({
      where: { id: log.id },
      data: { metadata: redactValue(log.metadata) as Prisma.InputJsonValue },
    });
  }

  if (developer.authUserId) {
    const remaining = await prisma.organizationMembership.count({
      where: { userId: developer.authUserId },
    });
    if (remaining === 0) {
      await prisma.user.delete({ where: { id: developer.authUserId } }).catch(() => undefined);
    }
  }

  await rematerializeOrgSnapshots(input.orgId, { metricVersion: ORG_DAY_SNAPSHOT_VERSION, includeToday: true });
  return { ok: true as const, developerId: developer.id };
}
