import { Prisma, prisma } from "@usejunction/db";
import type { AppPrincipal } from "@/lib/api/app-auth";
import { FEATURE_COST_VERSION } from "@/lib/features/allocate";
import { githubAuthorScopeFromConnection, githubMemberLoginsFromConfig, isInAnyGitHubAuthorScope } from "@/lib/features/github-authors";
import { githubProjectsReadGranted } from "@/lib/integrations/github-app";
import { githubConnectionView, listWorkspaceGitHubConnections, summarizeGitHubConnections } from "@/lib/integrations/github-connections";
import { isGitHubEmptyRepositoryError, sanitizeGitHubSyncError } from "@/lib/integrations/github-empty-repo";
import { canManageSettings } from "@/lib/rbac/permissions";
import { emptyWorkStates, loadWorkSpendStates } from "@/lib/app-pages/work-spend-feed";
import { CHANGE_TYPES, workSpendWindow } from "@/lib/app-pages/work-spend-window";

export { CHANGE_TYPES, workSpendWindow };

const ZERO = BigInt(0);

type ChangeMixRow = { repositoryId: string; type: string; count: bigint };

async function loadChangeMix(orgId: string, repositoryIds: string[], from: Date, endExclusive: Date): Promise<ChangeMixRow[]> {
  if (repositoryIds.length === 0) return [];
  return prisma.$queryRaw<ChangeMixRow[]>(Prisma.sql`
    SELECT repository_id AS "repositoryId", category AS type, COUNT(*)::bigint AS count
    FROM (
      SELECT repository_id,
        CASE
          WHEN message_headline ~* '^feat(\\([^)]*\\))?!?:[[:space:]]' THEN 'Features'
          WHEN message_headline ~* '^fix(\\([^)]*\\))?!?:[[:space:]]' THEN 'Fixes'
          WHEN message_headline ~* '^refactor(\\([^)]*\\))?!?:[[:space:]]' THEN 'Refactoring'
          WHEN message_headline ~* '^perf(\\([^)]*\\))?!?:[[:space:]]' THEN 'Performance'
          WHEN message_headline ~* '^docs(\\([^)]*\\))?!?:[[:space:]]' THEN 'Documentation'
          WHEN message_headline ~* '^test(\\([^)]*\\))?!?:[[:space:]]' THEN 'Tests'
          WHEN message_headline ~* '^build(\\([^)]*\\))?!?:[[:space:]]' THEN 'Build & dependencies'
          WHEN message_headline ~* '^ci(\\([^)]*\\))?!?:[[:space:]]' THEN 'CI'
          WHEN message_headline ~* '^chore(\\([^)]*\\))?!?:[[:space:]]' THEN 'Maintenance'
          WHEN message_headline ~* '^style(\\([^)]*\\))?!?:[[:space:]]' THEN 'Formatting'
          WHEN message_headline ~* '^revert(\\([^)]*\\))?!?:[[:space:]]' THEN 'Reverts'
          ELSE 'No recognized prefix'
        END AS category
      FROM git_commits
      WHERE org_id = ${orgId} AND repository_id IN (${Prisma.join(repositoryIds)})
        AND authored_at >= ${from} AND authored_at < ${endExclusive} AND is_bot = false
    ) categorized
    GROUP BY repository_id, category
  `);
}

