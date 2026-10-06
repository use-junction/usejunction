import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { audit, rolesFor } from "@/lib/rbac";
import { browserMutationGuard } from "@/lib/security/http";

export async function POST(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;
  const body = (await req.json().catch(() => ({}))) as { analytics?: boolean };
  if (typeof body.analytics !== "boolean") {
    return NextResponse.json({ error: "analytics boolean required" }, { status: 400 });
  }
  await audit({
    orgId: principal.orgId,
    actorType: "user",
    actorId: principal.userId,
    action: body.analytics
      ? PRIVACY_AUDIT_ACTIONS.analyticsGranted
      : PRIVACY_AUDIT_ACTIONS.analyticsWithdrawn,
    targetType: "user",
    targetId: principal.userId,
  });
  return NextResponse.json({ ok: true, analytics: body.analytics });
}
