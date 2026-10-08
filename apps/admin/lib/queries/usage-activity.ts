import { Prisma, prisma } from "@usejunction/db";

/**
 * The one definition of "used an AI tool on a day": any requests, sessions, tokens or active time,
 * excluding productivity-only rows (line and commit counts), including legacy local sources stored
 * before metric_kind existed. Adoption, Cost and the member page all read seat use through this, so
 * a seat is never "used" on one page and "idle" on another.
 */
export const AI_USAGE_ACTIVITY_SQL = Prisma.sql`
  developer_id IS NOT NULL
  AND metric_kind <> 'productivity'
  AND source NOT IN ('cursor_local', 'opencode_local')
  AND (requests > 0 OR sessions > 0 OR input_tokens > 0 OR output_tokens > 0 OR active_seconds > 0)
`;

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Distinct (tool, person) pairs with AI-tool use between two UTC days, inclusive. */
export async function getToolUsers(
  orgId: string,
  from: Date,
  to: Date,
  options: { developerId?: string } = {},
): Promise<Array<{ toolName: string; developerId: string }>> {
  const developerFilter = options.developerId ? Prisma.sql`AND developer_id = ${options.developerId}` : Prisma.empty;
  return prisma.$queryRaw<Array<{ toolName: string; developerId: string }>>`
    SELECT DISTINCT tool_name AS "toolName", developer_id AS "developerId"
    FROM usage_daily
    WHERE org_id = ${orgId}
      AND date >= ${dayKey(from)}::date
      AND date <= ${dayKey(to)}::date
      AND ${AI_USAGE_ACTIVITY_SQL}
      ${developerFilter}
  `;
}
