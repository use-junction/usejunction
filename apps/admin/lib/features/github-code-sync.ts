import { prisma, type Prisma, type ProviderConnection } from "@usejunction/db";
import { normalizeEmail } from "@/lib/developer-identity";
import {
  allocateDeveloperDay,
  FEATURE_COST_VERSION,
  FEATURE_COST_WINDOW_DAYS,
  featureCostWindow,
  type AllocationRow,
  type CommitCandidate,
  type FeatureCostKind,
} from "@/lib/features/allocate";
import {
  githubAuthorScopeFromConnection,
  githubMemberLoginsFromConfig,
  githubUserIdFromMetadata,
  isInScopeGitHubLogin,
  matchDeveloperForGitHubAuthor,
  mergeGithubIdentityMetadata,
  nextGitHubAuthorResolution,
  reposOwnedByInstallation,
  soleDeveloperMatch,
  uniqueDeveloperLoginMap,
  type GitHubAuthorScope,
} from "@/lib/features/github-authors";
import {
  DEFAULT_BRANCH_HISTORY_QUERY,
  mapCommitNode,
  mapPullRequestNode,
  mapRestCommit,
  mergeCommitRecords,
  PULL_REQUEST_COMMITS_QUERY,
  REPO_PULL_REQUESTS_QUERY,
  type GraphqlCommitNode,
  type GraphqlPullRequest,
  type MappedCommit,
  type MappedPullRequest,
} from "@/lib/features/github-mapper";
import { isBotLogin, parseNoreply } from "@/lib/features/ticket-keys";
import { reconcileGitHubRepositoryAccess, type InstallationRepo } from "@/lib/features/github-repository-access";
import {
  getGitHubInstallation,
  githubCodePermissionsGranted,
  githubGraphql,
  githubInstallationHeaders,
  githubInstallationToken,
  githubMembersReadGranted,
  isGitHubPermissionDenied,
  listGitHubOrgMembers,
  normalizeGitHubAccountType,
} from "@/lib/integrations/github-app";
import { fetchJson } from "@/lib/integrations/http";
import { isGitHubEmptyRepositoryError, sanitizeGitHubSyncError } from "@/lib/integrations/github-empty-repo";
import { dimension, metricBigInt, readUsageMetrics } from "@/lib/analytics/query/read";
import type { IntegrationConfig } from "@/lib/integrations/types";
import { JUNCTION_EXTRACTION_SCHEMA_VERSION } from "@usejunction/usage-schema";
import { wakeGitHubAuthorDaemons } from "@/lib/features/autosync";
import { logServerError } from "@/lib/errors/public";

