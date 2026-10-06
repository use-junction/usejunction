import { Prisma, prisma } from "@usejunction/db";
import { CHANGE_TYPES, workSpendWindow } from "@/lib/app-pages/work-spend";
import { projectLinksForWork, type ProjectLinkItem } from "@/lib/features/github-project-links";
import { parseGitHubIssueNumbers } from "@/lib/features/ticket-keys";

const PAGE_SIZE = 25;
const ZERO = BigInt(0);

type Cursor = { at: Date; id: string };
type Candidate = { kind: "pull_request" | "commit"; id: string; activityAt: Date };
type Money = { verified: bigint; estimated: bigint };

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const at = new Date(parsed.at);
    return typeof parsed.id === "string" && parsed.id.length <= 300 && !Number.isNaN(at.getTime())
      ? { at, id: parsed.id } : null;
  } catch { return null; }
}

function encodeCursor(item: Candidate) {
  return Buffer.from(JSON.stringify({ at: item.activityAt.toISOString(), id: item.id })).toString("base64url");
}

function money(verified: bigint, estimated: bigint) {
  return { verifiedMicros: verified.toString(), estimatedMicros: estimated.toString() };
}

function seekSql(cursor: Cursor | null) {
  return cursor
    ? Prisma.sql`AND (activity_at < ${cursor.at} OR (activity_at = ${cursor.at} AND id > ${cursor.id}))`
    : Prisma.empty;
}

type WorkItem = {
  kind: "ticket" | "pull_request" | "commit";
  id: string;
  sha?: string;
  title: string;
  state: string | null;
  url: string | null;
  ticketKey: string | null;
  ticketSource: string | null;
  authorLogin: string | null;
  activityAt: string;
  commitCount: number;
  verifiedMicros: string;
  estimatedMicros: string;
  issue: { title: string; status: string; url: string | null } | null;
  projectLinks: ReturnType<typeof projectLinksForWork>;
  pullRequests: Array<{ id: string; title: string; state: string; url: string | null }>;
};

const PREFIX_PATTERN: Record<string, string> = {
  Features: "^feat(\\([^)]*\\))?!?:[[:space:]]",
  Fixes: "^fix(\\([^)]*\\))?!?:[[:space:]]",
  Refactoring: "^refactor(\\([^)]*\\))?!?:[[:space:]]",
  Performance: "^perf(\\([^)]*\\))?!?:[[:space:]]",
  Documentation: "^docs(\\([^)]*\\))?!?:[[:space:]]",
  Tests: "^test(\\([^)]*\\))?!?:[[:space:]]",
  "Build & dependencies": "^build(\\([^)]*\\))?!?:[[:space:]]",
  CI: "^ci(\\([^)]*\\))?!?:[[:space:]]",
  Maintenance: "^chore(\\([^)]*\\))?!?:[[:space:]]",
  Formatting: "^style(\\([^)]*\\))?!?:[[:space:]]",
  Reverts: "^revert(\\([^)]*\\))?!?:[[:space:]]",
};
const ANY_PREFIX_PATTERN = `(${Object.values(PREFIX_PATTERN).join("|")})`;

async function commitCosts(orgId: string, repositoryId: string, shas: string[], from: Date, to: Date) {
  const result = new Map<string, Money>();
  if (!shas.length) return result;
  const rows = await prisma.featureCostAllocation.groupBy({
    by: ["commitSha", "costKind"],
    where: { orgId, repositoryId, commitSha: { in: shas }, date: { gte: from, lte: to } },
    _sum: { costMicros: true },
  });
  for (const row of rows) {
    if (!row.commitSha) continue;
    const value = result.get(row.commitSha) ?? { verified: ZERO, estimated: ZERO };
    if (row.costKind === "verified_usage") value.verified += row._sum.costMicros ?? ZERO;
    if (row.costKind === "estimated_api") value.estimated += row._sum.costMicros ?? ZERO;
    result.set(row.commitSha, value);
  }
  return result;
}

