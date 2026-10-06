import { firstTicketKey, isBotLogin, parseNoreply } from "@/lib/features/ticket-keys";

export const REPO_PULL_REQUESTS_QUERY = /* GraphQL */ `
query RepoPullRequests($owner: String!, $name: String!, $after: String) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    defaultBranchRef { name }
    pullRequests(
      first: 50
      after: $after
      states: [MERGED, OPEN]
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        isDraft
        headRefName
        baseRefName
        url
        createdAt
        updatedAt
        mergedAt
        closedAt
        additions
        deletions
        changedFiles
        author { login __typename ... on User { databaseId } }
        mergeCommit { oid }
        closingIssuesReferences(first: 20) {
          nodes { number title url }
        }
        commits(first: 100) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            commit {
              oid
              authoredDate
              committedDate
              messageHeadline
              additions
              deletions
              author { name email date user { login databaseId } }
              committer { name email date user { login } }
            }
          }
        }
      }
    }
  }
}
`;

export const PULL_REQUEST_COMMITS_QUERY = /* GraphQL */ `
query PullRequestCommits($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          commit {
            oid
            authoredDate
            committedDate
            messageHeadline
            additions
            deletions
            author { name email date user { login databaseId } }
            committer { name email date user { login } }
          }
        }
      }
    }
  }
}
`;

export const DEFAULT_BRANCH_HISTORY_QUERY = /* GraphQL */ `
query DefaultBranchHistory($owner: String!, $name: String!, $since: GitTimestamp!, $after: String) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      name
      target {
        ... on Commit {
          history(first: 100, after: $after, since: $since) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              authoredDate
              committedDate
              messageHeadline
              additions
              deletions
              author { name email date user { login databaseId } }
              committer { name email date user { login } }
              associatedPullRequests(first: 2) {
                totalCount
                nodes { number state merged }
              }
            }
          }
        }
      }
    }
  }
}
`;

export type GraphqlGitActor = {
  name?: string | null;
  email?: string | null;
  date?: string | null;
  user?: { login?: string | null; databaseId?: number | null } | null;
};

export type GraphqlCommitNode = {
  oid?: string | null;
  authoredDate?: string | null;
  committedDate?: string | null;
  messageHeadline?: string | null;
  additions?: number | null;
  deletions?: number | null;
  author?: GraphqlGitActor | null;
  committer?: GraphqlGitActor | null;
  associatedPullRequests?: {
    totalCount?: number;
    nodes?: Array<{ number?: number | null; state?: string | null; merged?: boolean | null } | null> | null;
  } | null;
};

export type GraphqlPullRequest = {
  number: number;
  title?: string | null;
  state?: string | null;
  headRefName?: string | null;
  baseRefName?: string | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  mergedAt?: string | null;
  closedAt?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
  author?: { login?: string | null; __typename?: string | null; databaseId?: number | null } | null;
  mergeCommit?: { oid?: string | null } | null;
  closingIssuesReferences?: {
    nodes?: Array<{ number?: number | null; title?: string | null; url?: string | null } | null> | null;
  } | null;
  commits?: {
    totalCount?: number;
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: Array<{ commit?: GraphqlCommitNode | null } | null> | null;
  } | null;
};

export type MappedPullRequest = {
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  headRefName: string | null;
  baseRefName: string | null;
  authorLogin: string | null;
  authorGithubUserId: number | null;
  url: string | null;
  createdAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  ticketKeys: string[];
  closingIssues: Array<{ number: number; title: string | null; url: string | null }>;
  commits: MappedCommit[];
  needsCommitPaging: boolean;
};

export type MappedCommit = {
  sha: string;
  authoredAt: Date;
  committedAt: Date;
  authorEmail: string | null;
  authorLogin: string | null;
  authorGithubUserId: number | null;
  messageHeadline: string;
  additions: number;
  deletions: number;
  pullRequestNumber: number | null;
  isDirectPush: boolean;
  isBot: boolean;
  ticketKeys: string[];
};

