import { createHash } from "node:crypto";
import { Prisma, prisma } from "@usejunction/db";
import { CHANGE_TYPES, workSpendWindow } from "@/lib/app-pages/work-spend-window";
import { cleanWorkTitle } from "@/lib/features/work-title";

const PAGE_SIZE = 25;
const STALLED_MS = 14 * 86_400_000;
const EXPORT_LIMIT = 5_000;
const TOP_SERIES = 4;
type Kind = "ticket" | "pull_request" | "commit";
type Sort = "activity" | "cost";
type WorkState = "shipped" | "in_flight" | "stalled";
type FeedInput = { orgId: string; days?: string | null; repositoryId?: string | null; projectId?: string | null; developerId?: string | null; q?: string | null; type?: string | null; sort?: string | null; cursor?: string | null; workState?: string | null };
type Cursor = { scope: string; at: string; id: string; cost?: string };

export class WorkFeedInputError extends Error {}

const PREFIX: Record<string, string> = {
  Features: "feat", Fixes: "fix", Refactoring: "refactor", Performance: "perf", Documentation: "docs",
  Tests: "test", "Build & dependencies": "build", CI: "ci", Maintenance: "chore", Formatting: "style", Reverts: "revert",
};
const ALL_PREFIXES = `^(${Object.values(PREFIX).join("|")})(\\([^)]*\\))?!?:[[:space:]]`;

function scopeKey(values: unknown[]) { return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 24); }
function readCursor(raw: string | null | undefined, scope: string): Cursor | null {
  if (!raw) return null;
  try {
    if (raw.length > 1800) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (value.scope !== scope || typeof value.id !== "string" || value.id.length > 500
      || typeof value.at !== "string" || !Number.isFinite(new Date(value.at).getTime())
      || (value.cost !== undefined && (typeof value.cost !== "string" || !/^\d{1,50}$/.test(value.cost)))) throw new Error();
    return value;
  } catch { throw new WorkFeedInputError("This work cursor is invalid or belongs to different filters. Reload the work list."); }
}
function cursorFor(scope: string, at: string, id: string, cost?: string) {
  return Buffer.from(JSON.stringify({ scope, at, id, ...(cost !== undefined ? { cost } : {}) })).toString("base64url");
}

function stalledBefore() {
  return new Date(Date.now() - STALLED_MS);
}

function workStateCase() {
  const before = stalledBefore();
  return Prisma.sql`CASE
    WHEN g.kind = 'pull_request' AND (upper(COALESCE(pr.state, '')) = 'MERGED' OR pr.merged_at IS NOT NULL) THEN 'shipped'
    WHEN g.kind = 'pull_request' AND pr.closed_at IS NOT NULL AND pr.merged_at IS NULL AND upper(COALESCE(pr.state, '')) <> 'MERGED' THEN 'stalled'
    WHEN g.activity_at < ${before} THEN 'stalled'
    ELSE 'in_flight'
  END`;
}

function parseWorkState(value: string | null | undefined): WorkState | null {
  if (!value) return null;
  if (value === "shipped" || value === "in_flight" || value === "stalled") return value;
  throw new WorkFeedInputError("Invalid work state.");
}

function parseDeveloperId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(value)) throw new WorkFeedInputError("Invalid person.");
  return value;
}

function applyTitle<T extends { title: string; kind: Kind; sha?: string | null; issue?: { title: string } | null; pullRequests?: Array<{ title: string }> }>(item: T) {
  const cleaned = cleanWorkTitle({
    title: item.title,
    kind: item.kind,
    sha: item.sha,
    issueTitle: item.issue?.title,
    pullRequestTitle: item.pullRequests?.[0]?.title,
  });
  return { ...item, title: cleaned.title, originalTitle: cleaned.originalTitle };
}

function mapFeedItem(item: RawWork) {
  const { sortCost: _cost, ...rest } = item as RawWork & { sortCost?: string };
  return applyTitle({
    ...rest,
    activityAt: new Date(item.activityAt).toISOString(),
    sha: item.sha ?? undefined,
    ticketKey: item.ticketKey ?? null,
    ticketSource: item.ticketSource ?? null,
    commitCount: Number(item.commitCount ?? 0),
    projectLinks: item.projectLinks ?? [],
    pullRequests: item.pullRequests ?? [],
    issue: item.issue ?? null,
  });
}

/** Canonical membership is shared by list, filters, and evidence. Every allocation
 * belongs to one repository/ticket, unticketed PR, or standalone commit. */