function commitItem(commit: {
  id: string; sha: string; messageHeadline: string; authoredAt: Date; authorLogin: string | null;
  pullRequest?: { title: string; headRefName: string | null } | null;
}, cost: Money | undefined, repository: { owner: string; name: string } | null, projectItems: ProjectLinkItem[] = []): WorkItem {
  const projectLinks = projectLinksForWork(
    projectItems,
    [],
    parseGitHubIssueNumbers({ title: commit.pullRequest?.title, messages: [commit.messageHeadline] }),
  );
  const issue = projectLinks.find((link) => link.matchedBy !== "project_pr" && link.matchedBy !== "repository") ?? null;
  return {
    kind: "commit", id: commit.id, sha: commit.sha, title: commit.messageHeadline || commit.sha.slice(0, 7), state: null,
    url: repository ? `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commit/${encodeURIComponent(commit.sha)}` : null,
    ticketKey: null, ticketSource: null, authorLogin: commit.authorLogin,
    activityAt: commit.authoredAt.toISOString(), commitCount: 1,
    ...money(cost?.verified ?? ZERO, cost?.estimated ?? ZERO),
    issue: issue ? { title: issue.title, status: issue.status ?? "Unknown", url: issue.url } : null,
    projectLinks,
    pullRequests: [],
  };
}

function prActivitySql(from: Date, endExclusive: Date) {
  return Prisma.sql`GREATEST(
    CASE WHEN p.github_created_at >= ${from} AND p.github_created_at < ${endExclusive} THEN p.github_created_at END,
    CASE WHEN p.merged_at >= ${from} AND p.merged_at < ${endExclusive} THEN p.merged_at END,
    CASE WHEN p.closed_at >= ${from} AND p.closed_at < ${endExclusive} THEN p.closed_at END,
    (SELECT MAX(c.authored_at) FROM git_commits c
      WHERE c.pull_request_id = p.id AND c.is_bot = false
        AND c.authored_at >= ${from} AND c.authored_at < ${endExclusive})
  )`;
}

/** Each candidate query returns at most one page; the expensive work is done in PostgreSQL. */
async function pageCandidates(orgId: string, repositoryId: string, from: Date, endExclusive: Date, cursor: Cursor | null) {
  const activity = prActivitySql(from, endExclusive);
  const seek = seekSql(cursor);
  const [prRows, commitRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; activityAt: Date }>>(Prisma.sql`
      SELECT id, activity_at AS "activityAt" FROM (
        SELECT p.id, ${activity} AS activity_at FROM git_pull_requests p
        WHERE p.org_id = ${orgId} AND p.repository_id = ${repositoryId}
      ) active
      WHERE activity_at IS NOT NULL ${seek}
      ORDER BY activity_at DESC, id ASC LIMIT ${PAGE_SIZE + 1}
    `),
    prisma.$queryRaw<Array<{ id: string; activityAt: Date }>>(Prisma.sql`
      SELECT id, activity_at AS "activityAt" FROM (
        SELECT c.id, c.authored_at AS activity_at FROM git_commits c
        WHERE c.org_id = ${orgId} AND c.repository_id = ${repositoryId}
          AND c.pull_request_id IS NULL AND c.is_bot = false
          AND c.authored_at >= ${from} AND c.authored_at < ${endExclusive}
      ) direct
      WHERE true ${seek} ORDER BY activity_at DESC, id ASC LIMIT ${PAGE_SIZE + 1}
    `),
  ]);
  return [
    ...prRows.map((row) => ({ ...row, kind: "pull_request" as const })),
    ...commitRows.map((row) => ({ ...row, kind: "commit" as const })),
  ].sort((a, b) => b.activityAt.getTime() - a.activityAt.getTime() || a.id.localeCompare(b.id)).slice(0, PAGE_SIZE + 1);
}

