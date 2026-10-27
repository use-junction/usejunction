import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requestProviderSyncStop } from "@/lib/integrations/sync-stop";
import { requireOrgRole, audit, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";

/**
 * Ask a running sync for this connection to stop after the repository it is on.
 * The request expires after a few minutes so it never halts a later scheduled run.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const connection = await prisma.providerConnection.findFirst({ where: { id, orgId: auth.orgId }, select: { id: true } });
  if (!connection) return NextResponse.json({ error: "integration not found" }, { status: 404 });
  try {
    await requestProviderSyncStop(id);
    await audit({ orgId: auth.orgId, actorType: "user", actorId: auth.userId, action: "integration.sync_stop_requested", targetType: "provider_connection", targetId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logServerError("integrations/sync-stop", error);
    return NextResponse.json({ error: "could not request a stop" }, { status: 500 });
  }
}
