import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "@usejunction/db";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData } from "@/lib/api/app-response";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";
import { listTeams, teamInputSchema } from "@/lib/teams";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  return appData({ teams: await listTeams(principal.orgId) });
}

export async function POST(request: NextRequest) {
  const auth = await requireOrgRole(request, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const parsed = teamInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the team name." }, { status: 400 });
  }
  try {
    const team = await prisma.team.create({
      data: { orgId: auth.orgId, name: parsed.data.name, color: parsed.data.color ?? null },
      select: { id: true, name: true, color: true },
    });
    await audit({
      orgId: auth.orgId,
      actorType: "user",
      actorId: auth.userId,
      action: "team.created",
      targetType: "team",
      targetId: team.id,
      metadata: { name: team.name },
    });
    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A team with that name already exists." }, { status: 409 });
    }
    throw error;
  }
}
