import { prisma } from "@usejunction/db";
import type { AppPrincipal } from "@/lib/api/app-auth";
import { jsonSafe } from "@/lib/api/app-response";
import { COLLECTION_NOTICE_VERSION, DEFAULT_USAGE_RETENTION_DAYS } from "@/lib/legal/versions";
import { listCollectionEvents, listGatedAccounts } from "@/lib/privacy/account-collection";
import { collectionNoticeCopy } from "@/lib/privacy/collection-notice";
import { MY_DATA_PREFERENCE_EVENT_LIMIT } from "@/lib/privacy/my-data-constants";
import { attachUsageStorage, isoUsageDay, usageRetentionCutoff } from "@/lib/privacy/my-data-recency";
import type { MyDataPayload, MyDataPreferenceEvent, UsageStorageAggregate } from "@/lib/privacy/my-data-types";
import { siteConfig } from "@/lib/public/config";
import { signalsAllowed } from "@/lib/region";
import { resolveLinkedDeveloperId } from "@/lib/queries/me/resolve-developer";
import { toolDisplayName } from "@/lib/tools/catalog";

export const MY_DATA_LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/gdpr", label: "GDPR" },
  { href: "/dpa", label: "DPA" },
  { href: "/security", label: "Security" },
  { href: "/subprocessors", label: "Subprocessors" },
  { href: "/cookies", label: "Cookies" },
  { href: `${siteConfig.githubUrl}/blob/main/docs/compliance/employee-notice-template.md`, label: "Employee notice" },
  { href: `${siteConfig.githubUrl}/blob/main/docs/compliance/works-council-brief.md`, label: "Works council" },
] as const;

function enrichPreferenceEvents(
  events: Awaited<ReturnType<typeof listCollectionEvents>>,
  accounts: Awaited<ReturnType<typeof listGatedAccounts>>,
): MyDataPreferenceEvent[] {
  return events.slice(0, MY_DATA_PREFERENCE_EVENT_LIMIT).map((event) => {
    const match =
      accounts.find(
        (account) =>
          account.deviceId === event.deviceId &&
          account.toolName === event.toolName &&
          account.accountKey === event.accountKey,
      ) ??
      accounts.find((account) => account.deviceId === event.deviceId && account.toolName === event.toolName);
    return {
      ...event,
      hostname: match?.hostname ?? "",
      displayName: match?.displayName ?? toolDisplayName(event.toolName),
      email: match?.email ?? null,
    };
  });
}

