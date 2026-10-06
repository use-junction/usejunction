import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { z } from "zod";
import { featureCostWindow } from "@/lib/features/allocate";
import { wakeGitHubAuthorDaemons } from "@/lib/features/autosync";
import { runCommitUsageMapping } from "@/lib/features/pipeline";
import { logServerError } from "@/lib/errors/public";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";

const schema = z.object({ developerId: z.string().trim().min(1).nullable() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid developer mapping" }, { status: 400 });
  const { id } = await params;
  const identity = await prisma.externalIdentity.findFirst({
    where: { id, orgId: auth.orgId, provider: "github" },
  });
  if (!identity) return NextResponse.json({ error: "identity not found" }, { status: 404 });
  if (parsed.data.developerId) {
    const developer = await prisma.developer.findFirst({
      where: { id: parsed.data.developerId, orgId: auth.orgId, removedAt: null },
      select: { id: true },
    });
    if (!developer) return NextResponse.json({ error: "developer not found" }, { status: 422 });
  }
  const updated = await prisma.externalIdentity.update({
    where: { id: identity.id },
    data: { developerId: parsed.data.developerId, matchedBy: "manual" },
  });
  const { from, to } = featureCostWindow();
  const developerIds = [identity.developerId, parsed.data.developerId].filter((value): value is string => Boolean(value));
  await runCommitUsageMapping(auth.orgId, { from, to }, {
    connectionId: identity.connectionId ?? undefined,
    developerIds: developerIds.length ? developerIds : undefined,
  });
  if (parsed.data.developerId) {
    try {
      await wakeGitHubAuthorDaemons(auth.orgId, {
        developerIds: [parsed.data.developerId],
        force: true,
      });
    } catch (error) {
      logServerError("features/github-identity-wake", error, {
        orgId: auth.orgId,
        developerId: parsed.data.developerId,
      });
    }
  }
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: "github_identity.mapped",
    targetType: "external_identity",
    targetId: identity.id,
    metadata: { developerId: parsed.data.developerId, login: identity.externalUserId },
  });
  return NextResponse.json({ identity: { id: updated.id, developerId: updated.developerId, matchedBy: updated.matchedBy } });
}
