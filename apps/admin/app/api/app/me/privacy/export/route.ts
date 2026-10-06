import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { exportDeveloperData } from "@/lib/privacy/export";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { audit, rolesFor } from "@/lib/rbac";
import { resolveLinkedDeveloperId } from "@/lib/queries/me/resolve-developer";

export async function GET(req: NextRequest) {
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;
  const developerId = await resolveLinkedDeveloperId(principal.orgId, principal.userId);
  if (!developerId) return NextResponse.json({ error: "developer profile required" }, { status: 409 });
  const bundle = await exportDeveloperData(principal.orgId, developerId);
  if (!bundle) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit({
    orgId: principal.orgId,
    actorType: "user",
    actorId: principal.userId,
    action: PRIVACY_AUDIT_ACTIONS.exportCompleted,
    targetType: "developer",
    targetId: developerId,
    metadata: { scope: "self" },
  });
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="usejunction-export-${developerId}.json"`,
    },
  });
}