export async function loadMyDataPage(principal: AppPrincipal): Promise<MyDataPayload> {
  const [organization, membership, developerId, legal] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: principal.orgId },
      select: { name: true, dataRegion: true, usageRetentionDays: true },
    }),
    prisma.organizationMembership.findUnique({
      where: { userId_orgId: { userId: principal.userId, orgId: principal.orgId } },
      select: { collectionNoticeAckAt: true, collectionNoticeVersion: true, role: true },
    }),
    resolveLinkedDeveloperId(principal.orgId, principal.userId),
    prisma.user.findUnique({
      where: { id: principal.userId },
      select: { name: true, email: true, termsAcceptedAt: true, termsVersion: true, privacyVersion: true },
    }),
  ]);

  const account = legal ? { ...legal, termsAcceptedAt: legal.termsAcceptedAt?.toISOString() ?? null } : null;
  const retentionDays = DEFAULT_USAGE_RETENTION_DAYS;
  const notice = collectionNoticeCopy({
    orgName: organization?.name,
    usageRetentionDays: retentionDays,
  });
  const emptySummary = {
    accountCount: 0,
    collectingCount: 0,
    usageCollectingCount: 0,
    loggingCollectingCount: 0,
    deviceCount: 0,
    lastDeviceSeenAt: null as string | null,
    latestStoredUsageDay: null as string | null,
    hasUnattributedUsage: false,
  };

  if (!developerId) {
    return jsonSafe({
      account,
      organization,
      membership: {
        role: membership?.role ?? principal.role,
        collectionNoticeAcked: membership?.collectionNoticeVersion === COLLECTION_NOTICE_VERSION,
        collectionNoticeAckAt: membership?.collectionNoticeAckAt?.toISOString() ?? null,
      },
      notice,
      signalsAvailable: signalsAllowed(),
      developerId: null,
      summary: emptySummary,
      collection: { accounts: [], preferenceEvents: [] },
      rights: {
        exportHref: "/api/app/me/privacy/export",
        erasure: { pending: false, scheduledFor: null, requestId: null },
        legalLinks: [...MY_DATA_LEGAL_LINKS],
      },
    });
  }

  const cutoff = usageRetentionCutoff(retentionDays);
  const [accounts, preferenceEvents, usageGroups, deviceStats, erasure] = await Promise.all([
    listGatedAccounts({ orgId: principal.orgId, userId: developerId }),
    listCollectionEvents({ orgId: principal.orgId, userId: developerId, take: MY_DATA_PREFERENCE_EVENT_LIMIT }),
    prisma.usageDaily.groupBy({
      by: ["deviceId", "toolName", "accountKey"],
      where: {
        orgId: principal.orgId,
        developerId,
        date: { gte: cutoff },
        requests: { gt: 0 },
      },
      _max: { date: true },
      _min: { date: true },
      _sum: { requests: true },
    }),
    prisma.device.aggregate({
      where: { orgId: principal.orgId, userId: developerId, decommissionedAt: null },
      _count: { _all: true },
      _max: { lastSeenAt: true },
    }),
    prisma.privacyRequest.findFirst({
      where: { orgId: principal.orgId, subjectDeveloperId: developerId, type: "erasure", status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, scheduledFor: true },
    }),
  ]);

  const aggregates: UsageStorageAggregate[] = usageGroups
    .map((row) => ({
      deviceId: row.deviceId,
      toolName: row.toolName,
      accountKey: row.accountKey,
      lastUsageDay: isoUsageDay(row._max.date) ?? "",
      firstUsageDay: isoUsageDay(row._min?.date),
      requests: Number(row._sum?.requests ?? 0),
    }))
    .filter((row) => row.lastUsageDay);

  const stored = attachUsageStorage(accounts, aggregates);
  const signalsAvailable = signalsAllowed();
  const loggingOn = (row: { loggingAllowed: boolean }) => signalsAvailable && row.loggingAllowed;

  return jsonSafe({
    account,
    organization,
    membership: {
      role: membership?.role ?? principal.role,
      collectionNoticeAcked: membership?.collectionNoticeVersion === COLLECTION_NOTICE_VERSION,
      collectionNoticeAckAt: membership?.collectionNoticeAckAt?.toISOString() ?? null,
    },
    notice,
    signalsAvailable,
    developerId,
    summary: {
      accountCount: stored.accounts.length,
      collectingCount: stored.accounts.filter((row) => row.usageAllowed || loggingOn(row)).length,
      usageCollectingCount: stored.accounts.filter((row) => row.usageAllowed).length,
      loggingCollectingCount: stored.accounts.filter(loggingOn).length,
      deviceCount: deviceStats._count._all,
      lastDeviceSeenAt: deviceStats._max.lastSeenAt?.toISOString() ?? null,
      latestStoredUsageDay: stored.latestStoredUsageDay,
      storedRequests: aggregates.reduce((sum, row) => sum + (row.requests ?? 0), 0),
      hasUnattributedUsage: stored.hasUnattributedUsage,
    },
    collection: {
      accounts: stored.accounts,
      preferenceEvents: enrichPreferenceEvents(preferenceEvents, accounts),
    },
    rights: {
      exportHref: "/api/app/me/privacy/export",
      erasure: {
        pending: Boolean(erasure),
        scheduledFor: erasure?.scheduledFor?.toISOString() ?? null,
        requestId: erasure?.id ?? null,
      },
      legalLinks: [...MY_DATA_LEGAL_LINKS],
    },
  });
}
