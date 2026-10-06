import { prisma } from "@usejunction/db";
import type { AppPrincipal } from "@/lib/api/app-auth";
import { githubAuthorScopeFromConnection, githubMemberLoginsFromConfig, isInAnyGitHubAuthorScope } from "@/lib/features/github-authors";
import { FEATURE_COST_WINDOW_DAYS, featureCostWindow, ticketKeyFromJson } from "@/lib/features/allocate";
import { githubConnectionView, listWorkspaceGitHubConnections, summarizeGitHubConnections } from "@/lib/integrations/github-connections";
import { canManageSettings } from "@/lib/rbac/permissions";

const ZERO = BigInt(0);
const TWO = BigInt(2);
const THOUSAND = BigInt(1000);

function microsString(value: bigint) {
  return value.toString();
}

function median(values: bigint[]): bigint {
  if (values.length === 0) return ZERO;
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? ZERO;
  return ((sorted[mid - 1] ?? ZERO) + (sorted[mid] ?? ZERO)) / TWO;
}

export async function loadFeaturesPage(principal: AppPrincipal, search: { days?: string | null } = {}) {
  const parsedDays = Number(search.days ?? FEATURE_COST_WINDOW_DAYS);
  const { from, to, days } = featureCostWindow(new Date(), Number.isFinite(parsedDays) ? parsedDays : FEATURE_COST_WINDOW_DAYS);
  const endExclusive = new Date(to.getTime() + 86_400_000);

  const [githubRows, developers, allocations, unmappedCommits, windowCommits, lastUsage, lastDevice] = await Promise.all([
    listWorkspaceGitHubConnections(principal.orgId),
    prisma.developer.findMany({
      where: { orgId: principal.orgId, removedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.featureCostAllocation.findMany({
      where: { orgId: principal.orgId, date: { gte: from, lte: to } },
      include: {
        developer: { select: { id: true, name: true } },
        repository: { select: { owner: true, name: true } },
      },
    }),
    prisma.gitCommit.groupBy({
      by: ["authorLogin"],
      where: { orgId: principal.orgId, isBot: false, authorDeveloperId: null, authorLogin: { not: null } },
      _count: { _all: true },
    }),
    prisma.gitCommit.findMany({
      where: {
        orgId: principal.orgId,
        isBot: false,
        authoredAt: { gte: from, lt: endExclusive },
        authorDeveloperId: { not: null },
      },
      select: {
        sha: true,
        messageHeadline: true,
        ticketKeys: true,
        authorLogin: true,
        authoredAt: true,
        repository: { select: { owner: true, name: true } },
      },
      orderBy: { authoredAt: "desc" },
    }),
    prisma.usageDaily.findFirst({
      where: { orgId: principal.orgId, costMicros: { gt: 0 } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.device.findFirst({
      where: { orgId: principal.orgId },
      orderBy: { lastUsageSyncAt: "desc" },
      select: { lastUsageSyncAt: true },
    }),
  ]);

  const connections = githubRows.map((row) => githubConnectionView(row));
  const connection = summarizeGitHubConnections(connections);
  const authorScopes = githubRows.map((row) => githubAuthorScopeFromConnection({
    accountType: githubConnectionView(row).accountType,
    memberLogins: githubMemberLoginsFromConfig(row.config),
    developers,
  }));

  let verifiedMicros = ZERO;
  let estimatedMicros = ZERO;
  let unattributedMicros = ZERO;
  const perCommitCost = new Map<string, bigint>();
  const featureMap = new Map<string, {
    ticketKey: string;
    verifiedMicros: bigint;
    estimatedMicros: bigint;
    commitCount: number;
    developers: Map<string, string>;
  }>();
  const unlinkedCost = new Map<string, {
    sha: string;
    verifiedMicros: bigint;
    estimatedMicros: bigint;
    developers: Map<string, string>;
    repository: { owner: string; name: string } | null;
  }>();

  for (const row of allocations) {
    if (row.costKind === "verified_usage") verifiedMicros += row.costMicros;
    else if (row.costKind === "estimated_api") estimatedMicros += row.costMicros;
    if (row.method === "unattributed") unattributedMicros += row.costMicros;
    if (row.method === "commit_split") {
      const weight = Math.max(1, Math.round(row.weight));
      const perUnit = row.costMicros / BigInt(weight);
      const medianKey = row.commitSha ?? row.ticketKey ?? row.id;
      perCommitCost.set(medianKey, (perCommitCost.get(medianKey) ?? ZERO) + perUnit);
    }
    if (row.ticketKey) {
      const feature = featureMap.get(row.ticketKey) ?? {
        ticketKey: row.ticketKey,
        verifiedMicros: ZERO,
        estimatedMicros: ZERO,
        commitCount: 0,
        developers: new Map<string, string>(),
      };
      if (row.costKind === "verified_usage") feature.verifiedMicros += row.costMicros;
      if (row.costKind === "estimated_api") feature.estimatedMicros += row.costMicros;
      feature.developers.set(row.developer.id, row.developer.name);
      featureMap.set(row.ticketKey, feature);
      continue;
    }
    if (row.method === "unattributed" || !row.commitSha) continue;
    const current = unlinkedCost.get(row.commitSha) ?? {
      sha: row.commitSha,
      verifiedMicros: ZERO,
      estimatedMicros: ZERO,
      developers: new Map<string, string>(),
      repository: row.repository,
    };
    if (row.costKind === "verified_usage") current.verifiedMicros += row.costMicros;
    if (row.costKind === "estimated_api") current.estimatedMicros += row.costMicros;
    current.developers.set(row.developer.id, row.developer.name);
    unlinkedCost.set(row.commitSha, current);
  }

  const commitsByKey = new Map<string, number>();
  for (const commit of windowCommits) {
    const ticketKey = ticketKeyFromJson(commit.ticketKeys);
    if (!ticketKey) continue;
    commitsByKey.set(ticketKey, (commitsByKey.get(ticketKey) ?? 0) + 1);
  }
  for (const [ticketKey, count] of commitsByKey) {
    const feature = featureMap.get(ticketKey) ?? {
      ticketKey,
      verifiedMicros: ZERO,
      estimatedMicros: ZERO,
      commitCount: 0,
      developers: new Map<string, string>(),
    };
    feature.commitCount = count;
    featureMap.set(ticketKey, feature);
  }

  const unlinkedCommits = windowCommits
    .filter((commit) => !ticketKeyFromJson(commit.ticketKeys))
    .map((commit) => {
      const cost = unlinkedCost.get(commit.sha);
      return {
        sha: commit.sha,
        headline: commit.messageHeadline,
        authoredAt: commit.authoredAt.toISOString(),
        authorLogin: commit.authorLogin,
        repository: commit.repository,
        verifiedMicros: microsString(cost?.verifiedMicros ?? ZERO),
        estimatedMicros: microsString(cost?.estimatedMicros ?? ZERO),
        developers: cost ? [...cost.developers.values()] : [],
      };
    });

  const total = verifiedMicros + estimatedMicros;
  const mappedPct = total <= ZERO ? 0 : Number((total - unattributedMicros) * THOUSAND / total) / 10;

  const inScopeUnmapped = unmappedCommits.filter((row) => {
    const login = row.authorLogin;
    return login ? isInAnyGitHubAuthorScope(login, authorScopes) : false;
  });
  const lastUsageAt = lastUsage?.date ?? null;
  const lastUsageSyncAt = lastDevice?.lastUsageSyncAt ?? null;
  const emptyReason: "unmapped" | "no_usage" | "stale_usage" | "no_ticket_keys" | null = featureMap.size > 0
    ? null
    : inScopeUnmapped.length > 0
      ? "unmapped"
      : total > ZERO
        ? "no_ticket_keys"
        : lastUsageAt && lastUsageAt < from
          ? "stale_usage"
          : "no_usage";
  const identities = await prisma.externalIdentity.findMany({
    where: { orgId: principal.orgId, provider: "github", externalUserId: { in: inScopeUnmapped.map((row) => row.authorLogin!).filter(Boolean) } },
    select: { id: true, externalUserId: true, email: true },
  });
  const identityByLogin = new Map(identities.map((identity) => [identity.externalUserId.toLowerCase(), identity]));

  return {
    days,
    window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    canMapIdentities: canManageSettings(principal.role),
    connection,
    connections,
    kpis: {
      mappedPct,
      verifiedMicros: microsString(verifiedMicros),
      estimatedMicros: microsString(estimatedMicros),
      unattributedMicros: microsString(unattributedMicros),
      medianCostPerCommit: microsString(median([...perCommitCost.values()])),
    },
    features: [...featureMap.values()]
      .sort((left, right) => Number(right.verifiedMicros + right.estimatedMicros - left.verifiedMicros - left.estimatedMicros))
      .map((feature) => ({
        ticketKey: feature.ticketKey,
        commitCount: feature.commitCount,
        verifiedMicros: microsString(feature.verifiedMicros),
        estimatedMicros: microsString(feature.estimatedMicros),
        developers: [...feature.developers.values()],
      })),
    unlinkedCommits,
    emptyReason,
    lastUsageAt: lastUsageAt?.toISOString() ?? null,
    lastUsageSyncAt: lastUsageSyncAt?.toISOString() ?? null,
    unmappedAuthors: inScopeUnmapped
      .filter((row) => row.authorLogin)
      .map((row) => {
        const login = row.authorLogin!;
        const identity = identityByLogin.get(login.toLowerCase());
        const suggested = developers.find((developer) => developer.email.split("@")[0]?.toLowerCase() === login);
        return {
          identityId: identity?.id ?? null,
          login,
          commitCount: row._count._all,
          suggestedDeveloperId: suggested?.id ?? null,
        };
      }),
    developers,
    limits: [
      "Dollars are per UTC day; multi-feature days are split by commit count.",
      "Cost rows without a developer (org-level API keys) are excluded from feature totals.",
      "Only repositories granted to connected GitHub accounts are synced. Ticket keys are parsed from commit messages.",
    ],
  };
}

export type FeaturesPagePayload = Awaited<ReturnType<typeof loadFeaturesPage>>;
