import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { audit, rolesFor } from "@/lib/rbac";
import { getPublicAppUrl } from "@/lib/public-url";
import { assertCanEnrollDevice } from "@/lib/saas-billing/status";
import { issueEnrollmentToken } from "@/lib/enrollment-token";
import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";
import { browserMutationGuard, limitedJson } from "@/lib/security/http";

export async function POST(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;

  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;

  const developer = await prisma.developer.findFirst({
    where: { orgId: principal.orgId, authUserId: principal.userId },
  });
  if (!developer) return NextResponse.json({ error: "developer profile required" }, { status: 409 });

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_orgId: { userId: principal.userId, orgId: principal.orgId } },
    select: { collectionNoticeAckAt: true, collectionNoticeVersion: true },
  });
  if (
    !membership?.collectionNoticeAckAt ||
    membership.collectionNoticeVersion !== COLLECTION_NOTICE_VERSION
  ) {
    return NextResponse.json(
      { error: "Acknowledge the collection notice before connecting a device." },
      { status: 403 },
    );
  }

  const enrollGate = await assertCanEnrollDevice(principal.orgId, developer.id);
  if (!enrollGate.allowed) {
    return NextResponse.json({ error: enrollGate.message }, { status: 403 });
  }

  const parsedBody = await limitedJson(req, 1024);
  const body = parsedBody.ok ? (parsedBody.data as Record<string, unknown>) : {};
  const rotate = body.rotate === true;

  const issued = await issueEnrollmentToken({
    orgId: principal.orgId,
    developerId: developer.id,
    rotate,
  });
  await audit({
    orgId: principal.orgId,
    actorType: "user",
    actorId: principal.userId,
    action: rotate ? "enrollment_token.rotated" : "enrollment_token.created",
    targetType: "enrollment_token",
    targetId: issued.id,
  });
  return NextResponse.json(
    {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      controlPlaneUrl: getPublicAppUrl(req),
    },
    { status: 201 },
  );
}
