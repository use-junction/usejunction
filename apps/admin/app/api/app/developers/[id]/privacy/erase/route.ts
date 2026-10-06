import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";
import { eraseDeveloperData } from "@/lib/privacy/erase";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { browserMutationGuard } from "@/lib/security/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const subject = await prisma.developer.findFirst({
    where: { id, orgId: auth.orgId },
    select: { authUserId: true },
  });
  if (subject?.authUserId === auth.userId) {
    return NextResponse.json({ error: "cannot erase yourself from this route" }, { status: 403 });
  }
  const result = await eraseDeveloperData({ orgId: auth.orgId, developerId: id });
  if (!result.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.privacyRequest.create({
    data: {
      orgId: auth.orgId,
      subjectDeveloperId: id,
      type: "erasure",
      status: "completed",
      requestedByUserId: auth.userId,
      completedAt: new Date(),
    },
  });
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: PRIVACY_AUDIT_ACTIONS.erasureCompleted,
    targetType: "developer",
    targetId: id,
    metadata: { scope: "admin" },
  });
  return NextResponse.json({ ok: true, id });
}
