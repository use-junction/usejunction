/**
 * Per-repository fetch window for the GitHub code sync.
 *
 * Every run used to re-pull the whole cost window (90 days) for every repository.
 * Once a repository has been sealed, only work newer than its last successful
 * fetch can have changed, so the next run starts shortly before that point.
 * The pull request query is ordered by `updatedAt` and the branch history query
 * takes `since`, so the same cutoff serves both.
 */

/** Refetch this much before the last success so a slow previous run leaves no gap. */
export const GITHUB_INCREMENTAL_OVERLAP_MS = 2 * 86_400_000;

/** A grant this stale is refetched in full; it bounds how long silent drift can last. */
export const GITHUB_INCREMENTAL_MAX_AGE_MS = 14 * 86_400_000;

export type RepoFetchMode = "full" | "incremental";

export function githubFullRefetchRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GITHUB_CODE_SYNC_FULL_REFETCH === "1";
}

export function repoFetchCutoff(input: {
  /** Start of the cost window (now minus the window length). */
  windowCutoff: Date;
  /** When this repository's last successful fetch started, if any. */
  lastSuccessAt: Date | null | undefined;
  /** `github_repository_accesses.sync_status` for the grant. */
  syncStatus: string | null | undefined;
  fullRefetch: boolean;
  now: Date;
}): { cutoff: Date; mode: RepoFetchMode } {
  const full = { cutoff: input.windowCutoff, mode: "full" as const };
  if (input.fullRefetch) return full;
  if (!input.lastSuccessAt) return full;
  if (input.syncStatus === "error") return full;
  const age = input.now.getTime() - input.lastSuccessAt.getTime();
  if (!Number.isFinite(age) || age > GITHUB_INCREMENTAL_MAX_AGE_MS) return full;
  const incremental = new Date(input.lastSuccessAt.getTime() - GITHUB_INCREMENTAL_OVERLAP_MS);
  if (incremental.getTime() <= input.windowCutoff.getTime()) return full;
  return { cutoff: incremental, mode: "incremental" };
}
