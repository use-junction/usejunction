import { prisma } from "@usejunction/db";
import { jsonSafe } from "@/lib/api/app-response";

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function usageDailyToCsv(
  rows: Array<{
    date: Date | string;
    toolName: string;
    model: string;
    requests: number;
    inputTokens: bigint | number | string;
    outputTokens: bigint | number | string;
  }>,
) {
  const header = "date,toolName,model,requests,inputTokens,outputTokens";
  const lines = rows.map((row) =>
    [
      row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
      row.toolName,
      row.model,
      row.requests,
      row.inputTokens,
      row.outputTokens,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export async function exportDeveloperData(orgId: string, developerId: string) {
  const developer = await prisma.developer.findFirst({
    where: { id: developerId, orgId },
    include: {
      authUser: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          timeZone: true,
          termsAcceptedAt: true,
          termsVersion: true,
          privacyVersion: true,
          createdAt: true,
        },
      },
      devices: {
        include: {
          toolInstallations: true,
          toolAccounts: true,
          localModels: true,
        },
      },
      toolInstallations: true,
      toolAccounts: true,
      localModels: true,
      usageDaily: { orderBy: { date: "desc" }, take: 4000 },
      localWorkSessions: { orderBy: { observedAt: "desc" }, take: 500 },
      signalsSessions: { orderBy: { startedAt: "desc" }, take: 500 },
      deviceActivityEvents: { orderBy: { occurredAt: "desc" }, take: 200 },
      planAssignments: true,
      externalIdentities: true,
      seatAssignments: true,
    },
  });
  if (!developer) return null;

  const [prefs, interests, membership] = await Promise.all([
    developer.authUserId
      ? prisma.userNotificationPreference.findUnique({
          where: { userId_orgId: { userId: developer.authUserId, orgId } },
        })
      : null,
    prisma.planInterest.findMany({
      where: { orgId, OR: [{ email: developer.email }, { userId: developer.authUserId ?? undefined }] },
    }),
    developer.authUserId
      ? prisma.organizationMembership.findUnique({
          where: { userId_orgId: { userId: developer.authUserId, orgId } },
        })
      : null,
  ]);

  return jsonSafe({
    exportedAt: new Date().toISOString(),
    developer: {
      id: developer.id,
      name: developer.name,
      email: developer.email,
      role: developer.role,
      removedAt: developer.removedAt,
      createdAt: developer.createdAt,
    },
    account: developer.authUser,
    membership,
    devices: developer.devices,
    toolInstallations: developer.toolInstallations,
    toolAccounts: developer.toolAccounts,
    localModels: developer.localModels,
    usageDaily: developer.usageDaily,
    workSessions: developer.localWorkSessions,
    signalsSessions: developer.signalsSessions,
    deviceActivity: developer.deviceActivityEvents,
    planAssignments: developer.planAssignments,
    externalIdentities: developer.externalIdentities,
    seatAssignments: developer.seatAssignments,
    notificationPreferences: prefs,
    planInterests: interests,
    usageCsv: usageDailyToCsv(developer.usageDaily),
  });
}
