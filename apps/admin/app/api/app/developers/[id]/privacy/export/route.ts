import { NextRequest, NextResponse } from "next/server";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";
import { exportDeveloperData } from "@/lib/privacy/export";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const bundle = await exportDeveloperData(auth.orgId, id);
  if (!bundle) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: PRIVACY_AUDIT_ACTIONS.exportCompleted,
    targetType: "developer",
    targetId: id,
    metadata: { scope: "admin" },
  });
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="usejunction-export-${id}.json"`,
    },
  });
}
