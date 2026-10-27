/**
 * Set-based writes for the GitHub code sync.
 *
 * The sync used to issue one Prisma upsert per pull request, commit and author.
 * With the database on the far side of a ~180 ms round trip, a repository with a
 * thousand commits spent minutes in the driver alone. Each function here writes
 * a chunk of rows in one `INSERT … ON CONFLICT` statement. Builders are pure and
 * return `Prisma.Sql`, so tests can inspect the statement; executors run them.
 */
import { randomBytes } from "crypto";
import { Prisma, prisma } from "@usejunction/db";
import { chunkRows } from "@/lib/concurrency";

export const PULL_REQUEST_WRITE_CHUNK = 100;
export const COMMIT_WRITE_CHUNK = 200;
export const IDENTITY_WRITE_CHUNK = 200;
export const RESTAMP_CHUNK = 200;

/** Same shape Prisma's cuid default produces; raw inserts must supply ids themselves. */
export function newRowId() {
  return `c${randomBytes(12).toString("hex")}`;
}

// Every value is cast so a NULL in the first row still types the VALUES column.
const text = (value: string | null) => Prisma.sql`${value}::text`;
const int = (value: number) => Prisma.sql`${Math.trunc(value)}::int`;
const bool = (value: boolean) => Prisma.sql`${value}::boolean`;
const jsonb = (value: unknown) => Prisma.sql`${JSON.stringify(value ?? null)}::jsonb`;
/**
 * The pool pins the session to UTC, so an ISO string lands in TIMESTAMP(3) unchanged.
 * A null is still bound as a parameter so every row carries the same number of values.
 */
const stamp = (value: Date | null) => Prisma.sql`${value ? value.toISOString() : null}::timestamptz`;

export type PullRequestRow = {
  orgId: string;
  connectionId: string;
  repositoryId: string;
  number: number;
  title: string;
  state: string;
  headRefName: string | null;
  baseRefName: string | null;
  authorLogin: string | null;
  authorDeveloperId: string | null;
  url: string | null;
  githubCreatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  ticketKeys: string[];
  closingIssues: unknown;
};

/** One statement may not touch the same row twice; the last row for a number wins. */
export function dedupePullRequestRows(rows: readonly PullRequestRow[]): PullRequestRow[] {
  const byKey = new Map<string, PullRequestRow>();
  for (const row of rows) byKey.set(`${row.repositoryId}:${row.number}`, row);
  return [...byKey.values()];
}

export function pullRequestUpsertSql(rows: readonly PullRequestRow[], now = new Date()): Prisma.Sql {
  const values = rows.map((row) => Prisma.sql`(
    ${newRowId()}, ${row.orgId}, ${row.connectionId}, ${row.repositoryId}, ${int(row.number)}, ${row.title}, ${row.state},
    ${text(row.headRefName)}, ${text(row.baseRefName)}, ${text(row.authorLogin)}, ${text(row.authorDeveloperId)}, ${text(row.url)},
    ${stamp(row.githubCreatedAt)}, ${stamp(row.mergedAt)}, ${stamp(row.closedAt)},
    ${int(row.additions)}, ${int(row.deletions)}, ${int(row.changedFiles)}, ${jsonb(row.ticketKeys)}, ${jsonb(row.closingIssues)}, ${stamp(now)}
  )`);
  return Prisma.sql`
    INSERT INTO git_pull_requests (
      id, org_id, connection_id, repository_id, number, title, state,
      head_ref_name, base_ref_name, author_login, author_developer_id, url,
      github_created_at, merged_at, closed_at,
      additions, deletions, changed_files, ticket_keys, closing_issues, synced_at
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (repository_id, number) DO UPDATE SET
      title = EXCLUDED.title,
      state = EXCLUDED.state,
      head_ref_name = EXCLUDED.head_ref_name,
      base_ref_name = EXCLUDED.base_ref_name,
      author_login = EXCLUDED.author_login,
      author_developer_id = EXCLUDED.author_developer_id,
      url = EXCLUDED.url,
      github_created_at = EXCLUDED.github_created_at,
      merged_at = EXCLUDED.merged_at,
      closed_at = EXCLUDED.closed_at,
      additions = EXCLUDED.additions,
      deletions = EXCLUDED.deletions,
      changed_files = EXCLUDED.changed_files,
      ticket_keys = EXCLUDED.ticket_keys,
      closing_issues = EXCLUDED.closing_issues,
      synced_at = EXCLUDED.synced_at
    RETURNING id, number, repository_id
  `;
}