export async function loadRepositoryWork(input: {
  orgId: string; repositoryId: string; days?: string | null; cursor?: string | null;
  type?: string | null; pullRequestId?: string | null; projectId?: string | null;
}) {
  const { from, to, endExclusive } = workSpendWindow(input.days);
  const cursor = decodeCursor(input.cursor);
  const access = await prisma.gitHubRepositoryAccess.findFirst({
    where: { orgId: input.orgId, repositoryId: input.repositoryId, connection: { status: { not: "disconnected" } } },
    include: { repository: { select: { owner: true, name: true } } },
  });
  if (!access) return null;

  const project = input.projectId ? await prisma.gitHubProject.findFirst({
    where: { id: input.projectId, orgId: input.orgId, connectionId: access.connectionId }, select: { id: true },
  }) : null;
  if (input.projectId && !project) return null;
  const projectItems = input.pullRequestId ? [] : await prisma.gitHubProjectItem.findMany({
    where: { orgId: input.orgId, repositoryId: input.repositoryId, project: { connectionId: access.connectionId, ...(project ? { id: project.id } : {}) } },
    select: { externalItemId: true, contentType: true, number: true, title: true, status: true, url: true, project: { select: { id: true, title: true, url: true } } },
  }) as ProjectLinkItem[];
  if (project && projectItems.length === 0) return { items: [], allocationContext: [], nextCursor: null };

  if (input.pullRequestId) {
    const pr = await prisma.gitPullRequest.findFirst({ where: { id: input.pullRequestId, orgId: input.orgId, repositoryId: input.repositoryId }, select: { id: true } });
    if (!pr) return null;
    const commits = await prisma.gitCommit.findMany({
      where: {
        orgId: input.orgId, repositoryId: input.repositoryId, pullRequestId: pr.id, isBot: false,
        authoredAt: { gte: from, lt: endExclusive },
        ...(cursor ? { OR: [{ authoredAt: { lt: cursor.at } }, { authoredAt: cursor.at, id: { lt: cursor.id } }] } : {}),
      },
      include: { pullRequest: { select: { title: true, headRefName: true } } },
      orderBy: [{ authoredAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
    });
    const shown = commits.slice(0, PAGE_SIZE);
    const costs = await commitCosts(input.orgId, input.repositoryId, shown.map((row) => row.sha), from, to);
    return {
      items: shown.map((row) => commitItem(row, costs.get(row.sha), access.repository)),
      allocationContext: [],
      nextCursor: commits.length > PAGE_SIZE ? encodeCursor({ kind: "commit", id: shown[shown.length - 1]!.id, activityAt: shown[shown.length - 1]!.authoredAt }) : null,
    };
  }

  if (!project && input.type && input.type !== "all" && CHANGE_TYPES.includes(input.type as typeof CHANGE_TYPES[number])) {
    const pattern = input.type === "No recognized prefix" ? ANY_PREFIX_PATTERN : PREFIX_PATTERN[input.type];
    const predicate = input.type === "No recognized prefix"
      ? Prisma.sql`NOT (message_headline ~* ${pattern})` : Prisma.sql`message_headline ~* ${pattern}`;
    const seek = cursor ? Prisma.sql`AND (authored_at < ${cursor.at} OR (authored_at = ${cursor.at} AND id < ${cursor.id}))` : Prisma.empty;
    const ids = await prisma.$queryRaw<Array<{ id: string; authoredAt: Date }>>(Prisma.sql`
      SELECT id, authored_at AS "authoredAt" FROM git_commits
      WHERE org_id = ${input.orgId} AND repository_id = ${input.repositoryId}
        AND authored_at >= ${from} AND authored_at < ${endExclusive} AND is_bot = false AND ${predicate}
        ${seek}
      ORDER BY authored_at DESC, id DESC LIMIT ${PAGE_SIZE + 1}
    `);
    const shown = ids.slice(0, PAGE_SIZE);
    const commits = await prisma.gitCommit.findMany({
      where: { id: { in: shown.map((row) => row.id) }, orgId: input.orgId, repositoryId: input.repositoryId },
      include: { pullRequest: { select: { title: true, headRefName: true } } },
    });
    const byId = new Map(commits.map((row) => [row.id, row]));
    const costs = await commitCosts(input.orgId, input.repositoryId, commits.map((row) => row.sha), from, to);
    return {
      items: shown.map((row) => byId.get(row.id)).filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => commitItem(row, costs.get(row.sha), access.repository, projectItems)),
      allocationContext: [],
      nextCursor: ids.length > PAGE_SIZE ? encodeCursor({ kind: "commit", id: shown[shown.length - 1]!.id, activityAt: shown[shown.length - 1]!.authoredAt }) : null,
    };
  }

  const candidates = await pageCandidates(input.orgId, input.repositoryId, from, endExclusive, cursor);
  const shown = candidates.slice(0, PAGE_SIZE);
  const standalonePrIds = shown.flatMap((item) => item.kind === "pull_request" ? [item.id] : []);
  const directIds = shown.flatMap((item) => item.kind === "commit" ? [item.id] : []);

  const [prs, directCommits, countRows, prCostRows] = await Promise.all([
    prisma.gitPullRequest.findMany({
      where: { orgId: input.orgId, repositoryId: input.repositoryId, id: { in: standalonePrIds } },
      select: { id: true, number: true, title: true, state: true, url: true, closingIssues: true, authorLogin: true, githubCreatedAt: true, mergedAt: true, closedAt: true },
    }),
    prisma.gitCommit.findMany({
      where: { orgId: input.orgId, repositoryId: input.repositoryId, id: { in: directIds } },
      select: { id: true, sha: true, messageHeadline: true, authoredAt: true, authorLogin: true },
    }),
    standalonePrIds.length ? prisma.gitCommit.groupBy({
      by: ["pullRequestId"],
      where: { orgId: input.orgId, repositoryId: input.repositoryId, pullRequestId: { in: standalonePrIds }, isBot: false, authoredAt: { gte: from, lt: endExclusive } },
      _count: { _all: true },
    }) : Promise.resolve([]),
    standalonePrIds.length ? prisma.$queryRaw<Array<{ pullRequestId: string; costKind: string; costMicros: bigint }>>(Prisma.sql`
      SELECT COALESCE(a.pull_request_id, c.pull_request_id) AS "pullRequestId", a.cost_kind AS "costKind", SUM(a.cost_micros)::bigint AS "costMicros"
      FROM feature_cost_allocations a
      LEFT JOIN git_commits c ON c.repository_id = a.repository_id AND c.sha = a.commit_sha AND c.org_id = ${input.orgId}
      WHERE a.org_id = ${input.orgId} AND a.repository_id = ${input.repositoryId}
        AND a.date >= ${from} AND a.date <= ${to}
        AND COALESCE(a.pull_request_id, c.pull_request_id) IN (${Prisma.join(standalonePrIds)})
      GROUP BY COALESCE(a.pull_request_id, c.pull_request_id), a.cost_kind
    `) : Promise.resolve([]),
  ]);

  const prById = new Map(prs.map((row) => [row.id, row]));
  const counts = new Map(countRows.map((row) => [row.pullRequestId, row._count._all]));
  const directById = new Map(directCommits.map((row) => [row.id, row]));
  const standaloneCosts = new Map<string, Money>();
  for (const row of prCostRows) {
    const value = standaloneCosts.get(row.pullRequestId) ?? { verified: ZERO, estimated: ZERO };
    if (row.costKind === "verified_usage") value.verified += row.costMicros;
    if (row.costKind === "estimated_api") value.estimated += row.costMicros;
    standaloneCosts.set(row.pullRequestId, value);
  }
  const commitCostMap = await commitCosts(input.orgId, input.repositoryId, directCommits.map((row) => row.sha), from, to);

  const items: WorkItem[] = shown.flatMap((candidate) => {
    if (candidate.kind === "pull_request") {
      const pr = prById.get(candidate.id);
      if (!pr) return [];
      const cost = standaloneCosts.get(pr.id);
      const projectLinks = projectLinksForWork(projectItems, [pr], parseGitHubIssueNumbers({ title: pr.title }));
      const issue = projectLinks.find((link) => link.matchedBy !== "project_pr" && link.matchedBy !== "repository") ?? null;
      return [{
        kind: "pull_request" as const, id: pr.id, title: pr.title, state: pr.state, url: pr.url,
        ticketKey: null, ticketSource: null, authorLogin: pr.authorLogin,
        activityAt: candidate.activityAt.toISOString(), commitCount: counts.get(pr.id) ?? 0,
        ...money(cost?.verified ?? ZERO, cost?.estimated ?? ZERO),
        issue: issue ? { title: issue.title, status: issue.status ?? "Unknown", url: issue.url } : null,
        projectLinks,
        pullRequests: [{ id: pr.id, title: pr.title, state: pr.state, url: pr.url }],
      }];
    }
    const commit = directById.get(candidate.id);
    return commit ? [commitItem(commit, commitCostMap.get(commit.sha), access.repository, projectItems)] : [];
  });
  return {
    items,
    allocationContext: [],
    nextCursor: candidates.length > PAGE_SIZE ? encodeCursor(shown[shown.length - 1]!) : null,
  };
}