function workBase(orgId: string, days: string | null | undefined, repositoryId?: string | null) {
  const { from, to, endExclusive } = workSpendWindow(days);
  return Prisma.sql`
    WITH granted AS (
      SELECT DISTINCT ON (r.id) r.id, r.owner, r.name, a.connection_id
      FROM github_repository_accesses a JOIN repositories r ON r.id = a.repository_id
      JOIN provider_connections pc ON pc.id = a.connection_id
      WHERE a.org_id = ${orgId} AND r.org_id = ${orgId} AND pc.org_id = ${orgId}
        AND pc.provider = 'github' AND pc.status <> 'disconnected'
        ${repositoryId ? Prisma.sql`AND r.id = ${repositoryId}` : Prisma.empty}
      ORDER BY r.id, a.granted_at DESC, a.connection_id
    ), scoped_commits AS (
      SELECT c.*
      FROM git_commits c JOIN granted r ON r.id = c.repository_id
      WHERE c.org_id = ${orgId} AND c.is_bot = false AND c.authored_at >= ${from} AND c.authored_at < ${endExclusive}
    ), work_commits AS (
      SELECT c.*, CASE WHEN pull_request_id IS NOT NULL THEN 'pull_request' ELSE 'commit' END AS kind,
        COALESCE(pull_request_id, id) AS work_id
      FROM scoped_commits c
    ), active_prs AS (
      SELECT p.*, GREATEST(
        CASE WHEN p.github_created_at >= ${from} AND p.github_created_at < ${endExclusive} THEN p.github_created_at END,
        CASE WHEN p.merged_at >= ${from} AND p.merged_at < ${endExclusive} THEN p.merged_at END,
        CASE WHEN p.closed_at >= ${from} AND p.closed_at < ${endExclusive} THEN p.closed_at END,
        (SELECT MAX(c.authored_at) FROM scoped_commits c WHERE c.pull_request_id = p.id)
      ) AS activity_at
      FROM git_pull_requests p JOIN granted r ON r.id = p.repository_id AND r.connection_id = p.connection_id
      WHERE p.org_id = ${orgId}
    ), owned_allocations AS (
      SELECT a.*, CASE WHEN COALESCE(a.pull_request_id, c.pull_request_id) IS NOT NULL THEN 'pull_request' ELSE 'commit' END AS kind,
        COALESCE(a.pull_request_id, c.pull_request_id, c.id, a.commit_sha) AS work_id
      FROM feature_cost_allocations a JOIN granted r ON r.id = a.repository_id
      LEFT JOIN git_commits c ON c.repository_id = a.repository_id AND c.sha = a.commit_sha AND c.org_id = ${orgId}
      WHERE a.org_id = ${orgId} AND a.date >= ${from} AND a.date <= ${to} AND a.method <> 'unattributed'
        AND a.cost_kind IN ('verified_usage', 'estimated_api')
    ), sources AS (
      SELECT repository_id, kind, work_id, authored_at AS activity_at FROM work_commits
      UNION ALL
      SELECT p.repository_id, 'pull_request', p.id, p.activity_at
      FROM active_prs p WHERE p.activity_at IS NOT NULL AND (
        NOT EXISTS (SELECT 1 FROM scoped_commits c WHERE c.pull_request_id = p.id)
      )
      UNION ALL
      SELECT repository_id, kind, work_id, date::timestamp FROM owned_allocations WHERE work_id IS NOT NULL
    ), groups AS (
      SELECT repository_id, kind, work_id, MAX(activity_at) AS activity_at,
        repository_id || ':' || kind || ':' || work_id AS canonical_id
      FROM sources GROUP BY repository_id, kind, work_id
    ), group_prs AS (
      SELECT DISTINCT g.canonical_id, p.id, p.number, p.title, p.state, p.url, p.author_login, p.github_created_at, p.closing_issues
      FROM groups g JOIN active_prs p ON p.repository_id = g.repository_id AND p.id = g.work_id
      WHERE g.kind = 'pull_request'
    ), project_item_matches AS (
      SELECT DISTINCT g.canonical_id, p.id AS project_id, p.title AS project_title, p.url AS project_url,
        i.title, i.status, i.url,
        CASE
          WHEN i.content_type = 'PullRequest' AND EXISTS (SELECT 1 FROM group_prs pr WHERE pr.canonical_id = g.canonical_id AND pr.number = i.number) THEN 'project_pr'
          WHEN EXISTS (SELECT 1 FROM group_prs pr, jsonb_array_elements(pr.closing_issues) ref
            WHERE pr.canonical_id = g.canonical_id AND lower(ref->>'url') = lower(i.url)) THEN 'closing_reference'
          WHEN EXISTS (SELECT 1 FROM group_prs pr WHERE pr.canonical_id = g.canonical_id AND pr.title ~ ref.issue_number)
            OR EXISTS (SELECT 1 FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id AND c.message_headline ~ ref.issue_number)
            THEN 'issue_number'
        END AS matched_by,
        ('#' || i.number::text) AS match_reference,
        NULL::int AS match_position,
        NULL::int AS match_total
      FROM groups g JOIN granted r ON r.id = g.repository_id
      JOIN github_project_items i ON i.repository_id = g.repository_id AND i.org_id = ${orgId}
      JOIN github_projects p ON p.id = i.project_id AND p.org_id = ${orgId} AND p.connection_id = r.connection_id
      CROSS JOIN LATERAL (SELECT '(^|[^0-9A-Za-z])#' || i.number::text || '([^0-9]|$)' AS issue_number) ref
      WHERE i.content_type IN ('Issue', 'PullRequest')
    ), explicit_item_hits AS (
      SELECT * FROM project_item_matches WHERE matched_by IS NOT NULL
    ), wi_ranked AS (
      SELECT i.project_id, i.repository_id, i.title, i.status, i.url,
        row_number() OVER (
          PARTITION BY i.project_id, i.repository_id
          ORDER BY (substring(i.title from '^WI-([0-9]+)'))::int, i.number
        ) AS wi_i,
        count(*) OVER (PARTITION BY i.project_id, i.repository_id) AS wi_n
      FROM github_project_items i
      WHERE i.org_id = ${orgId} AND i.content_type = 'Issue'
        AND substring(i.title from '^WI-([0-9]+)') IS NOT NULL
    ), unclaimed_groups AS (
      SELECT g.canonical_id, g.repository_id,
        row_number() OVER (PARTITION BY g.repository_id ORDER BY activity.at NULLS LAST, g.canonical_id) AS grp_i,
        count(*) OVER (PARTITION BY g.repository_id) AS grp_n
      FROM groups g
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          (SELECT MIN(c.authored_at) FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id),
          (SELECT MIN(pr.github_created_at) FROM group_prs pr WHERE pr.canonical_id = g.canonical_id)
        ) AS at
      ) activity
      WHERE NOT EXISTS (SELECT 1 FROM explicit_item_hits h WHERE h.canonical_id = g.canonical_id)
    ), timeline_hits AS (
      SELECT g.canonical_id, w.project_id, p.title AS project_title, p.url AS project_url,
        w.title, w.status, w.url, 'timeline'::text AS matched_by,
        substring(w.title from '^WI-[0-9]+') AS match_reference,
        g.grp_i::int AS match_position, g.grp_n::int AS match_total
      FROM unclaimed_groups g
      JOIN granted r ON r.id = g.repository_id
      JOIN wi_ranked w ON w.repository_id = g.repository_id
        AND w.wi_i = LEAST(w.wi_n, GREATEST(1, ROUND(g.grp_i * w.wi_n::numeric / g.grp_n)::int))
      JOIN github_projects p ON p.id = w.project_id AND p.org_id = ${orgId} AND p.connection_id = r.connection_id
        AND p.attribution_mode = 'wi_order'
    ), project_item_hits AS (
      SELECT * FROM explicit_item_hits
      UNION ALL
      SELECT * FROM timeline_hits
    ), project_repo_matches AS (
      SELECT DISTINCT g.canonical_id, p.id AS project_id, p.title AS project_title, p.url AS project_url,
        p.title AS title, NULL::text AS status, p.url AS url, 'repository'::text AS matched_by,
        NULL::text AS match_reference, NULL::int AS match_position, NULL::int AS match_total
      FROM groups g JOIN granted r ON r.id = g.repository_id
      JOIN github_project_items i ON i.repository_id = g.repository_id AND i.org_id = ${orgId}
      JOIN github_projects p ON p.id = i.project_id AND p.org_id = ${orgId} AND p.connection_id = r.connection_id
      WHERE NOT EXISTS (
        SELECT 1 FROM project_item_hits pm WHERE pm.canonical_id = g.canonical_id AND pm.project_id = p.id
      )
    ), project_matches AS (
      SELECT canonical_id, project_id, project_title, project_url, title, status, url, matched_by, match_reference, match_position, match_total FROM project_item_hits
      UNION ALL
      SELECT canonical_id, project_id, project_title, project_url, title, status, url, matched_by, match_reference, match_position, match_total FROM project_repo_matches
    ), group_costs AS (
      SELECT repository_id, kind, work_id,
        COALESCE(SUM(cost_micros) FILTER (WHERE cost_kind = 'verified_usage'), 0)::bigint AS verified,
        COALESCE(SUM(cost_micros) FILTER (WHERE cost_kind = 'estimated_api'), 0)::bigint AS estimated,
        CASE WHEN COUNT(DISTINCT ticket_key_source) > 1 THEN 'mixed' ELSE MAX(ticket_key_source) END AS ticket_source
      FROM owned_allocations WHERE work_id IS NOT NULL GROUP BY repository_id, kind, work_id
    )
  `;
}

