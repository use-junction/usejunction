import { prisma } from "@usejunction/db";
import { z } from "zod";

export type TeamSummary = {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
};

export const TEAM_NAME_MAX = 60;

export const teamInputSchema = z.object({
  name: z.string().trim().min(1, "Name the team.").max(TEAM_NAME_MAX),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export const teamAssignmentSchema = z.object({
  developerIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  /** null removes people from their team. */
  teamId: z.string().min(1).max(64).nullable(),
});

/** Query value for "people with no team". */
export const NO_TEAM = "none";

export async function listTeams(orgId: string): Promise<TeamSummary[]> {
  const teams = await prisma.team.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      _count: { select: { members: { where: { removedAt: null } } } },
    },
  });
  return teams.map((team) => ({ id: team.id, name: team.name, color: team.color, memberCount: team._count.members }));
}

/**
 * Resolve a `?team=` value to the people it covers. Returns null for "all teams"
 * (or an unknown id from another workspace), so callers fall back to the whole org.
 */
export async function resolveTeamFilter(
  orgId: string,
  raw: string | null | undefined,
): Promise<{ teamId: string; name: string; developerIds: string[] } | null> {
  const value = raw?.trim();
  if (!value) return null;
  if (value === NO_TEAM) {
    const people = await prisma.developer.findMany({
      where: { orgId, removedAt: null, teamId: null },
      select: { id: true },
    });
    return { teamId: NO_TEAM, name: "No team", developerIds: people.map((person) => person.id) };
  }
  const team = await prisma.team.findFirst({
    where: { id: value, orgId },
    select: { id: true, name: true, members: { where: { removedAt: null }, select: { id: true } } },
  });
  if (!team) return null;
  return { teamId: team.id, name: team.name, developerIds: team.members.map((person) => person.id) };
}

/** Person id → team id (null when unassigned), for rolling per-person rows up by team. */
export async function teamByDeveloper(orgId: string): Promise<Map<string, string | null>> {
  const people = await prisma.developer.findMany({
    where: { orgId, removedAt: null },
    select: { id: true, teamId: true },
  });
  return new Map(people.map((person) => [person.id, person.teamId]));
}