export type PullRequestIdRow = { id: string; number: number; repository_id: string };

/** Upsert pull requests and return the stored id for each (inserted or updated) row. */
export async function bulkUpsertPullRequests(rows: readonly PullRequestRow[]): Promise<PullRequestIdRow[]> {
  const deduped = dedupePullRequestRows(rows);
  const out: PullRequestIdRow[] = [];
  for (const chunk of chunkRows(deduped, PULL_REQUEST_WRITE_CHUNK)) {
    out.push(...(await prisma.$queryRaw<PullRequestIdRow[]>(pullRequestUpsertSql(chunk))));
  }
  return out;
}

export type CommitRow = {
  orgId: string;
  repositoryId: string;
  sha: string;
  authoredAt: Date;
  committedAt: Date;
  authorEmail: string | null;
  authorLogin: string | null;
  authorDeveloperId: string | null;
  messageHeadline: string;
  additions: number;
  deletions: number;
  pullRequestId: string | null;
  isDirectPush: boolean;
  isBot: boolean;
  ticketKeys: string[];
};

export function dedupeCommitRows(rows: readonly CommitRow[]): CommitRow[] {
  const byKey = new Map<string, CommitRow>();
  for (const row of rows) byKey.set(`${row.repositoryId}:${row.sha}`, row);
  return [...byKey.values()];
}

/**
 * A commit keeps a pull-request link it already has: with incremental fetches a
 * branch-history row can arrive without its (older, unchanged) pull request in
 * the same run, and nulling the link would move its cost out of that work item.
 */
export function commitUpsertSql(rows: readonly CommitRow[]): Prisma.Sql {
  const values = rows.map((row) => Prisma.sql`(
    ${newRowId()}, ${row.orgId}, ${row.repositoryId}, ${row.sha}, ${stamp(row.authoredAt)}, ${stamp(row.committedAt)},
    ${text(row.authorEmail)}, ${text(row.authorLogin)}, ${text(row.authorDeveloperId)}, ${row.messageHeadline},
    ${int(row.additions)}, ${int(row.deletions)}, ${text(row.pullRequestId)}, ${bool(row.isDirectPush)}, ${bool(row.isBot)}, ${jsonb(row.ticketKeys)}
  )`);
  return Prisma.sql`
    INSERT INTO git_commits (
      id, org_id, repository_id, sha, authored_at, committed_at,
      author_email, author_login, author_developer_id, message_headline,
      additions, deletions, pull_request_id, is_direct_push, is_bot, ticket_keys
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (repository_id, sha) DO UPDATE SET
      authored_at = EXCLUDED.authored_at,
      committed_at = EXCLUDED.committed_at,
      author_email = EXCLUDED.author_email,
      author_login = EXCLUDED.author_login,
      author_developer_id = EXCLUDED.author_developer_id,
      message_headline = EXCLUDED.message_headline,
      additions = EXCLUDED.additions,
      deletions = EXCLUDED.deletions,
      pull_request_id = COALESCE(EXCLUDED.pull_request_id, git_commits.pull_request_id),
      is_direct_push = EXCLUDED.is_direct_push,
      is_bot = EXCLUDED.is_bot,
      ticket_keys = EXCLUDED.ticket_keys
  `;
}

export async function bulkUpsertCommits(rows: readonly CommitRow[]): Promise<number> {
  const deduped = dedupeCommitRows(rows);
  let written = 0;
  for (const chunk of chunkRows(deduped, COMMIT_WRITE_CHUNK)) {
    await prisma.$executeRaw(commitUpsertSql(chunk));
    written += chunk.length;
  }
  return written;
}

export type IdentityRow = {
  orgId: string;
  connectionId: string;
  /** Lower-cased GitHub login. */
  login: string;
  email: string | null;
  developerId: string | null;
  matchedBy: string | null;
  /** Already merged with the previous metadata by the caller. */
  metadata: unknown;
};