function projectLinksJson() {
  return Prisma.sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'projectId', pm.project_id, 'projectTitle', pm.project_title, 'projectUrl', pm.project_url,
    'title', pm.title, 'status', pm.status, 'url', pm.url, 'matchedBy', pm.matched_by,
    'position', pm.match_position, 'total', pm.match_total, 'reference', pm.match_reference
  ) ORDER BY pm.project_title, pm.project_id, pm.url)
    FROM project_matches pm WHERE pm.canonical_id = g.canonical_id), '[]'::jsonb)`;
}

export type AttributionMode = "wi_order" | "named_only";
export type AttributionMethod = "named" | "wi_order" | "mixed";
export type AttributionReason = {
  matchedBy: string;
  position?: number;
  total?: number;
  reference?: string;
};
export type ProjectLink = {
  projectId: string; projectTitle: string; projectUrl: string; title: string; status: string | null; url: string;
  matchedBy: string; position?: number | null; total?: number | null; reference?: string | null;
};

function parseAttributionMode(value: string | null | undefined): AttributionMode {
  return value === "named_only" ? "named_only" : "wi_order";
}

function reasonForMatch(item: { projectLinks?: ProjectLink[] }, projectId: string, taskUrl: string): AttributionReason | undefined {
  const links = item.projectLinks ?? [];
  const link = links.find((row) => row.projectId === projectId && row.url === taskUrl)
    ?? links.find((row) => row.projectId === projectId && row.matchedBy !== "repository");
  if (!link) return undefined;
  const position = link.position == null ? undefined : Number(link.position);
  const total = link.total == null ? undefined : Number(link.total);
  return {
    matchedBy: link.matchedBy,
    ...(Number.isFinite(position) ? { position } : {}),
    ...(Number.isFinite(total) ? { total } : {}),
    ...(link.reference ? { reference: link.reference } : {}),
  };
}

type RawWork = {
  id: string; workId: string; kind: Kind; repository: { id: string; owner: string; name: string; fullName: string };
  title: string; state: string | null; workState: WorkState; url: string | null; ticketKey: string | null; ticketSource: string | null;
  authorLogin: string | null; activityAt: string; commitCount: number; sha?: string | null;
  verifiedMicros: string; estimatedMicros: string; sortCost: string;
  issue: { title: string; status: string; url: string } | null;
  projectLinks: ProjectLink[];
  pullRequests: Array<{ id: string; title: string; state: string; url: string | null }>;
};

export async function loadWorkSpendFeed(input: FeedInput) {
  const q = input.q?.trim() ?? "";
  const type = input.type === "Unclassified" ? "No recognized prefix" : input.type || "all";
  const sort: Sort = input.sort === "cost" ? "cost" : "activity";
  const workState = parseWorkState(input.workState);
  const developerId = parseDeveloperId(input.developerId);
  if (q.length > 200 || (input.sort && !["cost", "activity"].includes(input.sort))
    || (type !== "all" && !CHANGE_TYPES.includes(type as typeof CHANGE_TYPES[number]))) throw new WorkFeedInputError("Invalid work search or filter.");
  const window = workSpendWindow(input.days);
  const scope = scopeKey([input.orgId, window.from, window.to, input.repositoryId || null, input.projectId || null, developerId, q, type, sort, workState]);
  const cursor = readCursor(input.cursor, scope);
  if (cursor && sort === "cost" && cursor.cost === undefined) throw new WorkFeedInputError("Invalid cost cursor.");
  const pattern = type === "No recognized prefix" ? ALL_PREFIXES : `^${PREFIX[type]}(\\([^)]*\\))?!?:[[:space:]]`;
  const category = type === "all" ? Prisma.empty : Prisma.sql`AND EXISTS (
    SELECT 1 FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id
      AND ${type === "No recognized prefix" ? Prisma.sql`NOT (c.message_headline ~* ${pattern})` : Prisma.sql`c.message_headline ~* ${pattern}`}
  )`;
  const seek = !cursor ? Prisma.empty : sort === "cost" ? Prisma.sql`AND (
    sort_cost < ${BigInt(cursor.cost!)} OR (sort_cost = ${BigInt(cursor.cost!)} AND (
      activity_at < ${new Date(cursor.at)} OR (activity_at = ${new Date(cursor.at)} AND canonical_id > ${cursor.id})
    ))
  )` : Prisma.sql`AND (activity_at < ${new Date(cursor.at)} OR (activity_at = ${new Date(cursor.at)} AND canonical_id > ${cursor.id}))`;
  const order = sort === "cost" ? Prisma.sql`sort_cost DESC, activity_at DESC, canonical_id ASC` : Prisma.sql`activity_at DESC, canonical_id ASC`;
  const result = await prisma.$queryRaw<Array<{ totalCount: bigint; items: RawWork[] }>>(Prisma.sql`
    ${workBase(input.orgId, input.days, input.repositoryId)}
    , filtered AS (
      SELECT g.*, r.owner, r.name, COALESCE(cost.verified, 0) AS verified, COALESCE(cost.estimated, 0) AS estimated,
        COALESCE(cost.verified, 0) + COALESCE(cost.estimated, 0) AS sort_cost, cost.ticket_source,
        ${workStateCase()} AS work_state
      FROM groups g JOIN granted r ON r.id = g.repository_id
      LEFT JOIN group_costs cost ON cost.repository_id = g.repository_id AND cost.kind = g.kind AND cost.work_id = g.work_id
      LEFT JOIN active_prs pr ON g.kind = 'pull_request' AND pr.id = g.work_id
      WHERE true ${category}
        ${workState ? Prisma.sql`AND ${workStateCase()} = ${workState}` : Prisma.empty}
        ${input.projectId === "__none__" ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM project_matches pm WHERE pm.canonical_id = g.canonical_id)`
          : input.projectId ? Prisma.sql`AND EXISTS (SELECT 1 FROM project_matches pm WHERE pm.canonical_id = g.canonical_id AND pm.project_id = ${input.projectId})` : Prisma.empty}
        ${developerId ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM owned_allocations a
          WHERE a.repository_id = g.repository_id AND a.kind = g.kind AND a.work_id = g.work_id AND a.developer_id = ${developerId}
        )` : Prisma.empty}
        ${q ? Prisma.sql`AND (
          position(lower(${q}) in lower(r.owner || '/' || r.name || ' ' || g.work_id)) > 0
          OR EXISTS (SELECT 1 FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id
            AND position(lower(${q}) in lower(c.message_headline || ' ' || COALESCE(c.author_login, ''))) > 0)
          OR EXISTS (SELECT 1 FROM group_prs p WHERE p.canonical_id = g.canonical_id AND position(lower(${q}) in lower(p.title || ' ' || COALESCE(p.author_login, ''))) > 0)
          OR EXISTS (SELECT 1 FROM project_matches pm WHERE pm.canonical_id = g.canonical_id AND position(lower(${q}) in lower(pm.title)) > 0)
        )` : Prisma.empty}
    ), page AS (SELECT * FROM filtered WHERE true ${seek} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1}),
    hydrated AS (
      SELECT g.canonical_id AS id, g.work_id AS "workId", g.kind,
        jsonb_build_object('id', g.repository_id, 'owner', g.owner, 'name', g.name, 'fullName', g.owner || '/' || g.name) AS repository,
        CASE WHEN g.kind = 'pull_request' THEN COALESCE(pr.title, g.work_id) ELSE COALESCE(commit.message_headline, g.work_id) END AS title,
        CASE WHEN g.kind = 'pull_request' THEN pr.state END AS state,
        g.work_state AS "workState",
        CASE WHEN g.kind = 'pull_request' THEN pr.url
          ELSE 'https://github.com/' || g.owner || '/' || g.name || '/commit/' || commit.sha END AS url,
        NULL::text AS "ticketKey", g.ticket_source AS "ticketSource",
        COALESCE(pr.author_login, commit.author_login) AS "authorLogin", g.activity_at AS "activityAt",
        (SELECT COUNT(*)::int FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id) AS "commitCount",
        CASE WHEN g.kind = 'commit' THEN commit.sha END AS sha,
        g.verified::text AS "verifiedMicros", g.estimated::text AS "estimatedMicros", g.sort_cost::text AS "sortCost",
        CASE WHEN issue.title IS NOT NULL THEN jsonb_build_object('title', issue.title, 'status', COALESCE(issue.status, 'Unknown'), 'url', issue.url) END AS issue,
        ${projectLinksJson()} AS "projectLinks",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'state', p.state, 'url', p.url) ORDER BY p.github_created_at DESC, p.id)
          FROM group_prs p WHERE p.canonical_id = g.canonical_id), '[]'::jsonb) AS "pullRequests",
        g.sort_cost, g.activity_at, g.canonical_id
      FROM page g
      LEFT JOIN LATERAL (SELECT p.* FROM group_prs p WHERE p.canonical_id = g.canonical_id ORDER BY p.github_created_at DESC, p.id LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT c.* FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id ORDER BY c.authored_at DESC, c.id LIMIT 1) commit ON true
      LEFT JOIN LATERAL (SELECT pm.* FROM project_matches pm WHERE pm.canonical_id = g.canonical_id AND pm.matched_by NOT IN ('project_pr', 'repository') ORDER BY pm.project_title, pm.project_id, pm.url LIMIT 1) issue ON true
    )
    SELECT (SELECT COUNT(*) FROM filtered) AS "totalCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(h) - 'sort_cost' - 'activity_at' - 'canonical_id' ORDER BY ${order}) FROM hydrated h), '[]'::jsonb) AS items
  `);
  const raw = result[0]?.items ?? [];
  const shown = raw.slice(0, PAGE_SIZE);
  const last = shown[shown.length - 1];
  return {
    items: shown.map((item) => mapFeedItem(item)),
    totalCount: Number(result[0]?.totalCount ?? 0),
    nextCursor: raw.length > PAGE_SIZE && last ? cursorFor(scope, new Date(last.activityAt).toISOString(), last.id, sort === "cost" ? last.sortCost : undefined) : null,
  };
}

export async function loadWorkSpendDetails(input: {
  orgId: string; repositoryId: string; kind: string; workId: string; days?: string | null; cursor?: string | null; evidenceCursor?: string | null;
}) {
  if (!["ticket", "pull_request", "commit"].includes(input.kind) || !input.workId || input.workId.length > 200 || !input.repositoryId) throw new WorkFeedInputError("Invalid work item.");
  const window = workSpendWindow(input.days);
  const scope = scopeKey([input.orgId, input.repositoryId, input.kind, input.workId, window.from, window.to]);
  const cursor = readCursor(input.cursor, `${scope}:commits`);
  const evidenceCursor = readCursor(input.evidenceCursor, `${scope}:evidence`);
  const result = await prisma.$queryRaw<Array<{ found: boolean; commits: Array<{ id: string; sha: string; title: string; url: string; authorLogin: string | null; activityAt: string }>; evidence: Array<{ id: string; date: string; developerName: string; costKind: string; costMicros: string; weight: number; method: string; ticketSource: string | null }> }>>(Prisma.sql`
    ${workBase(input.orgId, input.days, input.repositoryId)}
    , target AS (SELECT * FROM groups WHERE repository_id = ${input.repositoryId} AND kind = ${input.kind} AND work_id = ${input.workId}),
    commits_page AS (
      SELECT c.id, c.sha, c.message_headline AS title, 'https://github.com/' || r.owner || '/' || r.name || '/commit/' || c.sha AS url,
        c.author_login AS "authorLogin", c.authored_at AS "activityAt"
      FROM work_commits c JOIN target g ON g.repository_id = c.repository_id AND g.kind = c.kind AND g.work_id = c.work_id
      JOIN granted r ON r.id = c.repository_id
      WHERE true ${cursor ? Prisma.sql`AND (c.authored_at < ${new Date(cursor.at)} OR (c.authored_at = ${new Date(cursor.at)} AND c.id > ${cursor.id}))` : Prisma.empty}
      ORDER BY c.authored_at DESC, c.id ASC LIMIT ${PAGE_SIZE + 1}
    ), evidence_page AS (
      SELECT a.id, a.date::text AS date, COALESCE(d.name, 'Former workspace member') AS "developerName", a.cost_kind AS "costKind",
        a.cost_micros::text AS "costMicros", a.weight, a.method, a.ticket_key_source AS "ticketSource"
      FROM owned_allocations a JOIN target g ON g.repository_id = a.repository_id AND g.kind = a.kind AND g.work_id = a.work_id
      LEFT JOIN users d ON d.id = a.developer_id AND d.org_id = ${input.orgId}
      WHERE true ${evidenceCursor ? Prisma.sql`AND (a.date < ${new Date(evidenceCursor.at)} OR (a.date = ${new Date(evidenceCursor.at)} AND a.id > ${evidenceCursor.id}))` : Prisma.empty}
      ORDER BY a.date DESC, a.id ASC LIMIT ${PAGE_SIZE + 1}
    )
    SELECT EXISTS (SELECT 1 FROM target) AS found,
      COALESCE((SELECT jsonb_agg(c ORDER BY "activityAt" DESC, id ASC) FROM commits_page c), '[]'::jsonb) AS commits,
      COALESCE((SELECT jsonb_agg(e ORDER BY date DESC, id ASC) FROM evidence_page e), '[]'::jsonb) AS evidence
  `);
  const row = result[0];
  if (!row?.found) return null;
  const commits = row.commits.slice(0, PAGE_SIZE).map((commit) => ({ ...commit, activityAt: new Date(commit.activityAt).toISOString() }));
  const evidence = row.evidence.slice(0, PAGE_SIZE);
  const lastCommit = commits[commits.length - 1];
  const lastEvidence = evidence[evidence.length - 1];
  return {
    commits,
    nextCursor: row.commits.length > PAGE_SIZE && lastCommit ? cursorFor(`${scope}:commits`, lastCommit.activityAt, lastCommit.id) : null,
    evidence: evidence.map(({ id: _id, ...item }) => item),
    evidenceNextCursor: row.evidence.length > PAGE_SIZE && lastEvidence ? cursorFor(`${scope}:evidence`, `${lastEvidence.date}T00:00:00.000Z`, lastEvidence.id) : null,
  };
}

/** Aggregate canonical work once per Project. Project totals can overlap, but a
 * work group matching several items in the same Project is never counted twice. */
export async function loadWorkSpendDistribution(input: { orgId: string; days?: string | null }) {
  const empty = {
    projects: [], withoutProjectMicros: "0", withoutShippedMicros: "0", withoutInFlightMicros: "0",
    withoutStalledMicros: "0", overlappingMicros: "0",
  };
  const rows = await prisma.$queryRaw<Array<{
    projects: Array<{
      id: string; title: string; url: string; workCount: number; verifiedMicros: string; estimatedMicros: string;
      shippedMicros: string; inFlightMicros: string; stalledMicros: string;
    }>;
    withoutProjectMicros: string; withoutShippedMicros: string; withoutInFlightMicros: string; withoutStalledMicros: string;
    overlappingMicros: string;
  }>>(Prisma.sql`
    ${workBase(input.orgId, input.days)}
    , membership AS (SELECT DISTINCT canonical_id, project_id FROM project_matches),
    costed_work AS (
      SELECT g.canonical_id, COALESCE(c.verified, 0) AS verified, COALESCE(c.estimated, 0) AS estimated,
        ${workStateCase()} AS work_state
      FROM groups g
      LEFT JOIN group_costs c ON c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id
      LEFT JOIN active_prs pr ON g.kind = 'pull_request' AND pr.id = g.work_id
    ), project_totals AS (
      SELECT p.id, p.title, p.url, COUNT(w.canonical_id)::int AS "workCount",
        COALESCE(SUM(w.verified), 0)::text AS "verifiedMicros", COALESCE(SUM(w.estimated), 0)::text AS "estimatedMicros",
        COALESCE(SUM(CASE WHEN w.work_state = 'shipped' THEN w.verified + w.estimated ELSE 0 END), 0)::text AS "shippedMicros",
        COALESCE(SUM(CASE WHEN w.work_state = 'in_flight' THEN w.verified + w.estimated ELSE 0 END), 0)::text AS "inFlightMicros",
        COALESCE(SUM(CASE WHEN w.work_state = 'stalled' THEN w.verified + w.estimated ELSE 0 END), 0)::text AS "stalledMicros",
        COALESCE(SUM(w.verified + w.estimated), 0) AS cost
      FROM github_projects p JOIN provider_connections pc ON pc.id = p.connection_id AND pc.org_id = ${input.orgId} AND pc.provider = 'github' AND pc.status <> 'disconnected'
      LEFT JOIN membership m ON m.project_id = p.id LEFT JOIN costed_work w ON w.canonical_id = m.canonical_id
      WHERE p.org_id = ${input.orgId} GROUP BY p.id, p.title, p.url
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'cost' ORDER BY cost DESC, title ASC, id ASC) FROM project_totals p), '[]'::jsonb) AS projects,
      COALESCE((SELECT SUM(verified + estimated) FROM costed_work w WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.canonical_id = w.canonical_id)), 0)::text AS "withoutProjectMicros",
      COALESCE((SELECT SUM(CASE WHEN work_state = 'shipped' THEN verified + estimated ELSE 0 END) FROM costed_work w WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.canonical_id = w.canonical_id)), 0)::text AS "withoutShippedMicros",
      COALESCE((SELECT SUM(CASE WHEN work_state = 'in_flight' THEN verified + estimated ELSE 0 END) FROM costed_work w WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.canonical_id = w.canonical_id)), 0)::text AS "withoutInFlightMicros",
      COALESCE((SELECT SUM(CASE WHEN work_state = 'stalled' THEN verified + estimated ELSE 0 END) FROM costed_work w WHERE NOT EXISTS (SELECT 1 FROM membership m WHERE m.canonical_id = w.canonical_id)), 0)::text AS "withoutStalledMicros",
      COALESCE((SELECT SUM(verified + estimated) FROM costed_work w WHERE (SELECT COUNT(*) FROM membership m WHERE m.canonical_id = w.canonical_id) > 1), 0)::text AS "overlappingMicros"
  `);
  return rows[0] ?? empty;
}

export type ProjectInspectionTask = {
  id: string;
  title: string;
  status: string | null;
  url: string;
  number: number;
  repository: { id: string; owner: string; name: string; fullName: string };
  verifiedMicros: string;
  estimatedMicros: string;
  method: AttributionMethod;
  matches: Array<ReturnType<typeof mapFeedItem> & { reason?: AttributionReason }>;
};

export type ProjectInspection = {
  id: string;
  title: string;
  url: string;
  days: number;
  workCount: number;
  verifiedMicros: string;
  estimatedMicros: string;
  shippedMicros: string;
  inFlightMicros: string;
  stalledMicros: string;
  attributionMode: AttributionMode;
  wiTaskCount: number;
  methodMicros: { named: string; wiOrder: string; untasked: string };
  /** Spend by outcome. Only pull requests can merge, so direct commits get their own bucket with no outcome claim. */
  outcomeMicros: { mergedPr: string; openPr: string; idlePr: string; closedPr: string; directCommit: string };
  tasks: ProjectInspectionTask[];
  pullRequests: ReturnType<typeof mapFeedItem>[];
  pullRequestCount: number;
  commits: ReturnType<typeof mapFeedItem>[];
  commitCount: number;
};

function parseProjectId(value: string | null | undefined) {
  if (!value || value === "__none__") return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new WorkFeedInputError("Invalid project.");
  return value;
}

export function parseProjectAttributionMode(value: unknown): AttributionMode {
  if (value === "named_only" || value === "wi_order") return value;
  throw new WorkFeedInputError("Attribution must be named_only or wi_order.");
}

export async function updateProjectAttributionMode(input: { orgId: string; projectId: string; attributionMode: AttributionMode }) {
  const projectId = parseProjectId(input.projectId);
  if (!projectId) throw new WorkFeedInputError("Invalid project.");
  const result = await prisma.gitHubProject.updateMany({
    where: { id: projectId, orgId: input.orgId },
    data: { attributionMode: input.attributionMode },
  });
  return result.count > 0;
}

/** One GitHub Project: board cost plus its issues, pull requests, and commits. */
export async function loadProjectInspection(input: { orgId: string; projectId: string; days?: string | null }): Promise<ProjectInspection | null> {
  const projectId = parseProjectId(input.projectId);
  if (!projectId) return null;
  const { days } = workSpendWindow(input.days);
  const rows = await prisma.$queryRaw<Array<{
    found: boolean;
    title: string | null;
    url: string | null;
    attributionMode: string | null;
    wiTaskCount: number;
    workCount: number;
    verifiedMicros: string;
    estimatedMicros: string;
    shippedMicros: string;
    inFlightMicros: string;
    stalledMicros: string;
    methodMicros: { named: string; wiOrder: string; untasked: string };
    outcomeMicros: { mergedPr: string; openPr: string; idlePr: string; closedPr: string; directCommit: string };
    tasks: Array<Omit<ProjectInspectionTask, "matches"> & { matches: RawWork[] }>;
    pullRequests: RawWork[];
    pullRequestCount: number;
    commits: RawWork[];
    commitCount: number;
  }>>(Prisma.sql`
    ${workBase(input.orgId, input.days)}
    , costed_work AS (
      SELECT g.repository_id, g.kind, g.work_id, g.activity_at, g.canonical_id, r.owner, r.name,
        COALESCE(cost.verified, 0) AS verified, COALESCE(cost.estimated, 0) AS estimated,
        COALESCE(cost.verified, 0) + COALESCE(cost.estimated, 0) AS sort_cost, cost.ticket_source,
        ${workStateCase()} AS work_state,
        (g.kind = 'pull_request' AND pr.closed_at IS NOT NULL AND pr.merged_at IS NULL AND upper(COALESCE(pr.state, '')) <> 'MERGED') AS closed_unmerged
      FROM groups g JOIN granted r ON r.id = g.repository_id
      LEFT JOIN group_costs cost ON cost.repository_id = g.repository_id AND cost.kind = g.kind AND cost.work_id = g.work_id
      LEFT JOIN active_prs pr ON g.kind = 'pull_request' AND pr.id = g.work_id
    ), project_work AS (
      SELECT * FROM costed_work g
      WHERE EXISTS (SELECT 1 FROM project_matches pm WHERE pm.canonical_id = g.canonical_id AND pm.project_id = ${projectId})
    ), hydrated AS (
      SELECT g.canonical_id AS id, g.work_id AS "workId", g.kind,
        jsonb_build_object('id', g.repository_id, 'owner', g.owner, 'name', g.name, 'fullName', g.owner || '/' || g.name) AS repository,
        CASE WHEN g.kind = 'pull_request' THEN COALESCE(pr.title, g.work_id) ELSE COALESCE(commit.message_headline, g.work_id) END AS title,
        CASE WHEN g.kind = 'pull_request' THEN pr.state END AS state,
        g.work_state AS "workState",
        CASE WHEN g.kind = 'pull_request' THEN pr.url
          ELSE 'https://github.com/' || g.owner || '/' || g.name || '/commit/' || commit.sha END AS url,
        NULL::text AS "ticketKey", g.ticket_source AS "ticketSource",
        COALESCE(pr.author_login, commit.author_login) AS "authorLogin", g.activity_at AS "activityAt",
        (SELECT COUNT(*)::int FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id) AS "commitCount",
        CASE WHEN g.kind = 'commit' THEN commit.sha END AS sha,
        g.verified::text AS "verifiedMicros", g.estimated::text AS "estimatedMicros",
        CASE WHEN issue.title IS NOT NULL THEN jsonb_build_object('title', issue.title, 'status', COALESCE(issue.status, 'Unknown'), 'url', issue.url) END AS issue,
        ${projectLinksJson()} AS "projectLinks",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'state', p.state, 'url', p.url) ORDER BY p.github_created_at DESC, p.id)
          FROM group_prs p WHERE p.canonical_id = g.canonical_id), '[]'::jsonb) AS "pullRequests",
        g.sort_cost, g.activity_at, g.canonical_id
      FROM project_work g
      LEFT JOIN LATERAL (SELECT p.* FROM group_prs p WHERE p.canonical_id = g.canonical_id ORDER BY p.github_created_at DESC, p.id LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT c.* FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id ORDER BY c.authored_at DESC, c.id LIMIT 1) commit ON true
      LEFT JOIN LATERAL (SELECT pm.* FROM project_matches pm WHERE pm.canonical_id = g.canonical_id AND pm.matched_by NOT IN ('project_pr', 'repository') ORDER BY pm.project_title, pm.project_id, pm.url LIMIT 1) issue ON true
    ), issue_hits AS (
      SELECT canonical_id, url, matched_by FROM project_item_hits WHERE project_id = ${projectId}
    ), task_rows AS (
      SELECT i.repository_id || ':' || i.number::text AS id, i.title, i.status, i.url, i.number,
        jsonb_build_object('id', i.repository_id, 'owner', r.owner, 'name', r.name, 'fullName', r.owner || '/' || r.name) AS repository,
        COALESCE(SUM(h."verifiedMicros"::bigint), 0)::text AS "verifiedMicros",
        COALESCE(SUM(h."estimatedMicros"::bigint), 0)::text AS "estimatedMicros",
        COALESCE(SUM(h.sort_cost), 0) AS sort_cost,
        CASE
          WHEN bool_or(hit.matched_by = 'timeline') AND bool_or(hit.matched_by IN ('closing_reference', 'issue_number', 'project_pr')) THEN 'mixed'
          WHEN bool_or(hit.matched_by = 'timeline') THEN 'wi_order'
          ELSE 'named'
        END AS method,
        COALESCE(jsonb_agg(to_jsonb(h) - 'sort_cost' - 'activity_at' - 'canonical_id' ORDER BY h.sort_cost DESC, h.activity_at DESC, h.id)
          FILTER (WHERE h.id IS NOT NULL), '[]'::jsonb) AS matches
      FROM github_project_items i
      JOIN granted r ON r.id = i.repository_id
      LEFT JOIN issue_hits hit ON hit.url = i.url
      LEFT JOIN hydrated h ON h.canonical_id = hit.canonical_id
      WHERE i.org_id = ${input.orgId} AND i.project_id = ${projectId} AND i.content_type = 'Issue'
      GROUP BY i.repository_id, i.number, i.title, i.status, i.url, r.owner, r.name
    ), strongest AS (
      SELECT DISTINCT ON (g.canonical_id) g.canonical_id, g.verified, g.estimated, pm.matched_by
      FROM project_work g
      LEFT JOIN project_matches pm ON pm.canonical_id = g.canonical_id AND pm.project_id = ${projectId}
      ORDER BY g.canonical_id, CASE pm.matched_by
        WHEN 'closing_reference' THEN 1
        WHEN 'issue_number' THEN 2
        WHEN 'project_pr' THEN 3
        WHEN 'timeline' THEN 4
        ELSE 5
      END
    )
    SELECT
      EXISTS (
        SELECT 1 FROM github_projects p
        JOIN provider_connections pc ON pc.id = p.connection_id AND pc.org_id = ${input.orgId} AND pc.provider = 'github' AND pc.status <> 'disconnected'
        WHERE p.id = ${projectId} AND p.org_id = ${input.orgId}
      ) AS found,
      (SELECT p.title FROM github_projects p WHERE p.id = ${projectId} AND p.org_id = ${input.orgId}) AS title,
      (SELECT p.url FROM github_projects p WHERE p.id = ${projectId} AND p.org_id = ${input.orgId}) AS url,
      COALESCE((SELECT p.attribution_mode FROM github_projects p WHERE p.id = ${projectId} AND p.org_id = ${input.orgId}), 'wi_order') AS "attributionMode",
      COALESCE((SELECT COUNT(*)::int FROM github_project_items i
        WHERE i.project_id = ${projectId} AND i.org_id = ${input.orgId} AND i.content_type = 'Issue'
          AND substring(i.title from '^WI-([0-9]+)') IS NOT NULL), 0) AS "wiTaskCount",
      COALESCE((SELECT COUNT(*)::int FROM project_work), 0) AS "workCount",
      COALESCE((SELECT SUM(verified) FROM project_work), 0)::text AS "verifiedMicros",
      COALESCE((SELECT SUM(estimated) FROM project_work), 0)::text AS "estimatedMicros",
      COALESCE((SELECT SUM(CASE WHEN work_state = 'shipped' THEN verified + estimated ELSE 0 END) FROM project_work), 0)::text AS "shippedMicros",
      COALESCE((SELECT SUM(CASE WHEN work_state = 'in_flight' THEN verified + estimated ELSE 0 END) FROM project_work), 0)::text AS "inFlightMicros",
      COALESCE((SELECT SUM(CASE WHEN work_state = 'stalled' THEN verified + estimated ELSE 0 END) FROM project_work), 0)::text AS "stalledMicros",
      jsonb_build_object(
        'named', COALESCE((SELECT SUM(verified + estimated) FROM strongest WHERE matched_by IN ('closing_reference', 'issue_number', 'project_pr')), 0)::text,
        'wiOrder', COALESCE((SELECT SUM(verified + estimated) FROM strongest WHERE matched_by = 'timeline'), 0)::text,
        'untasked', COALESCE((SELECT SUM(verified + estimated) FROM strongest WHERE matched_by = 'repository' OR matched_by IS NULL), 0)::text
      ) AS "methodMicros",
      jsonb_build_object(
        'mergedPr', COALESCE((SELECT SUM(verified + estimated) FROM project_work WHERE kind = 'pull_request' AND work_state = 'shipped'), 0)::text,
        'openPr', COALESCE((SELECT SUM(verified + estimated) FROM project_work WHERE kind = 'pull_request' AND work_state = 'in_flight'), 0)::text,
        'idlePr', COALESCE((SELECT SUM(verified + estimated) FROM project_work WHERE kind = 'pull_request' AND work_state = 'stalled' AND NOT closed_unmerged), 0)::text,
        'closedPr', COALESCE((SELECT SUM(verified + estimated) FROM project_work WHERE kind = 'pull_request' AND closed_unmerged), 0)::text,
        'directCommit', COALESCE((SELECT SUM(verified + estimated) FROM project_work WHERE kind <> 'pull_request'), 0)::text
      ) AS "outcomeMicros",
      COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'sort_cost' ORDER BY t.sort_cost DESC, t.title ASC, t.url ASC) FROM task_rows t), '[]'::jsonb) AS tasks,
      COALESCE((SELECT COUNT(*)::int FROM project_work WHERE kind = 'pull_request'), 0) AS "pullRequestCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'sort_cost' - 'activity_at' - 'canonical_id' ORDER BY x.sort_cost DESC, x.activity_at DESC, x.id)
        FROM (SELECT * FROM hydrated WHERE kind = 'pull_request') x), '[]'::jsonb) AS "pullRequests",
      COALESCE((SELECT COUNT(*)::int FROM project_work WHERE kind = 'commit'), 0) AS "commitCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'sort_cost' - 'activity_at' - 'canonical_id' ORDER BY x.sort_cost DESC, x.activity_at DESC, x.id)
        FROM (SELECT * FROM hydrated WHERE kind = 'commit') x), '[]'::jsonb) AS commits
  `);
  const row = rows[0];
  if (!row?.found || !row.title || !row.url) return null;
  return {
    id: projectId,
    title: row.title,
    url: row.url,
    days,
    workCount: Number(row.workCount ?? 0),
    verifiedMicros: row.verifiedMicros ?? "0",
    estimatedMicros: row.estimatedMicros ?? "0",
    shippedMicros: row.shippedMicros ?? "0",
    inFlightMicros: row.inFlightMicros ?? "0",
    stalledMicros: row.stalledMicros ?? "0",
    attributionMode: parseAttributionMode(row.attributionMode),
    wiTaskCount: Number(row.wiTaskCount ?? 0),
    methodMicros: {
      named: row.methodMicros?.named ?? "0",
      wiOrder: row.methodMicros?.wiOrder ?? "0",
      untasked: row.methodMicros?.untasked ?? "0",
    },
    outcomeMicros: {
      mergedPr: row.outcomeMicros?.mergedPr ?? "0",
      openPr: row.outcomeMicros?.openPr ?? "0",
      idlePr: row.outcomeMicros?.idlePr ?? "0",
      closedPr: row.outcomeMicros?.closedPr ?? "0",
      directCommit: row.outcomeMicros?.directCommit ?? "0",
    },
    tasks: (row.tasks ?? []).map((task) => ({
      ...task,
      verifiedMicros: task.verifiedMicros ?? "0",
      estimatedMicros: task.estimatedMicros ?? "0",
      method: task.method === "wi_order" || task.method === "mixed" ? task.method : "named",
      matches: (task.matches ?? []).map((item) => {
        const mapped = mapFeedItem(item);
        const reason = reasonForMatch(mapped, projectId, task.url);
        return reason ? { ...mapped, reason } : mapped;
      }),
    })),
    pullRequests: (row.pullRequests ?? []).map((item) => mapFeedItem(item)),
    pullRequestCount: Number(row.pullRequestCount ?? 0),
    commits: (row.commits ?? []).map((item) => mapFeedItem(item)),
    commitCount: Number(row.commitCount ?? 0),
  };
}

type StateItemRow = {
  id: string; workId: string; kind: Kind; title: string; state: string | null; workState: WorkState;
  url: string | null; sha: string | null; activityAt: string; commitCount: number;
  verifiedMicros: string; estimatedMicros: string;
  repository: { id: string; owner: string; name: string; fullName: string };
};

const emptyBucket = { micros: "0", count: 0, top: [] as StateItemRow[] };
export const emptyWorkStates = {
  workCount: 0,
  shipped: emptyBucket,
  inFlight: emptyBucket,
  stalled: emptyBucket,
};

function bucketFrom(rows: StateItemRow[] | null | undefined, totals: Array<{ workState: WorkState; count: number; micros: string }> | null | undefined, state: WorkState) {
  const total = totals?.find((row) => row.workState === state);
  const top = (rows ?? []).filter((row) => row.workState === state).map((row) => {
    const cleaned = applyTitle({ ...row, sha: row.sha ?? undefined });
    return { ...cleaned, activityAt: new Date(row.activityAt).toISOString(), sha: row.sha ?? undefined };
  });
  return { micros: total?.micros ?? "0", count: total?.count ?? 0, top };
}

export async function loadWorkSpendStates(input: { orgId: string; days?: string | null; repositoryId?: string | null }) {
  const rows = await prisma.$queryRaw<Array<{
    workCount: number;
    totals: Array<{ workState: WorkState; count: number; micros: string }>;
    top: StateItemRow[];
  }>>(Prisma.sql`
    ${workBase(input.orgId, input.days, input.repositoryId)}
    , classified AS (
      SELECT g.*, r.owner, r.name, COALESCE(cost.verified, 0) AS verified, COALESCE(cost.estimated, 0) AS estimated,
        COALESCE(cost.verified, 0) + COALESCE(cost.estimated, 0) AS sort_cost, ${workStateCase()} AS work_state
      FROM groups g JOIN granted r ON r.id = g.repository_id
      LEFT JOIN group_costs cost ON cost.repository_id = g.repository_id AND cost.kind = g.kind AND cost.work_id = g.work_id
      LEFT JOIN active_prs pr ON g.kind = 'pull_request' AND pr.id = g.work_id
    ), totals AS (
      SELECT work_state AS "workState", COUNT(*)::int AS count, COALESCE(SUM(sort_cost), 0)::text AS micros
      FROM classified GROUP BY work_state
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY work_state ORDER BY sort_cost DESC, activity_at DESC, canonical_id ASC) AS rn
      FROM classified
    ), top AS (
      SELECT g.canonical_id AS id, g.work_id AS "workId", g.kind,
        CASE WHEN g.kind = 'pull_request' THEN COALESCE(pr.title, g.work_id) ELSE COALESCE(commit.message_headline, g.work_id) END AS title,
        CASE WHEN g.kind = 'pull_request' THEN pr.state END AS state, g.work_state AS "workState",
        CASE WHEN g.kind = 'pull_request' THEN pr.url
          ELSE 'https://github.com/' || g.owner || '/' || g.name || '/commit/' || commit.sha END AS url,
        CASE WHEN g.kind = 'commit' THEN commit.sha END AS sha, g.activity_at AS "activityAt",
        (SELECT COUNT(*)::int FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id) AS "commitCount",
        g.verified::text AS "verifiedMicros", g.estimated::text AS "estimatedMicros",
        jsonb_build_object('id', g.repository_id, 'owner', g.owner, 'name', g.name, 'fullName', g.owner || '/' || g.name) AS repository
      FROM ranked g
      LEFT JOIN LATERAL (SELECT p.* FROM group_prs p WHERE p.canonical_id = g.canonical_id ORDER BY p.github_created_at DESC, p.id LIMIT 1) pr ON true
      LEFT JOIN LATERAL (SELECT c.* FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id ORDER BY c.authored_at DESC, c.id LIMIT 1) commit ON true
      WHERE g.rn <= 2
    )
    SELECT (SELECT COUNT(*)::int FROM classified) AS "workCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY "workState") FROM totals t), '[]'::jsonb) AS totals,
      COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY "workState", "verifiedMicros" DESC) FROM top x), '[]'::jsonb) AS top
  `);
  const row = rows[0];
  if (!row) return emptyWorkStates;
  return {
    workCount: row.workCount,
    shipped: bucketFrom(row.top, row.totals, "shipped"),
    inFlight: bucketFrom(row.top, row.totals, "in_flight"),
    stalled: bucketFrom(row.top, row.totals, "stalled"),
  };
}

function utcWeekStart(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function weeksInRange(from: Date, to: Date) {
  const weeks: string[] = [];
  const cursor = utcWeekStart(from);
  const end = utcWeekStart(to);
  while (cursor <= end) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

type TrendRow = { week: string; id: string; title: string; inferred: boolean; micros: string };

function packTrend(rows: TrendRow[], weeks: string[], overlappingMicros?: string) {
  const totals = new Map<string, { title: string; inferred: boolean; total: bigint; byWeek: Map<string, bigint> }>();
  for (const row of rows) {
    const week = typeof row.week === "string" ? row.week.slice(0, 10) : new Date(row.week).toISOString().slice(0, 10);
    const current = totals.get(row.id) ?? { title: row.title, inferred: true, total: 0n, byWeek: new Map<string, bigint>() };
    const amount = BigInt(row.micros);
    current.total += amount;
    current.byWeek.set(week, (current.byWeek.get(week) ?? 0n) + amount);
    current.inferred = current.inferred && row.inferred;
    current.title = row.title;
    totals.set(row.id, current);
  }
  const ranked = [...totals.entries()].sort((a, b) => (a[1].total === b[1].total ? a[1].title.localeCompare(b[1].title) : a[1].total > b[1].total ? -1 : 1));
  const leading = ranked.slice(0, TOP_SERIES);
  const rest = ranked.slice(TOP_SERIES);
  const series = leading.map(([id, item]) => ({
    id, title: item.title, inferred: item.inferred || undefined, totalMicros: item.total.toString(),
    points: weeks.map((week) => Number(item.byWeek.get(week) ?? 0n)),
  }));
  if (rest.length) {
    const otherWeeks = weeks.map((week) => rest.reduce((sum, [, item]) => sum + (item.byWeek.get(week) ?? 0n), 0n));
    const otherTotal = otherWeeks.reduce((sum, value) => sum + value, 0n);
    series.push({ id: "__other__", title: "Other", inferred: undefined, totalMicros: otherTotal.toString(), points: otherWeeks.map(Number) });
  }
  return { weeks, series, ...(overlappingMicros !== undefined ? { overlappingMicros } : {}) };
}

export async function loadWorkSpendTrend(input: { orgId: string; days?: string | null; by: "repository" | "project" | "person" }) {
  const { from, to } = workSpendWindow(input.days);
  const weeks = weeksInRange(from, to);
  if (input.by === "repository") {
    const rows = await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      ${workBase(input.orgId, input.days)}
      SELECT date_trunc('week', a.date)::date::text AS week, r.id,
        r.owner || '/' || r.name AS title, false AS inferred, SUM(a.cost_micros)::text AS micros
      FROM owned_allocations a JOIN granted r ON r.id = a.repository_id
      GROUP BY 1, 2, 3
    `);
    return { by: "repository" as const, ...packTrend(rows, weeks) };
  }
  if (input.by === "person") {
    const rows = await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      ${workBase(input.orgId, input.days)}
      SELECT date_trunc('week', a.date)::date::text AS week, a.developer_id AS id,
        COALESCE(d.name, 'Former workspace member') AS title, false AS inferred, SUM(a.cost_micros)::text AS micros
      FROM owned_allocations a
      LEFT JOIN users d ON d.id = a.developer_id AND d.org_id = ${input.orgId}
      GROUP BY 1, 2, 3
    `);
    const packed = packTrend(rows, weeks);
    const named = packed.series.filter((series) => series.id !== "__other__").sort((a, b) => a.title.localeCompare(b.title));
    const other = packed.series.filter((series) => series.id === "__other__");
    return { by: "person" as const, ...packed, series: [...named, ...other] };
  }
  const result = await prisma.$queryRaw<Array<{ rows: TrendRow[]; overlappingMicros: string }>>(Prisma.sql`
    ${workBase(input.orgId, input.days)}
    , project_weeks AS (
      SELECT date_trunc('week', a.date)::date::text AS week, pm.project_id AS id, pm.project_title AS title,
        BOOL_AND(pm.matched_by = 'repository') AS inferred, SUM(a.cost_micros)::text AS micros
      FROM owned_allocations a
      JOIN groups g ON g.repository_id = a.repository_id AND g.kind = a.kind AND g.work_id = a.work_id
      JOIN project_matches pm ON pm.canonical_id = g.canonical_id
      GROUP BY 1, 2, 3
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM project_weeks p), '[]'::jsonb) AS rows,
      COALESCE((SELECT SUM(verified + estimated) FROM groups g
        LEFT JOIN group_costs c ON c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id
        WHERE (SELECT COUNT(*) FROM project_matches pm WHERE pm.canonical_id = g.canonical_id) > 1), 0)::text AS "overlappingMicros"
  `);
  const packed = packTrend(result[0]?.rows ?? [], weeks, result[0]?.overlappingMicros ?? "0");
  packed.series.forEach((item) => { if (!item.inferred) delete item.inferred; });
  return { by: "project" as const, ...packed };
}

const PEOPLE_LIMIT = 8;

export async function loadWorkSpendPeople(input: { orgId: string; days?: string | null }) {
  const rows = await prisma.$queryRaw<Array<{
    id: string; name: string; verifiedMicros: string; estimatedMicros: string; workCount: number;
  }>>(Prisma.sql`
    ${workBase(input.orgId, input.days)}
    SELECT a.developer_id AS id, COALESCE(d.name, 'Former workspace member') AS name,
      COALESCE(SUM(a.cost_micros) FILTER (WHERE a.cost_kind = 'verified_usage'), 0)::text AS "verifiedMicros",
      COALESCE(SUM(a.cost_micros) FILTER (WHERE a.cost_kind = 'estimated_api'), 0)::text AS "estimatedMicros",
      COUNT(DISTINCT a.repository_id || ':' || a.kind || ':' || a.work_id)::int AS "workCount"
    FROM owned_allocations a
    LEFT JOIN users d ON d.id = a.developer_id AND d.org_id = ${input.orgId}
    WHERE a.work_id IS NOT NULL
    GROUP BY 1, 2
    ORDER BY SUM(a.cost_micros) DESC, COALESCE(d.name, 'Former workspace member') ASC
    LIMIT ${PEOPLE_LIMIT}
  `);
  return { people: rows };
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export async function loadWorkSpendExport(input: { orgId: string; days?: string | null }) {
  const rows = await prisma.$queryRaw<Array<{
    kind: Kind; title: string; sha: string | null; issueTitle: string | null; pullRequestTitle: string | null;
    repository: string; state: string | null; workState: WorkState;
    projects: string; verifiedMicros: string; estimatedMicros: string;
  }>>(Prisma.sql`
    ${workBase(input.orgId, input.days)}
    , classified AS (
      SELECT g.*, r.owner, r.name, COALESCE(cost.verified, 0) AS verified, COALESCE(cost.estimated, 0) AS estimated,
        ${workStateCase()} AS work_state
      FROM groups g JOIN granted r ON r.id = g.repository_id
      LEFT JOIN group_costs cost ON cost.repository_id = g.repository_id AND cost.kind = g.kind AND cost.work_id = g.work_id
      LEFT JOIN active_prs pr ON g.kind = 'pull_request' AND pr.id = g.work_id
    )
    SELECT g.kind, CASE WHEN g.kind = 'pull_request' THEN COALESCE(pr.title, g.work_id) ELSE COALESCE(commit.message_headline, g.work_id) END AS title,
      CASE WHEN g.kind = 'commit' THEN commit.sha END AS sha,
      (SELECT pm.title FROM project_matches pm WHERE pm.canonical_id = g.canonical_id AND pm.matched_by <> 'repository' ORDER BY pm.title LIMIT 1) AS "issueTitle",
      pr.title AS "pullRequestTitle",
      g.owner || '/' || g.name AS repository,
      CASE WHEN g.kind = 'pull_request' THEN pr.state END AS state, g.work_state AS "workState",
      COALESCE((SELECT string_agg(DISTINCT pm.project_title, '; ' ORDER BY pm.project_title) FROM project_matches pm WHERE pm.canonical_id = g.canonical_id), '') AS projects,
      g.verified::text AS "verifiedMicros", g.estimated::text AS "estimatedMicros"
    FROM classified g
    LEFT JOIN LATERAL (SELECT p.* FROM group_prs p WHERE p.canonical_id = g.canonical_id ORDER BY p.github_created_at DESC, p.id LIMIT 1) pr ON true
    LEFT JOIN LATERAL (SELECT c.* FROM work_commits c WHERE c.repository_id = g.repository_id AND c.kind = g.kind AND c.work_id = g.work_id ORDER BY c.authored_at DESC, c.id LIMIT 1) commit ON true
    ORDER BY (g.verified + g.estimated) DESC, g.activity_at DESC, g.canonical_id ASC
    LIMIT ${EXPORT_LIMIT}
  `);
  const header = ["title", "repository", "state", "work_state", "projects", "verified_usd", "estimated_usd"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const cleaned = cleanWorkTitle({ title: row.title, kind: row.kind, sha: row.sha, issueTitle: row.issueTitle, pullRequestTitle: row.pullRequestTitle });
    lines.push([
      csvCell(cleaned.title),
      csvCell(row.repository),
      csvCell(row.state ?? ""),
      csvCell(row.workState),
      csvCell(row.projects),
      csvCell((Number(BigInt(row.verifiedMicros)) / 1_000_000).toFixed(2)),
      csvCell((Number(BigInt(row.estimatedMicros)) / 1_000_000).toFixed(2)),
    ].join(","));
  }
  return lines.join("\n") + "\n";
}