function parseDate(value: string | null | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeState(value: string | null | undefined): "open" | "merged" | "closed" {
  const state = (value ?? "").toLowerCase();
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  return "open";
}

function resolveCommitLogin(commit: GraphqlCommitNode): string | null {
  const login = commit.author?.user?.login ?? parseNoreply(commit.author?.email ?? null)?.login ?? null;
  if (login) return login.toLowerCase();
  return null;
}

export type RestCommit = {
  sha?: string | null;
  commit?: {
    message?: string | null;
    author?: { date?: string | null; email?: string | null; name?: string | null } | null;
    committer?: { date?: string | null } | null;
  } | null;
  author?: { login?: string | null; id?: number | null } | null;
  committer?: { login?: string | null } | null;
  stats?: { additions?: number | null; deletions?: number | null } | null;
};

export function mapRestCommit(row: RestCommit): MappedCommit | null {
  const sha = (row.sha ?? "").trim();
  if (!sha) return null;
  const login = row.author?.login?.toLowerCase() ?? parseNoreply(row.commit?.author?.email ?? null)?.login?.toLowerCase() ?? null;
  const authoredAt = parseDate(row.commit?.author?.date, parseDate(row.commit?.committer?.date));
  const headline = (row.commit?.message ?? "").split("\n")[0] ?? "";
  return {
    sha,
    authoredAt,
    committedAt: parseDate(row.commit?.committer?.date, authoredAt),
    authorEmail: row.commit?.author?.email?.toLowerCase() ?? null,
    authorLogin: login,
    authorGithubUserId: Number.isFinite(row.author?.id) ? Number(row.author?.id) : null,
    messageHeadline: headline.slice(0, 500),
    additions: row.stats?.additions ?? 0,
    deletions: row.stats?.deletions ?? 0,
    pullRequestNumber: null,
    isDirectPush: true,
    isBot: isBotLogin(login) || isBotLogin(row.committer?.login) || parseNoreply(row.commit?.author?.email ?? null)?.isBot === true,
    ticketKeys: [],
  };
}

export function mapCommitNode(
  commit: GraphqlCommitNode,
  options: { pullRequestNumber?: number | null; isDirectPush?: boolean; fallbackLogin?: string | null } = {},
): MappedCommit | null {
  const sha = (commit.oid ?? "").trim();
  if (!sha) return null;
  const login = resolveCommitLogin(commit) ?? options.fallbackLogin?.toLowerCase() ?? null;
  const authorGithubUserId = Number.isFinite(commit.author?.user?.databaseId)
    ? Number(commit.author?.user?.databaseId)
    : null;
  const committerLogin = commit.committer?.user?.login?.toLowerCase() ?? null;
  const isBot = isBotLogin(login) || isBotLogin(committerLogin) || parseNoreply(commit.author?.email ?? null)?.isBot === true;
  const authoredAt = parseDate(commit.authoredDate ?? commit.author?.date, parseDate(commit.committedDate));
  const associated = (commit.associatedPullRequests?.nodes ?? []).find((node) => node?.number);
  const pullRequestNumber = options.pullRequestNumber ?? associated?.number ?? null;
  const isDirectPush = options.isDirectPush ?? (commit.associatedPullRequests ? (commit.associatedPullRequests.totalCount ?? 0) === 0 : false);
  return {
    sha,
    authoredAt,
    committedAt: parseDate(commit.committedDate, authoredAt),
    authorEmail: commit.author?.email?.toLowerCase() ?? null,
    authorLogin: login,
    authorGithubUserId,
    messageHeadline: (commit.messageHeadline ?? "").slice(0, 500),
    additions: commit.additions ?? 0,
    deletions: commit.deletions ?? 0,
    pullRequestNumber,
    isDirectPush,
    isBot,
    ticketKeys: [],
  };
}

export function mapPullRequestNode(node: GraphqlPullRequest): MappedPullRequest | null {
  if (!node?.number || !node.createdAt) return null;
  const authorLogin = node.author?.login ? node.author.login.toLowerCase() : null;
  const authorGithubUserId = Number.isFinite(node.author?.databaseId) ? Number(node.author?.databaseId) : null;
  const commits = (node.commits?.nodes ?? [])
    .map((entry) => (entry?.commit ? mapCommitNode(entry.commit, { pullRequestNumber: node.number, isDirectPush: false, fallbackLogin: authorLogin }) : null))
    .filter((commit): commit is MappedCommit => Boolean(commit));
  return {
    number: node.number,
    title: node.title?.slice(0, 500) || `PR #${node.number}`,
    state: normalizeState(node.state),
    headRefName: node.headRefName ?? null,
    baseRefName: node.baseRefName ?? null,
    authorLogin,
    authorGithubUserId,
    url: node.url ?? null,
    createdAt: parseDate(node.createdAt),
    mergedAt: node.mergedAt ? parseDate(node.mergedAt) : null,
    closedAt: node.closedAt ? parseDate(node.closedAt) : null,
    updatedAt: node.updatedAt ? parseDate(node.updatedAt) : null,
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    changedFiles: node.changedFiles ?? 0,
    ticketKeys: [],
    closingIssues: (node.closingIssuesReferences?.nodes ?? [])
      .filter((issue): issue is { number: number; title?: string | null; url?: string | null } => Boolean(issue?.number))
      .map((issue) => ({ number: issue.number, title: issue.title ?? null, url: issue.url ?? null })),
    commits,
    needsCommitPaging: (node.commits?.totalCount ?? 0) > 100,
  };
}

export function mergeCommitRecords(existing: MappedCommit | undefined, incoming: MappedCommit): MappedCommit {
  if (!existing) return incoming;
  if (existing.isDirectPush && !incoming.isDirectPush) return incoming;
  if (!existing.pullRequestNumber && incoming.pullRequestNumber) return { ...existing, ...incoming, sha: existing.sha };
  return {
    ...existing,
    authorLogin: existing.authorLogin ?? incoming.authorLogin,
    authorEmail: existing.authorEmail ?? incoming.authorEmail,
    authorGithubUserId: existing.authorGithubUserId ?? incoming.authorGithubUserId,
    ticketKeys: [...new Set([...existing.ticketKeys, ...incoming.ticketKeys])],
    pullRequestNumber: existing.pullRequestNumber ?? incoming.pullRequestNumber,
    isDirectPush: existing.isDirectPush && incoming.isDirectPush,
    isBot: existing.isBot || incoming.isBot,
  };
}

export function firstKeyFrom(values: string[]): string | null {
  return firstTicketKey(values);
}
