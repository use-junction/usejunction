import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { syncConnection } from "@/lib/integrations/sync";
import { requireOrgRole, audit, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const connection = await prisma.providerConnection.findFirst({ where: { id, orgId: auth.orgId }, select: { id: true } });
  if (!connection) return NextResponse.json({ error: "integration not found" }, { status: 404 });
  try {
    const counts = await syncConnection(id);
    await audit({ orgId: auth.orgId, actorType: "user", actorId: auth.userId, action: "integration.synced", targetType: "provider_connection", targetId: id, metadata: counts });
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    logServerError("integrations/sync", error);
    return NextResponse.json({ error: "provider sync failed" }, { status: 502 });
  }
}
