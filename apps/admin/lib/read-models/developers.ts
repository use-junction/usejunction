import { prisma } from "@usejunction/db";
import type { MetricWindow } from "@/lib/analytics/contracts/time-window";
import { resolveReportWindow } from "@/lib/analytics/contracts/time-window";
import { readDeveloperActivityFromSnapshots } from "@/lib/analytics/snapshots";

export async function getDeveloperRoster(
  orgId: string,
  options: { developerId?: string; reportWindow?: MetricWindow } = {},
) {
  const reportWindow = options.reportWindow ?? resolveReportWindow({ range: 30 });
  const [developers, activity] = await Promise.all([
    prisma.developer.findMany({
      where: {
        orgId,
        removedAt: null,
        ...(options.developerId ? { id: options.developerId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        devices: {
          where: { decommissionedAt: null },
          select: {
            id: true,
            hostname: true,
            lastSeenAt: true,
            toolInstallations: {
              where: { detected: true },
              select: { toolName: true },
            },
          },
        },
        seatAssignments: {
          select: {
            provider: true,
            product: true,
            plan: true,
            status: true,
            source: true,
            lastActivityAt: true,
            observedAt: true,
          },
        },
        toolClaims: {
          where: { enabled: true },
          select: { toolName: true, source: true, observedAt: true },
        },
      },
    }),
    readDeveloperActivityFromSnapshots(orgId, reportWindow, {
      developerId: options.developerId,
      ensure: false,
    }),
  ]);

  const authUserIds = [
    ...new Set(
      developers
        .map((developer) => developer.authUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const memberships =
    authUserIds.length > 0
      ? await prisma.organizationMembership.findMany({
          where: { orgId, userId: { in: authUserIds } },
          select: { userId: true, role: true },
        })
      : [];
  const roleByUserId = new Map(memberships.map((row) => [row.userId, row.role]));

  const activityMap = new Map(
    activity.map((row) => [
      row.developerId,
      {
        requests: row.requests,
        cost: row.cost,
        usedTools: row.tools,
      },
    ]),
  );

  return {
    developers: developers.map((developer) => {
      const usage = activityMap.get(developer.id);
      return {
        id: developer.id,
        name: developer.name,
        email: developer.email,
        authUserId: developer.authUserId,
        teamId: developer.teamId,
        role:
          developer.authUserId != null
            ? (roleByUserId.get(developer.authUserId) ?? developer.role)
            : developer.role,
        createdAt: developer.createdAt,
        devices: developer.devices,
        vendorSeats: developer.seatAssignments,
        toolEvidence: developer.toolClaims,
        usedTools: [...new Set(usage?.usedTools ?? [])],
        requests: usage?.requests ?? 0,
        cost: usage?.cost ?? 0,
      };
    }),
  };
}

export type DeveloperRosterData = Awaited<ReturnType<typeof getDeveloperRoster>>;
