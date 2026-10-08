import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "@usejunction/db";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";
import { teamInputSchema } from "@/lib/teams";

type Context = { params: Promise<{ id: string }> };

async function findTeam(orgId: string, id: string) {
  return prisma.team.findFirst({ where: { id, orgId }, select: { id: true, name: true } });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const auth = await requireOrgRole(request, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const existing = await findTeam(auth.orgId, id);
  if (!existing) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  const parsed = teamInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the team name." }, { status: 400 });
  }
  try {
    const team = await prisma.team.update({
      where: { id: existing.id },
      data: { name: parsed.data.name, ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}) },
      select: { id: true, name: true, color: true },
    });
    await audit({
      orgId: auth.orgId,
      actorType: "user",
      actorId: auth.userId,
      action: "team.updated",
      targetType: "team",
      targetId: team.id,
      metadata: { name: team.name, previousName: existing.name },
    });
    return NextResponse.json({ team });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A team with that name already exists." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const auth = await requireOrgRole(request, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const existing = await findTeam(auth.orgId, id);
  if (!existing) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  // Members fall back to "no team" through ON DELETE SET NULL; their data stays.
  await prisma.team.delete({ where: { id: existing.id } });
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: "team.deleted",
    targetType: "team",
    targetId: existing.id,
    metadata: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