function configOf(connection: ProviderConnection): IntegrationConfig {
  return (connection.config ?? {}) as IntegrationConfig;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export type GitHubCodeSyncResult = {
  skipped: boolean;
  reason?: string;
  repositories: number;
  pullRequests: number;
  commits: number;
  failedRepositories?: number;
};

async function recordCapability(
  connection: ProviderConnection,
  capability: "pull_requests" | "org_members",
  input: { status: string; error?: string | null; cursor?: string | null; endpoint: string },
) {
  await prisma.providerConnectionCapability.upsert({
    where: { connectionId_capability: { connectionId: connection.id, capability } },
    update: {
      status: input.status,
      endpoint: input.endpoint,
      cursor: input.cursor ?? undefined,
      lastCheckedAt: new Date(),
      lastSuccessAt: input.status === "available" ? new Date() : undefined,
      lastError: input.error ?? null,
      schemaVersion: JUNCTION_EXTRACTION_SCHEMA_VERSION,
    },
    create: {
      orgId: connection.orgId,
      connectionId: connection.id,
      capability,
      endpoint: input.endpoint,
      status: input.status,
      cursor: input.cursor ?? null,
      lastCheckedAt: new Date(),
      lastSuccessAt: input.status === "available" ? new Date() : null,
      lastError: input.error ?? null,
      schemaVersion: JUNCTION_EXTRACTION_SCHEMA_VERSION,
    },
  });
}

async function recordPullRequestsCapability(
  connection: ProviderConnection,
  input: { status: string; error?: string | null; cursor?: string | null },
) {
  await recordCapability(connection, "pull_requests", { ...input, endpoint: "github.graphql.pullRequests" });
}

async function recordOrgMembersCapability(
  connection: ProviderConnection,
  input: { status: string; error?: string | null; cursor?: string | null },
) {
  await recordCapability(connection, "org_members", { ...input, endpoint: "github.orgs.members" });
}

async function listInstallationRepositories(token: string) {
  const repos: InstallationRepo[] = [];
  for (let page = 1; page <= 500; page += 1) {
    const payload = await fetchJson<{ repositories?: InstallationRepo[]; total_count?: number }>(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      { headers: githubInstallationHeaders(token) },
    );
    if (!Array.isArray(payload.repositories) || payload.repositories.some((repo) => !repo?.name || !repo.owner?.login)) {
      throw new Error("GitHub returned an incomplete installation repository listing; access was not reconciled");
    }
    const rows = payload.repositories;
    repos.push(...rows);
    if (rows.length < 100 || (typeof payload.total_count === "number" && repos.length >= payload.total_count)) return repos;
  }
  throw new Error("GitHub repository listing exceeded the sync pagination limit; access was not reconciled");
}

type AuthorHint = { login: string | null; email: string | null; githubUserId: string | number | null };

export async function resolveAuthors(
  orgId: string,
  connectionId: string,
  hints: AuthorHint[],
  scope: GitHubAuthorScope,
) {
  const identities = await prisma.externalIdentity.findMany({
    where: { orgId, provider: "github" },
  });
  const byLogin = new Map(identities.map((identity) => [identity.externalUserId.toLowerCase(), identity]));
  const developers = await prisma.developer.findMany({
    where: { orgId, removedAt: null },
    select: { id: true, email: true, authUserId: true },
  });
  const byEmail = new Map(developers.map((developer) => [developer.email, developer.id]));
  const byUniqueLogin = uniqueDeveloperLoginMap(developers);
  const authUserIds = developers.map((developer) => developer.authUserId).filter((id): id is string => Boolean(id));
  const byGithubUserId = new Map<string, string>();
  if (authUserIds.length > 0) {
    const accounts = await prisma.account.findMany({
      where: { provider: "github", userId: { in: authUserIds } },
      select: { userId: true, providerAccountId: true },
    });
    const developerByAuthUser = new Map(
      developers.flatMap((developer) => (developer.authUserId ? [[developer.authUserId, developer.id] as const] : [])),
    );
    for (const account of accounts) {
      const developerId = developerByAuthUser.get(account.userId);
      if (developerId && account.providerAccountId) byGithubUserId.set(account.providerAccountId, developerId);
    }
  }

  const resolved = new Map<string, string | null>();
  const ordered = [...hints].sort((left, right) => {
    const idRank = Number(Boolean(right.githubUserId)) - Number(Boolean(left.githubUserId));
    if (idRank !== 0) return idRank;
    return Number(Boolean(right.email)) - Number(Boolean(left.email));
  });

  for (const hint of ordered) {
    const login = hint.login?.toLowerCase() ?? parseNoreply(hint.email)?.login?.toLowerCase() ?? null;
    if (!login || isBotLogin(login) || resolved.has(login)) continue;
    const existing = byLogin.get(login);
    const email = hint.email ? normalizeEmail(hint.email) : existing?.email ?? null;
    const githubUserId = hint.githubUserId ?? githubUserIdFromMetadata(existing?.metadata);
    const matched = matchDeveloperForGitHubAuthor({
      login,
      email,
      githubUserId,
      byGithubUserId,
      byEmail,
      byUniqueLogin,
    });
    const ranked = nextGitHubAuthorResolution({
      existingMatchedBy: existing?.matchedBy,
      existingDeveloperId: existing?.developerId,
      inScope: isInScopeGitHubLogin(login, scope),
      matched: matched.developerId
        ? matched
        : soleDeveloperMatch(developers, scope, login),
    });
    if (!ranked.persist) {
      resolved.set(login, ranked.developerId);
      continue;
    }
    const developerId = ranked.developerId;
    const matchedBy = ranked.matchedBy;
    const corporateEmail = email && !email.endsWith("@users.noreply.github.com") ? email : null;
    const metadata = mergeGithubIdentityMetadata(existing?.metadata, githubUserId);
    const identity = await prisma.externalIdentity.upsert({
      where: { orgId_provider_externalUserId: { orgId, provider: "github", externalUserId: login } },
      update: {
        connectionId,
        email: corporateEmail ?? existing?.email ?? null,
        developerId: developerId ?? undefined,
        matchedBy,
        metadata: json(metadata),
        observedAt: new Date(),
      },
      create: {
        orgId,
        connectionId,
        provider: "github",
        externalUserId: login,
        email: corporateEmail,
        developerId,
        source: "vendor_verified",
        matchedBy,
        metadata: json(metadata),
      },
    });
    byLogin.set(login, identity);
    resolved.set(login, identity.developerId);
  }
  return resolved;
}

type GraphqlPageInfo = { hasNextPage?: boolean; endCursor?: string | null };

type RepoPullRequestsData = {
  repository?: {
    pullRequests?: {
      pageInfo?: GraphqlPageInfo;
      nodes?: GraphqlPullRequest[];
    };
  };
};

type PullRequestCommitsData = {
  repository?: {
    pullRequest?: {
      commits?: {
        pageInfo?: GraphqlPageInfo;
        nodes?: Array<{ commit?: GraphqlCommitNode | null }>;
      };
    };
  };
};

type DefaultBranchHistoryData = {
  repository?: {
    defaultBranchRef?: {
      target?: {
        history?: {
          pageInfo?: GraphqlPageInfo;
          nodes?: GraphqlCommitNode[];
        };
      };
    };
  };
};

async function fetchPullRequests(
  token: string,
  owner: string,
  name: string,
  cutoff: Date,
): Promise<MappedPullRequest[]> {
  const mapped: MappedPullRequest[] = [];
  let after: string | null = null;
  for (;;) {
    const data: RepoPullRequestsData = await githubGraphql<RepoPullRequestsData>(
      token,
      REPO_PULL_REQUESTS_QUERY,
      { owner, name, after },
    );
    const connection = data.repository?.pullRequests;
    const nodes = connection?.nodes ?? [];
    let stop = false;
    for (const node of nodes) {
      if (node.updatedAt && new Date(node.updatedAt) < cutoff) {
        stop = true;
        break;
      }
      const pr = mapPullRequestNode(node);
      if (pr) mapped.push(pr);
    }
    if (stop || !connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  for (const pr of mapped) {
    if (!pr.needsCommitPaging) continue;
    let cursor: string | null = null;
    for (;;) {
      const extra: PullRequestCommitsData = await githubGraphql<PullRequestCommitsData>(
        token,
        PULL_REQUEST_COMMITS_QUERY,
        { owner, name, number: pr.number, after: cursor },
      );
      const commits = extra.repository?.pullRequest?.commits;
      for (const node of commits?.nodes ?? []) {
        const mappedCommit = node?.commit
          ? mapCommitNode(node.commit, { pullRequestNumber: pr.number, isDirectPush: false, fallbackLogin: pr.authorLogin })
          : null;
        if (mappedCommit && !pr.commits.some((commit) => commit.sha === mappedCommit.sha)) {
          pr.commits.push(mappedCommit);
        }
      }
      if (!commits?.pageInfo?.hasNextPage) break;
      cursor = commits.pageInfo.endCursor ?? null;
      if (!cursor) break;
    }
  }
  return mapped;
}

async function fetchDefaultBranchCommits(token: string, owner: string, name: string, cutoff: Date): Promise<MappedCommit[]> {
  const mapped: MappedCommit[] = [];
  let after: string | null = null;
  for (;;) {
    const data: DefaultBranchHistoryData = await githubGraphql<DefaultBranchHistoryData>(
      token,
      DEFAULT_BRANCH_HISTORY_QUERY,
      { owner, name, since: cutoff.toISOString(), after },
    );
    const history = data.repository?.defaultBranchRef?.target?.history;
    for (const node of history?.nodes ?? []) {
      const commit = mapCommitNode(node, { isDirectPush: (node.associatedPullRequests?.totalCount ?? 0) === 0 });
      if (commit) mapped.push(commit);
    }
    if (!history?.pageInfo?.hasNextPage) break;
    after = history.pageInfo.endCursor ?? null;
    if (!after) break;
  }
  return mapped;
}

async function fetchRestCommits(token: string, owner: string, name: string, cutoff: Date): Promise<MappedCommit[]> {
  const mapped: MappedCommit[] = [];
  try {
    for (let page = 1; page <= 20; page += 1) {
      const rows = await fetchJson<Array<Parameters<typeof mapRestCommit>[0]>>(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?since=${encodeURIComponent(cutoff.toISOString())}&per_page=100&page=${page}`,
        { headers: githubInstallationHeaders(token) },
      );
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        const commit = mapRestCommit(row);
        if (commit) mapped.push(commit);
      }
      if (rows.length < 100) break;
    }
  } catch (error) {
    if (isGitHubEmptyRepositoryError(error)) return [];
    throw error;
  }
  return mapped;
}

async function persistRepoWork(input: {
  orgId: string;
  connectionId: string;
  repositoryId: string;
  pullRequests: MappedPullRequest[];
  commits: MappedCommit[];
  authors: Map<string, string | null>;
}) {
  const prIds = new Map<number, string>();
  for (const pr of input.pullRequests) {
    const row = await prisma.gitPullRequest.upsert({
      where: { repositoryId_number: { repositoryId: input.repositoryId, number: pr.number } },
      update: {
        title: pr.title,
        state: pr.state,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        authorLogin: pr.authorLogin,
        authorDeveloperId: pr.authorLogin ? input.authors.get(pr.authorLogin.toLowerCase()) ?? null : null,
        url: pr.url,
        githubCreatedAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        closedAt: pr.closedAt,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        ticketKeys: pr.ticketKeys,
        closingIssues: json(pr.closingIssues),
        syncedAt: new Date(),
      },
      create: {
        orgId: input.orgId,
        connectionId: input.connectionId,
        repositoryId: input.repositoryId,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        authorLogin: pr.authorLogin,
        authorDeveloperId: pr.authorLogin ? input.authors.get(pr.authorLogin.toLowerCase()) ?? null : null,
        url: pr.url,
        githubCreatedAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        closedAt: pr.closedAt,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        ticketKeys: pr.ticketKeys,
        closingIssues: json(pr.closingIssues),
      },
    });
    prIds.set(pr.number, row.id);
  }

  const bySha = new Map<string, MappedCommit>();
  for (const commit of input.commits) {
    bySha.set(commit.sha, mergeCommitRecords(bySha.get(commit.sha), commit));
  }
  for (const commit of bySha.values()) {
    if (commit.isBot) continue;
    await prisma.gitCommit.upsert({
      where: { repositoryId_sha: { repositoryId: input.repositoryId, sha: commit.sha } },
      update: {
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        authorEmail: commit.authorEmail,
        authorLogin: commit.authorLogin,
        authorDeveloperId: commit.authorLogin ? input.authors.get(commit.authorLogin.toLowerCase()) ?? null : null,
        messageHeadline: commit.messageHeadline,
        additions: commit.additions,
        deletions: commit.deletions,
        pullRequestId: commit.pullRequestNumber ? prIds.get(commit.pullRequestNumber) ?? null : null,
        isDirectPush: commit.isDirectPush,
        isBot: commit.isBot,
        ticketKeys: commit.ticketKeys,
      },
      create: {
        orgId: input.orgId,
        repositoryId: input.repositoryId,
        sha: commit.sha,
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        authorEmail: commit.authorEmail,
        authorLogin: commit.authorLogin,
        authorDeveloperId: commit.authorLogin ? input.authors.get(commit.authorLogin.toLowerCase()) ?? null : null,
        messageHeadline: commit.messageHeadline,
        additions: commit.additions,
        deletions: commit.deletions,
        pullRequestId: commit.pullRequestNumber ? prIds.get(commit.pullRequestNumber) ?? null : null,
        isDirectPush: commit.isDirectPush,
        isBot: commit.isBot,
        ticketKeys: commit.ticketKeys,
      },
    });
  }
}

export async function runFeatureCostAllocation(
  orgId: string,
  window: { from: Date; to: Date },
  developerIds?: string[],
) {
  const developers = developerIds?.length
    ? developerIds
    : (await prisma.developer.findMany({ where: { orgId, removedAt: null }, select: { id: true } })).map((row) => row.id);
  if (developers.length === 0) return { rows: 0 };
  const from = window.from;
  const to = window.to;
  const endExclusive = new Date(to.getTime() + 86_400_000);

  const commits = await prisma.gitCommit.findMany({
    where: {
      orgId,
      isBot: false,
      authoredAt: { gte: from, lt: endExclusive },
      ...(developers.length ? { authorDeveloperId: { in: developers } } : {}),
    },
    select: {
      sha: true, authoredAt: true, authorDeveloperId: true, repositoryId: true, pullRequestId: true,
    },
  });

  const commitCandidatesByDev = new Map<string, CommitCandidate[]>();
  for (const commit of commits) {
    if (!commit.authorDeveloperId) continue;
    const list = commitCandidatesByDev.get(commit.authorDeveloperId) ?? [];
    list.push({
      sha: commit.sha,
      pullRequestId: commit.pullRequestId,
      authoredAt: commit.authoredAt,
      repositoryId: commit.repositoryId,
    });
    commitCandidatesByDev.set(commit.authorDeveloperId, list);
  }

  const rows: AllocationRow[] = [];
  for (const developerId of developers) {
    const envelope = await readUsageMetrics({
      orgId,
      developerId,
      window: { from, to },
      measures: ["costMicros"],
      dimensions: ["day", "costKind", "repository"],
      filters: { costKinds: ["verified_usage", "estimated_api", "actual_spend"] },
      limit: 500,
    });
    for (const row of envelope.data.rows) {
      const rawKind = dimension(row, "costKind");
      const costKind = rawKind === "actual_spend" ? "verified_usage" : rawKind;
      if (costKind !== "verified_usage" && costKind !== "estimated_api") continue;
      const date = dimension(row, "day");
      if (!date) continue;
      const repositoryId = dimension(row, "repository") || null;
      const costMicros = metricBigInt(row, "costMicros");
      if (costMicros <= BigInt(0)) continue;
      rows.push(
        ...allocateDeveloperDay({
          bucket: {
            developerId,
            date,
            costKind: costKind as FeatureCostKind,
            repositoryId,
            costMicros,
          },
          commits: commitCandidatesByDev.get(developerId) ?? [],
        }),
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.featureCostAllocation.deleteMany({
      where: {
        orgId,
        date: { gte: from, lte: to },
        ...(developerIds?.length ? { developerId: { in: developerIds } } : {}),
      },
    });
    if (rows.length === 0) return;
    await tx.featureCostAllocation.createMany({
      data: rows.map((row) => ({
        orgId,
        date: new Date(`${row.date}T00:00:00.000Z`),
        developerId: row.developerId,
        repositoryId: row.repositoryId,
        pullRequestId: row.pullRequestId,
        commitSha: row.commitSha,
        ticketKey: row.ticketKey,
        ticketKeySource: row.ticketKeySource,
        costKind: row.costKind,
        costMicros: row.costMicros,
        weight: row.weight,
        method: row.method,
        calculationVersion: FEATURE_COST_VERSION,
      })),
    });
  });

  return { rows: rows.length };
}

export async function resetGitHubFeatureData(orgId: string, connectionId?: string) {
  if (connectionId) {
    await removeGitHubConnectionWork(orgId, connectionId, { dropIdentitiesIfLast: false, rebuildAllocations: false });
    return;
  }
  await prisma.gitHubRepositoryAccess.deleteMany({ where: { orgId } });
  await prisma.featureCostAllocation.deleteMany({ where: { orgId } });
  await prisma.gitCommit.deleteMany({ where: { orgId } });
  await prisma.gitPullRequest.deleteMany({ where: { orgId } });
  await prisma.externalIdentity.deleteMany({ where: { orgId, provider: "github" } });
  const kept = await prisma.usageDaily.findMany({
    where: { orgId, repositoryId: { not: null } },
    select: { repositoryId: true },
    distinct: ["repositoryId"],
  });
  const keepIds = kept.map((row) => row.repositoryId).filter((id): id is string => Boolean(id));
  await prisma.repository.deleteMany({
    where: {
      orgId,
      host: "github.com",
      ...(keepIds.length ? { id: { notIn: keepIds } } : {}),
    },
  });
}

export async function removeGitHubConnectionWork(
  orgId: string,
  connectionId: string,
  options: { dropIdentitiesIfLast?: boolean; rebuildAllocations?: boolean } = {},
) {
  const dropIdentitiesIfLast = options.dropIdentitiesIfLast ?? true;
  const rebuildAllocations = options.rebuildAllocations ?? true;
  await prisma.gitHubRepositoryAccess.deleteMany({ where: { orgId, connectionId } });
  await prisma.gitPullRequest.deleteMany({ where: { orgId, connectionId } });
  const remainingGrants = await prisma.gitHubRepositoryAccess.findMany({
    where: {
      orgId,
      connection: { provider: "github", status: { not: "disconnected" }, id: { not: connectionId } },
    },
    select: { repositoryId: true },
  });
  const remainingRepoIds = [...new Set(remainingGrants.map((row) => row.repositoryId))];
  await prisma.gitCommit.deleteMany({
    where: { orgId, ...(remainingRepoIds.length ? { repositoryId: { notIn: remainingRepoIds } } : {}) },
  });
  const usageKept = await prisma.usageDaily.findMany({
    where: { orgId, repositoryId: { not: null } },
    select: { repositoryId: true },
    distinct: ["repositoryId"],
  });
  const keepIds = [...new Set([
    ...remainingRepoIds,
    ...usageKept.map((row) => row.repositoryId).filter((id): id is string => Boolean(id)),
  ])];
  await prisma.repository.deleteMany({
    where: {
      orgId,
      host: "github.com",
      ...(keepIds.length ? { id: { notIn: keepIds } } : {}),
    },
  });
  await prisma.externalIdentity.updateMany({
    where: { orgId, provider: "github", connectionId },
    data: { connectionId: null },
  });
  if (dropIdentitiesIfLast) {
    const remaining = await prisma.providerConnection.count({
      where: { orgId, provider: "github", status: { not: "disconnected" }, id: { not: connectionId } },
    });
    if (remaining === 0) {
      await prisma.externalIdentity.deleteMany({ where: { orgId, provider: "github" } });
    }
  }
  await prisma.providerConnectionCapability.updateMany({
    where: { connectionId, capability: { in: ["pull_requests", "org_members"] } },
    data: { lastSuccessAt: null, cursor: null, status: "unknown", lastError: null },
  });
  await prisma.featureCostAllocation.deleteMany({ where: { orgId } });
  if (rebuildAllocations && remainingRepoIds.length > 0) {
    await runFeatureCostAllocation(orgId, featureCostWindow(new Date(), FEATURE_COST_WINDOW_DAYS));
  }
}

export async function restampGitAuthor(orgId: string, login: string, developerId: string | null) {
  const normalized = login.toLowerCase();
  await prisma.gitPullRequest.updateMany({
    where: { orgId, authorLogin: normalized },
    data: { authorDeveloperId: developerId },
  });
  await prisma.gitCommit.updateMany({
    where: { orgId, authorLogin: normalized },
    data: { authorDeveloperId: developerId },
  });
}

export async function runCommitUsageMapping(
  orgId: string,
  window: { from: Date; to: Date },
  options: { connectionId?: string; developerIds?: string[]; scope?: GitHubAuthorScope } = {},
) {
  const connection = await prisma.providerConnection.findFirst({
    where: {
      orgId,
      provider: "github",
      status: { not: "disconnected" },
      ...(options.connectionId ? { id: options.connectionId } : {}),
    },
  });
  if (connection) {
    const config = configOf(connection);
    const developers = await prisma.developer.findMany({
      where: { orgId, removedAt: null },
      select: { email: true },
    });
    const scope = options.scope ?? githubAuthorScopeFromConnection({
      accountType: normalizeGitHubAccountType(config.accountType) ?? "Organization",
      memberLogins: githubMemberLoginsFromConfig(connection.config),
      developers,
    });
    const [authorLogins, identities] = await Promise.all([
      prisma.gitCommit.groupBy({
        by: ["authorLogin"],
        where: { orgId, isBot: false, authorLogin: { not: null } },
      }),
      prisma.externalIdentity.findMany({
        where: { orgId, provider: "github" },
        select: { externalUserId: true, email: true, metadata: true },
      }),
    ]);
    const hints: AuthorHint[] = [
      ...authorLogins.map((row) => ({ login: row.authorLogin, email: null, githubUserId: null })),
      ...identities.map((identity) => ({
        login: identity.externalUserId,
        email: identity.email,
        githubUserId: githubUserIdFromMetadata(identity.metadata),
      })),
    ];
    const resolved = await resolveAuthors(orgId, connection.id, hints, scope);
    for (const [login, developerId] of resolved) {
      await restampGitAuthor(orgId, login, developerId);
    }
  }
  return runFeatureCostAllocation(orgId, window, options.developerIds);
}

export async function remapGitHubAuthorAfterUsageSync(orgId: string, developerId: string) {
  const [identity, connection] = await Promise.all([
    prisma.externalIdentity.findFirst({
      where: { orgId, provider: "github", developerId },
      select: { id: true },
    }),
    prisma.providerConnection.findFirst({
      where: { orgId, provider: "github", status: { not: "disconnected" } },
      select: { id: true },
    }),
  ]);
  if (!identity || !connection) return { skipped: true as const, rows: 0 };
  return runCommitUsageMapping(orgId, featureCostWindow(new Date(), FEATURE_COST_WINDOW_DAYS), {
    connectionId: connection.id,
    developerIds: [developerId],
  });
}

async function wakeMappedAuthorDaemons(
  orgId: string,
  options: { force?: boolean } = {},
) {
  try {
    return await wakeGitHubAuthorDaemons(orgId, options);
  } catch (error) {
    logServerError("features/github-author-daemons", error, { orgId });
    return { skipped: true, reason: "wake_failed", developers: 0, devices: 0, requestsCreated: 0 };
  }
}

export async function syncGitHubCode(
  connection: ProviderConnection,
  options: { initial?: boolean; reset?: boolean; forceAuthorWake?: boolean } = {},
): Promise<GitHubCodeSyncResult> {
  try {
    return await syncGitHubCodeInner(connection, options);
  } finally {
    await wakeMappedAuthorDaemons(connection.orgId, { force: Boolean(options.forceAuthorWake) });
  }
}

async function syncGitHubCodeInner(
  connection: ProviderConnection,
  options: { initial?: boolean; reset?: boolean },
): Promise<GitHubCodeSyncResult> {
  const config = configOf(connection);
  const installationId = String(config.installationId ?? "");
  if (!installationId) {
    await recordPullRequestsCapability(connection, { status: "error", error: "missing installation id" });
    return { skipped: true, reason: "missing_installation", repositories: 0, pullRequests: 0, commits: 0 };
  }

  const installation = await getGitHubInstallation(installationId);
  const permissions = installation.permissions ?? {};
  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: { permissions: json(permissions), externalOrgId: installation.account?.login ?? connection.externalOrgId },
  });
  connection.permissions = permissions;

  if (!githubCodePermissionsGranted(permissions)) {
    await recordPullRequestsCapability(connection, { status: "permission_required", error: "pull_requests and contents read are required" });
    return { skipped: true, reason: "permission_required", repositories: 0, pullRequests: 0, commits: 0 };
  }

  const token = await githubInstallationToken(installationId);
  const accountLogin = String(installation.account?.login ?? config.org ?? connection.externalOrgId ?? "");
  const accountType = normalizeGitHubAccountType(installation.account?.type ?? config.accountType) ?? "Organization";
  const developers = await prisma.developer.findMany({
    where: { orgId: connection.orgId, removedAt: null },
    select: { email: true },
  });

  let memberLogins: string[] | null = null;
  if (accountType === "Organization") {
    if (!githubMembersReadGranted(permissions)) {
      await recordOrgMembersCapability(connection, {
        status: "permission_required",
        error: "members read is required to limit authors to GitHub org members",
      });
    } else {
      try {
        memberLogins = await listGitHubOrgMembers(token, accountLogin);
        await recordOrgMembersCapability(connection, {
          status: "available",
          cursor: String(memberLogins.length),
        });
      } catch (error) {
        if (isGitHubPermissionDenied(error)) {
          await recordOrgMembersCapability(connection, {
            status: "permission_required",
            error: "members read is required to limit authors to GitHub org members",
          });
        } else {
          await recordOrgMembersCapability(connection, {
            status: "error",
            error: error instanceof Error ? error.message.slice(0, 4000) : "unable to list GitHub org members",
          });
          throw error;
        }
      }
    }
    await prisma.providerConnection.update({
      where: { id: connection.id },
      data: {
        config: json({
          ...config,
          org: accountLogin || config.org,
          accountType,
          githubMemberLogins: memberLogins ? memberLogins.join(",") : null,
        }),
      },
    });
  } else {
    await recordOrgMembersCapability(connection, { status: "available", cursor: "user" });
  }

  const authorScope = githubAuthorScopeFromConnection({
    accountType,
    memberLogins,
    developers,
  });

  if (options.reset) {
    await resetGitHubFeatureData(connection.orgId, connection.id);
  }

  // Empty repos return 409 from GitHub's commits API; clear any leftover noise from earlier syncs.
  await prisma.gitHubRepositoryAccess.updateMany({
    where: {
      connectionId: connection.id,
      syncStatus: "error",
      lastError: { contains: "Git Repository is empty" },
    },
    data: { syncStatus: "available", lastError: null },
  });
  const pullRequestsCapability = await prisma.providerConnectionCapability.findUnique({
    where: { connectionId_capability: { connectionId: connection.id, capability: "pull_requests" } },
    select: { lastError: true, status: true },
  });
  if (pullRequestsCapability && isGitHubEmptyRepositoryError(pullRequestsCapability.lastError)) {
    await prisma.providerConnectionCapability.update({
      where: { connectionId_capability: { connectionId: connection.id, capability: "pull_requests" } },
      data: { status: "available", lastError: null },
    });
  }

  const cutoff = new Date(Date.now() - FEATURE_COST_WINDOW_DAYS * 86_400_000);
  const installationRepos = await listInstallationRepositories(token);
  const repos = reposOwnedByInstallation(installationRepos, accountLogin, accountType);
  const repoIds = await reconcileGitHubRepositoryAccess(connection.orgId, connection.id, repos);
  let pullRequestCount = 0;
  let commitCount = 0;
  const repoErrors: string[] = [];

  for (const repo of repos) {
    const owner = repo.owner?.login;
    if (!owner || !repo.name) continue;
    const repositoryId = repoIds.get(`${owner}/${repo.name}`.toLowerCase());
    if (!repositoryId) continue;
    const attemptedAt = new Date();
    await prisma.gitHubRepositoryAccess.update({
      where: { connectionId_repositoryId: { connectionId: connection.id, repositoryId } },
      data: { syncStatus: "syncing", lastAttemptAt: attemptedAt, lastError: null },
    });
    try {
      const pullRequests = await fetchPullRequests(token, owner, repo.name, cutoff);
      let history = await fetchDefaultBranchCommits(token, owner, repo.name, cutoff);
      if (history.length === 0) history = await fetchRestCommits(token, owner, repo.name, cutoff);
      const commits = [...pullRequests.flatMap((pr) => pr.commits), ...history];
      const hints: AuthorHint[] = [
        ...pullRequests.map((pr) => ({ login: pr.authorLogin, email: null, githubUserId: pr.authorGithubUserId })),
        ...commits.map((commit) => ({ login: commit.authorLogin, email: commit.authorEmail, githubUserId: commit.authorGithubUserId })),
      ];
      const authors = await resolveAuthors(connection.orgId, connection.id, hints, authorScope);
      await persistRepoWork({
        orgId: connection.orgId,
        connectionId: connection.id,
        repositoryId,
        pullRequests,
        commits,
        authors,
      });
      pullRequestCount += pullRequests.length;
      commitCount += commits.length;
      await prisma.gitHubRepositoryAccess.update({
        where: { connectionId_repositoryId: { connectionId: connection.id, repositoryId } },
        data: { syncStatus: "available", lastSuccessAt: new Date(), lastError: null },
      });
    } catch (error) {
      if (isGitHubEmptyRepositoryError(error)) {
        await prisma.gitHubRepositoryAccess.update({
          where: { connectionId_repositoryId: { connectionId: connection.id, repositoryId } },
          data: { syncStatus: "available", lastSuccessAt: new Date(), lastError: null },
        });
        continue;
      }
      const message = error instanceof Error ? error.message.slice(0, 300) : "repo sync failed";
      repoErrors.push(`${owner}/${repo.name}: ${message}`);
      await prisma.gitHubRepositoryAccess.update({
        where: { connectionId_repositoryId: { connectionId: connection.id, repositoryId } },
        data: { syncStatus: "error", lastError: message },
      });
    }
  }

  if (repos.length === 0) {
    await recordPullRequestsCapability(connection, {
      status: "error",
      error: accountType === "Organization"
        ? `GitHub install on ${accountLogin || "this org"} has no repositories. Grant the App access to org repos, then Sync now.`
        : "GitHub install has no repositories.",
    });
    return { skipped: true, reason: "no_repositories", repositories: 0, pullRequests: 0, commits: 0 };
  }

  await recordPullRequestsCapability(connection, {
    status: repoErrors.length && commitCount === 0 && pullRequestCount === 0 ? "error" : "available",
    error: sanitizeGitHubSyncError(repoErrors.length ? repoErrors.slice(0, 5).join("; ") : null),
    cursor: new Date().toISOString(),
  });
  await runCommitUsageMapping(connection.orgId, featureCostWindow(new Date(), FEATURE_COST_WINDOW_DAYS), {
    connectionId: connection.id,
    scope: authorScope,
  });
  return { skipped: false, repositories: repos.length, pullRequests: pullRequestCount, commits: commitCount, failedRepositories: repoErrors.length };
}
