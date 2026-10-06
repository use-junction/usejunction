import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";
import { collectionNoticeCopy } from "@/lib/privacy/collection-notice";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { audit, rolesFor } from "@/lib/rbac";
import { browserMutationGuard } from "@/lib/security/http";

export async function GET(req: NextRequest) {
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;

  const [membership, organization] = await Promise.all([
    prisma.organizationMembership.findUnique({
      where: { userId_orgId: { userId: principal.userId, orgId: principal.orgId } },
      select: { collectionNoticeAckAt: true, collectionNoticeVersion: true },
    }),
    prisma.organization.findUnique({
      where: { id: principal.orgId },
      select: { name: true, usageRetentionDays: true },
    }),
  ]);

  const notice = collectionNoticeCopy({
    orgName: organization?.name,
    usageRetentionDays: organization?.usageRetentionDays,
  });
  const acknowledged =
    membership?.collectionNoticeVersion === COLLECTION_NOTICE_VERSION &&
    Boolean(membership.collectionNoticeAckAt);

  return NextResponse.json({
    acknowledged,
    version: COLLECTION_NOTICE_VERSION,
    acknowledgedAt: membership?.collectionNoticeAckAt?.toISOString() ?? null,
    notice,
  });
}

export async function POST(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;

  const body = (await req.json().catch(() => ({}))) as { accept?: boolean };
  if (body.accept !== true) {
    return NextResponse.json({ error: "acknowledgement required" }, { status: 400 });
  }

  const now = new Date();
  await prisma.organizationMembership.update({
    where: { userId_orgId: { userId: principal.userId, orgId: principal.orgId } },
    data: {
      collectionNoticeAckAt: now,
      collectionNoticeVersion: COLLECTION_NOTICE_VERSION,
    },
  });
  await audit({
    orgId: principal.orgId,
    actorType: "user",
    actorId: principal.userId,
    action: PRIVACY_AUDIT_ACTIONS.collectionNoticeAcknowledged,
    targetType: "membership",
    metadata: { version: COLLECTION_NOTICE_VERSION },
  });

  return GET(req);
}