async function hasTicketedWork(orgId: string, repositoryIds: string[], from: Date, endExclusive: Date) {
  if (repositoryIds.length === 0) return false;
  const rows = await prisma.$queryRaw<Array<{ hasTickets: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM git_commits c
        LEFT JOIN git_pull_requests pr ON pr.id = c.pull_request_id
        WHERE c.org_id = ${orgId} AND c.repository_id IN (${Prisma.join(repositoryIds)})
          AND c.authored_at >= ${from} AND c.authored_at < ${endExclusive} AND c.is_bot = false
          AND (jsonb_array_length(c.ticket_keys) > 0 OR jsonb_array_length(pr.ticket_keys) > 0)
      ) OR EXISTS (
        SELECT 1 FROM git_pull_requests pr
        WHERE pr.org_id = ${orgId} AND pr.repository_id IN (${Prisma.join(repositoryIds)})
          AND (pr.github_created_at >= ${from} AND pr.github_created_at < ${endExclusive}
            OR pr.merged_at >= ${from} AND pr.merged_at < ${endExclusive}
            OR pr.closed_at >= ${from} AND pr.closed_at < ${endExclusive})
          AND jsonb_array_length(pr.ticket_keys) > 0
      )
    ) AS "hasTickets"
  `);
  return rows[0]?.hasTickets ?? false;
}

function dollars(value: bigint) { return value.toString(); }

export async function loadWorkSpendPage(principal: AppPrincipal, search: { days?: string | null; repositoryId?: string | null } = {}) {
  const { from, to, days, endExclusive } = workSpendWindow(search.days);
  const githubRows = await listWorkspaceGitHubConnections(principal.orgId);
  const grantRows = githubRows.length ? await prisma.gitHubRepositoryAccess.findMany({
    where: { orgId: principal.orgId, connectionId: { in: githubRows.map((row) => row.id) } },
    include: { repository: { select: { id: true, owner: true, name: true } } },
    orderBy: [{ repository: { owner: "asc" } }, { repository: { name: "asc" } }],
  }) : [];
  const seenRepos = new Set<string>();
  const roster = grantRows.filter((row) => {
    if (seenRepos.has(row.repositoryId)) return false;
    seenRepos.add(row.repositoryId);
    return true;
  });
  const selected = search.repositoryId && roster.some((row) => row.repositoryId === search.repositoryId)
    ? search.repositoryId : null;
  const visibleRoster = selected ? roster.filter((row) => row.repositoryId === selected) : roster;
  const ids = visibleRoster.map((row) => row.repositoryId);
  const developers = await prisma.developer.findMany({
    where: { orgId: principal.orgId, removedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const connections = githubRows.map((row) => githubConnectionView(row, {
    hasRepoErrors: grantRows.some((item) =>
      item.syncStatus === "error"
      && !isGitHubEmptyRepositoryError(item.lastError)
      && (!item.connectionId || item.connectionId === row.id)),
  }));
  const connection = summarizeGitHubConnections(connections);
  const authorScopes = githubRows.map((row) => githubAuthorScopeFromConnection({
    accountType: githubConnectionView(row).accountType,
    memberLogins: githubMemberLoginsFromConfig(row.config),
    developers,
  }));
  const connectionIds = githubRows.map((row) => row.id);

  const [costRows, oldAllocation, commitRows, contributorRows, prRows, changeRows, hasTickets, unmatchedRows, lastUsage, lastDevice, projectRows, projectRepoRows] = await Promise.all([
    prisma.featureCostAllocation.groupBy({
      by: ["repositoryId", "costKind", "method"],
      // Coverage is workspace-wide. Unlinked usage has no repository and must
      // remain in the denominator when the explorer selects a repository.
      where: { orgId: principal.orgId, date: { gte: from, lte: to } },
      _sum: { costMicros: true },
    }),
    prisma.featureCostAllocation.findFirst({
      where: { orgId: principal.orgId, date: { gte: from, lte: to }, calculationVersion: { not: FEATURE_COST_VERSION } },
      select: { id: true },
    }),
    prisma.gitCommit.groupBy({ by: ["repositoryId"], where: { orgId: principal.orgId, repositoryId: { in: ids }, isBot: false, authoredAt: { gte: from, lt: endExclusive } }, _count: { _all: true }, _max: { authoredAt: true } }),
    prisma.gitCommit.groupBy({ by: ["repositoryId", "authorLogin"], where: { orgId: principal.orgId, repositoryId: { in: ids }, isBot: false, authorLogin: { not: null }, authoredAt: { gte: from, lt: endExclusive } }, _count: { _all: true } }),
    prisma.gitPullRequest.groupBy({ by: ["repositoryId"], where: { orgId: principal.orgId, repositoryId: { in: ids }, OR: [{ githubCreatedAt: { gte: from, lt: endExclusive } }, { mergedAt: { gte: from, lt: endExclusive } }, { closedAt: { gte: from, lt: endExclusive } }, { commits: { some: { authoredAt: { gte: from, lt: endExclusive }, isBot: false } } }] }, _count: { _all: true }, _max: { githubCreatedAt: true, mergedAt: true, closedAt: true } }),
    loadChangeMix(principal.orgId, ids, from, endExclusive),
    hasTicketedWork(principal.orgId, ids, from, endExclusive),
    prisma.gitCommit.groupBy({ by: ["authorLogin"], where: { orgId: principal.orgId, repositoryId: { in: ids }, isBot: false, authorDeveloperId: null, authorLogin: { not: null }, authoredAt: { gte: from, lt: endExclusive } }, _count: { _all: true } }),
    prisma.usageDaily.findFirst({ where: { orgId: principal.orgId, costMicros: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true } }),
    prisma.device.findFirst({ where: { orgId: principal.orgId }, orderBy: { lastUsageSyncAt: "desc" }, select: { lastUsageSyncAt: true } }),
    connectionIds.length ? prisma.gitHubProject.findMany({ where: { orgId: principal.orgId, connectionId: { in: connectionIds } }, orderBy: { title: "asc" }, select: { id: true, title: true, url: true, syncStatus: true, lastSuccessAt: true, lastError: true } }) : Promise.resolve([]),
    ids.length ? prisma.gitHubProjectItem.groupBy({ by: ["repositoryId", "projectId"], where: { orgId: principal.orgId, repositoryId: { in: ids }, project: { connectionId: { in: connectionIds } } }, _count: { _all: true } }) : Promise.resolve([]),
  ]);

  const costs = new Map<string, { verified: bigint; estimated: bigint }>();
  let verified = ZERO, estimated = ZERO, unattributed = ZERO;
  for (const row of costRows) {
    const amount = row._sum.costMicros ?? ZERO;
    if (row.costKind === "verified_usage") verified += amount;
    if (row.costKind === "estimated_api") estimated += amount;
    if (row.method === "unattributed") unattributed += amount;
    if (!row.repositoryId) continue;
    const current = costs.get(row.repositoryId) ?? { verified: ZERO, estimated: ZERO };
    if (row.costKind === "verified_usage") current.verified += amount;
    if (row.costKind === "estimated_api") current.estimated += amount;
    costs.set(row.repositoryId, current);
  }
  const eligible = verified + estimated;
  const attributed = eligible - unattributed;
  const commits = new Map(commitRows.map((row) => [row.repositoryId, row]));
  const prs = new Map(prRows.map((row) => [row.repositoryId, row]));
  const contributors = new Map<string, number>();
  for (const row of contributorRows) if (row.authorLogin) contributors.set(row.repositoryId, (contributors.get(row.repositoryId) ?? 0) + 1);
  const mix = new Map<string, Array<{ type: string; count: number }>>();
  const globalMix = new Map<string, number>();
  for (const row of changeRows) {
    const count = Number(row.count);
    mix.set(row.repositoryId, [...(mix.get(row.repositoryId) ?? []), { type: row.type, count }]);
    globalMix.set(row.type, (globalMix.get(row.type) ?? 0) + count);
  }
  const repositories = visibleRoster.map((row) => {
    const commit = commits.get(row.repositoryId);
    const pr = prs.get(row.repositoryId);
    const latest = [commit?._max.authoredAt, pr?._max.githubCreatedAt, pr?._max.mergedAt, pr?._max.closedAt]
      .filter((date): date is Date => Boolean(date && date >= from && date < endExclusive)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const cost = costs.get(row.repositoryId);
    return {
      id: row.repositoryId,
      owner: row.repository.owner,
      name: row.repository.name,
      fullName: `${row.repository.owner}/${row.repository.name}`,
      syncStatus: isGitHubEmptyRepositoryError(row.lastError) ? "available" : row.syncStatus,
      lastSyncedAt: row.lastSuccessAt?.toISOString() ?? null,
      lastError: sanitizeGitHubSyncError(row.lastError),
      pullRequestCount: pr?._count._all ?? 0,
      commitCount: commit?._count._all ?? 0,
      contributorCount: contributors.get(row.repositoryId) ?? 0,
      latestActivityAt: latest?.toISOString() ?? null,
      verifiedMicros: dollars(cost?.verified ?? ZERO),
      estimatedMicros: dollars(cost?.estimated ?? ZERO),
      changeMix: (mix.get(row.repositoryId) ?? []).sort((a, b) => b.count - a.count),
      projectIds: projectRepoRows.filter((item) => item.repositoryId === row.repositoryId).map((item) => item.projectId),
    };
  });

  const states = ids.length ? await loadWorkSpendStates({ orgId: principal.orgId, days: search.days, repositoryId: selected }) : emptyWorkStates;

  const unmapped = unmatchedRows.filter((row) => row.authorLogin && isInAnyGitHubAuthorScope(row.authorLogin, authorScopes));
  const identities = await prisma.externalIdentity.findMany({
    where: { orgId: principal.orgId, provider: "github", externalUserId: { in: unmapped.map((row) => row.authorLogin!).filter(Boolean) } },
    select: { id: true, externalUserId: true },
  });
  const identityByLogin = new Map(identities.map((row) => [row.externalUserId.toLowerCase(), row.id]));
  const unmappedAuthors = unmapped.map((row) => {
    const login = row.authorLogin!;
    return {
      identityId: identityByLogin.get(login.toLowerCase()) ?? null,
      login,
      commitCount: row._count._all,
      suggestedDeveloperId: developers.find((developer) => developer.email.split("@")[0]?.toLowerCase() === login.toLowerCase())?.id ?? null,
    };
  });

  return {
    days,
    window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    selectedRepositoryId: selected,
    repositoryOptions: roster.map((row) => ({ id: row.repositoryId, fullName: `${row.repository.owner}/${row.repository.name}` })),
    canMapIdentities: canManageSettings(principal.role),
    canViewPeople: canManageSettings(principal.role),
    workCount: states.workCount,
    states: { shipped: states.shipped, inFlight: states.inFlight, stalled: states.stalled },
    connection,
    connections,
    coverage: {
      eligibleMicros: dollars(eligible), attributedMicros: dollars(attributed), unattributedMicros: dollars(unattributed),
      verifiedMicros: dollars(verified), estimatedMicros: dollars(estimated),
      attributedPct: eligible > ZERO ? Number((attributed * BigInt(1000)) / eligible) / 10 : 0,
    },
    allocationCurrent: !oldAllocation,
    repositories,
    changeMix: [...globalMix].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    hasTicketKeys: hasTickets,
    attention: { unmappedAuthors, developers },
    projects: {
      state: !githubRows.length ? "not_connected" : githubRows.every((row) => githubConnectionView(row).accountType === "User") ? "personal_account" : githubRows.filter((row) => githubConnectionView(row).accountType === "Organization").every((row) => !githubProjectsReadGranted(row.permissions)) ? "permission_required" : projectRows.length ? projectRows.some((row) => row.syncStatus === "error" || row.syncStatus === "permission_required") ? "partial" : "connected" : "none",
      selected: projectRows.map((row) => ({ id: row.id, title: row.title, url: row.url, syncStatus: row.syncStatus, lastSyncedAt: row.lastSuccessAt?.toISOString() ?? null, lastError: row.lastError })),
      canManage: canManageSettings(principal.role),
    },
    lastUsageAt: lastUsage?.date.toISOString() ?? null,
    lastUsageSyncAt: lastDevice?.lastUsageSyncAt?.toISOString() ?? null,
    limits: [
      "Eligible AI usage includes developer-level costs available for allocation; organization-level API-key costs are excluded.",
      "Verified usage and estimated API costs are kept separate. Unattributed is part of their combined total.",
      "Costs are allocated by UTC day and repository. Change types use explicit commit prefixes only.",
    ],
  };
}

export type WorkSpendPagePayload = Awaited<ReturnType<typeof loadWorkSpendPage>>;
