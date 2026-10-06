import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { ERASURE_GRACE_DAYS } from "@/lib/legal/versions";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { audit, rolesFor } from "@/lib/rbac";
import { resolveLinkedDeveloperId } from "@/lib/queries/me/resolve-developer";
import { browserMutationGuard } from "@/lib/security/http";

export async function POST(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;
  const developerId = await resolveLinkedDeveloperId(principal.orgId, principal.userId);
  if (!developerId) return NextResponse.json({ error: "developer profile required" }, { status: 409 });

  const scheduledFor = new Date(Date.now() + ERASURE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const request = await prisma.privacyRequest.create({
    data: {
      orgId: principal.orgId,
      subjectDeveloperId: developerId,
      subjectUserId: principal.userId,
      type: "erasure",
      status: "pending",
      requestedByUserId: principal.userId,
      scheduledFor,
    },
  });
  await audit({
    orgId: principal.orgId,
    actorType: "user",
    actorId: principal.userId,
    action: PRIVACY_AUDIT_ACTIONS.erasureRequested,
    targetType: "developer",
    targetId: developerId,
    metadata: { requestId: request.id, scheduledFor: scheduledFor.toISOString() },
  });
  return NextResponse.json({
    ok: true,
    id: request.id,
    scheduledFor: scheduledFor.toISOString(),
  });
}
