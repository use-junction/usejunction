import { prisma, type Prisma } from "@usejunction/db";

/** Action prefixes grouped the way an auditor asks: who changed access, money, data, or integrations. */
export const AUDIT_CATEGORIES = {
  access: ["member.", "invite.", "team_invite_link.", "domain.", "domain_join.", "workspace.", "team."],
  billing: ["billing.", "tools.", "api_credit_pool."],
  integrations: ["integration.", "github_identity.", "provider_api_key.", "telemetry_token."],
  privacy: ["privacy.", "consent.", "collection_notice.", "account_collection.", "retention.", "legal."],
  devices: ["device.", "sync_request.", "work_session.", "enrollment_token."],
  settings: ["activity_settings.", "signals_policy."],
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

export function isAuditCategory(value: string | null | undefined): value is AuditCategory {
  return Boolean(value && value in AUDIT_CATEGORIES);
}

export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  actor: { type: string; name: string | null; email: string | null };
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Prisma.JsonValue | null;
};

const PAGE_SIZE = 50;

/** Newest first, cursor-paginated by id within createdAt order. */
export async function readAuditLog(orgId: string, options: { category?: AuditCategory; cursor?: string | null } = {}) {
  const prefixes = options.category ? AUDIT_CATEGORIES[options.category] : null;
  const rows = await prisma.auditLog.findMany({
    where: {
      orgId,
      ...(prefixes ? { OR: prefixes.map((prefix) => ({ action: { startsWith: prefix } })) } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  const actorIds = [...new Set(page.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];
  const developerTargets = [...new Set(page.filter((row) => row.targetType === "developer" && row.targetId).map((row) => row.targetId!))];
  const [users, developers] = await Promise.all([
    actorIds.length ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [],
    developerTargets.length
      ? prisma.developer.findMany({ where: { orgId, id: { in: developerTargets } }, select: { id: true, name: true, email: true } })
      : [],
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const developerById = new Map(developers.map((developer) => [developer.id, developer]));

  const entries: AuditEntry[] = page.map((row) => {
    const user = row.actorId ? userById.get(row.actorId) : undefined;
    const developer = row.targetType === "developer" && row.targetId ? developerById.get(row.targetId) : undefined;
    const metadata = (row.metadata ?? null) as Prisma.JsonValue | null;
    const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
    const metaName = typeof meta?.name === "string" ? meta.name : typeof meta?.teamName === "string" ? meta.teamName : null;
    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      actor: {
        type: row.actorType,
        name: user?.name ?? null,
        email: user?.email ?? null,
      },
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: developer ? developer.name || developer.email : metaName,
      metadata,
    };
  });
  return { entries, nextCursor: rows.length > PAGE_SIZE ? page.at(-1)?.id ?? null : null };
}
