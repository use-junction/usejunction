import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadLegalAcceptance, recordLegalAcceptance } from "@/lib/legal/acceptance";
import { audit } from "@/lib/rbac";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { browserMutationGuard } from "@/lib/security/http";
import { prisma } from "@usejunction/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await loadLegalAcceptance(session.user.id));
}

export async function POST(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { accept?: boolean };
  if (body.accept !== true) {
    return NextResponse.json({ error: "acceptance required" }, { status: 400 });
  }
  const updated = await recordLegalAcceptance(session.user.id);
  const orgId = session.user.orgId;
  if (orgId) {
    await audit({
      orgId,
      actorType: "user",
      actorId: session.user.id,
      action: PRIVACY_AUDIT_ACTIONS.legalAccepted,
      targetType: "user",
      targetId: session.user.id,
      metadata: { termsVersion: updated.termsVersion, privacyVersion: updated.privacyVersion },
    });
  } else {
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: session.user.id },
      select: { orgId: true },
    });
    if (membership) {
      await audit({
        orgId: membership.orgId,
        actorType: "user",
        actorId: session.user.id,
        action: PRIVACY_AUDIT_ACTIONS.legalAccepted,
        targetType: "user",
        targetId: session.user.id,
        metadata: { termsVersion: updated.termsVersion, privacyVersion: updated.privacyVersion },
      });
    }
  }
  return NextResponse.json(await loadLegalAcceptance(session.user.id));
}