export type IdentityCacheRow = {
  id: string;
  externalUserId: string;
  email: string | null;
  developerId: string | null;
  matchedBy: string | null;
  metadata: unknown;
};

type IdentityReturnedRow = {
  id: string;
  external_user_id: string;
  email: string | null;
  developer_id: string | null;
  matched_by: string | null;
  metadata: unknown;
};

export function dedupeIdentityRows(rows: readonly IdentityRow[]): IdentityRow[] {
  const byKey = new Map<string, IdentityRow>();
  for (const row of rows) byKey.set(`${row.orgId}:${row.login.toLowerCase()}`, { ...row, login: row.login.toLowerCase() });
  return [...byKey.values()];
}

/**
 * Mirrors the previous per-row upsert: a match never clears a developer that was
 * already assigned (`developerId ?? undefined`), everything else takes the new value.
 */
export function identityUpsertSql(rows: readonly IdentityRow[], now = new Date()): Prisma.Sql {
  const values = rows.map((row) => Prisma.sql`(
    ${newRowId()}, ${row.orgId}, ${row.connectionId}, ${"github"}, ${row.login},
    ${text(row.email)}, ${text(row.developerId)}, ${"vendor_verified"}, ${text(row.matchedBy)}, ${jsonb(row.metadata)}, ${stamp(now)}
  )`);
  return Prisma.sql`
    INSERT INTO external_identities (
      id, org_id, connection_id, provider, external_user_id,
      email, developer_id, source, matched_by, metadata, observed_at
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT (org_id, provider, external_user_id) DO UPDATE SET
      connection_id = EXCLUDED.connection_id,
      email = EXCLUDED.email,
      developer_id = COALESCE(EXCLUDED.developer_id, external_identities.developer_id),
      matched_by = EXCLUDED.matched_by,
      metadata = EXCLUDED.metadata,
      observed_at = EXCLUDED.observed_at
    RETURNING id, external_user_id, email, developer_id, matched_by, metadata
  `;
}

export async function bulkUpsertGitHubIdentities(rows: readonly IdentityRow[]): Promise<IdentityCacheRow[]> {
  const deduped = dedupeIdentityRows(rows);
  const out: IdentityCacheRow[] = [];
  for (const chunk of chunkRows(deduped, IDENTITY_WRITE_CHUNK)) {
    const returned = await prisma.$queryRaw<IdentityReturnedRow[]>(identityUpsertSql(chunk));
    for (const row of returned) {
      out.push({
        id: row.id,
        externalUserId: row.external_user_id,
        email: row.email,
        developerId: row.developer_id,
        matchedBy: row.matched_by,
        metadata: row.metadata,
      });
    }
  }
  return out;
}

export type AuthorRestamp = { login: string; developerId: string | null };

export function restampSql(table: "git_commits" | "git_pull_requests", orgId: string, entries: readonly AuthorRestamp[]): Prisma.Sql {
  const values = entries.map((entry) => Prisma.sql`(${entry.login.toLowerCase()}::text, ${text(entry.developerId)})`);
  const target = table === "git_commits" ? Prisma.sql`git_commits` : Prisma.sql`git_pull_requests`;
  return Prisma.sql`
    UPDATE ${target} AS t
    SET author_developer_id = v.developer_id
    FROM (VALUES ${Prisma.join(values)}) AS v(login, developer_id)
    WHERE t.org_id = ${orgId}
      AND t.author_login = v.login
      AND t.author_developer_id IS DISTINCT FROM v.developer_id
  `;
}

/**
 * Stamp every resolved login onto its commits and pull requests in two statements
 * per chunk instead of two per login. Rows already carrying the value are skipped.
 */
export async function restampGitAuthors(orgId: string, entries: readonly AuthorRestamp[]): Promise<void> {
  const byLogin = new Map<string, AuthorRestamp>();
  for (const entry of entries) byLogin.set(entry.login.toLowerCase(), entry);
  for (const chunk of chunkRows([...byLogin.values()], RESTAMP_CHUNK)) {
    await prisma.$executeRaw(restampSql("git_commits", orgId, chunk));
    await prisma.$executeRaw(restampSql("git_pull_requests", orgId, chunk));
  }
}
