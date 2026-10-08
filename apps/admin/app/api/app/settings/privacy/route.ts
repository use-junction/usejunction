import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireOrgRole, audit, rolesFor } from "@/lib/rbac";
import { DEFAULT_USAGE_RETENTION_DAYS, isUsageRetentionDays, USAGE_RETENTION_ENFORCEMENT_ENABLED } from "@/lib/legal/versions";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { browserMutationGuard } from "@/lib/security/http";
import { signalsAllowed } from "@/lib/region";

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;
  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { usageRetentionDays: true, dataRegion: true },
  });
  return NextResponse.json({
    usageRetentionDays: org?.usageRetentionDays ?? DEFAULT_USAGE_RETENTION_DAYS,
    dataRegion: org?.dataRegion ?? "us",
    signalsAllowed: signalsAllowed(),
    enforcementEnabled: USAGE_RETENTION_ENFORCEMENT_ENABLED,
  });
}

export async function PATCH(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { usageRetentionDays?: number };
  if (!isUsageRetentionDays(body.usageRetentionDays)) {
    return NextResponse.json({ error: "usageRetentionDays must be 90, 180, 365, 730, or 1095" }, { status: 400 });
  }
  const org = await prisma.organization.update({
    where: { id: auth.orgId },
    data: { usageRetentionDays: body.usageRetentionDays },
    select: { usageRetentionDays: true, dataRegion: true },
  });
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: PRIVACY_AUDIT_ACTIONS.retentionUpdated,
    targetType: "organization",
    targetId: auth.orgId,
    metadata: { usageRetentionDays: org.usageRetentionDays },
  });
  return NextResponse.json({
    usageRetentionDays: org.usageRetentionDays,
    dataRegion: org.dataRegion,
    signalsAllowed: signalsAllowed(),
    enforcementEnabled: USAGE_RETENTION_ENFORCEMENT_ENABLED,
  });
}
