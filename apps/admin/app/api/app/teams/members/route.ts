import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";
import { teamAssignmentSchema } from "@/lib/teams";

/** Move people into a team, or out of every team with `teamId: null`. */
export async function POST(request: NextRequest) {
  const auth = await requireOrgRole(request, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const parsed = teamAssignmentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick at least one person." }, { status: 400 });
  const { developerIds, teamId } = parsed.data;

  let teamName: string | null = null;
  if (teamId) {
    const team = await prisma.team.findFirst({ where: { id: teamId, orgId: auth.orgId }, select: { name: true } });
    if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    teamName = team.name;
  }

  const result = await prisma.developer.updateMany({
    where: { orgId: auth.orgId, id: { in: developerIds }, removedAt: null },
    data: { teamId },
  });
  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: teamId ? "team.members_assigned" : "team.members_unassigned",
    targetType: "team",
    targetId: teamId,
    metadata: { developerIds, count: result.count, teamName },
  });
  return NextResponse.json({ updated: result.count });
}
