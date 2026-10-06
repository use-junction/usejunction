import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { removeGitHubConnectionWork } from "@/lib/features/pipeline";
import { disconnectGitHubProjects } from "@/lib/integrations/github-projects";
import { requireOrgRole, audit, rolesFor } from "@/lib/rbac";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const connection = await prisma.providerConnection.findFirst({
    where: { id, orgId: auth.orgId },
    select: { id: true, provider: true, externalOrgId: true },
  });
  if (!connection) return NextResponse.json({ error: "integration not found" }, { status: 404 });
  if (connection.provider === "github") {
    await disconnectGitHubProjects(auth.orgId, connection.id);
    await removeGitHubConnectionWork(auth.orgId, connection.id);
  }
  const result = await prisma.providerConnection.updateMany({
    where: { id, orgId: auth.orgId },
    data: { status: "disconnected", credentialCiphertext: null, credentialFingerprint: null, nextSyncAt: null, leaseUntil: null },
  });
  if (!result.count) return NextResponse.json({ error: "integration not found" }, { status: 404 });
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: "integration.disconnected",
    targetType: "provider_connection",
    targetId: id,
    metadata: connection.provider === "github" ? { githubAccount: connection.externalOrgId } : undefined,
  });
  return NextResponse.json({ ok: true });
}
