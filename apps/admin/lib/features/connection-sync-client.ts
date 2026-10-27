import { browserMutationInit } from "@/lib/api/client";

export type ConnectionSyncCounts = {
  githubRepos?: number;
  githubCommits?: number;
  githubFailedRepos?: number;
  githubDeferredRepos?: number;
  githubSkippedRepos?: number;
  githubStopped?: boolean;
  githubReason?: string | null;
  githubError?: string | null;
};

/** Run one connection's sync with the full request budget. Resolves with the server's counts. */
export async function syncConnectionNow(connectionId: string): Promise<ConnectionSyncCounts> {
  const response = await fetch(`/api/integrations/${encodeURIComponent(connectionId)}/sync`, browserMutationInit("POST"));
  const body = (await response.json().catch(() => null)) as { ok?: boolean; counts?: ConnectionSyncCounts; error?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(body?.error || "GitHub sync failed. Please try again.");
  return body.counts ?? {};
}

/** Ask running syncs for these connections to stop after their current repository. */
export async function requestConnectionSyncStop(connectionIds: string[]): Promise<void> {
  await Promise.all(connectionIds.map((id) => fetch(`/api/integrations/${encodeURIComponent(id)}/sync/stop`, browserMutationInit("POST"))));
}

export type ConnectionSyncOutcome = { kind: "success" | "warning" | "info"; title: string; description: string };

/** Turn sync counts into the message shown for one account. */
export function describeConnectionSync(name: string, counts: ConnectionSyncCounts): ConnectionSyncOutcome {
  const repos = Number(counts.githubRepos ?? 0);
  const deferred = Number(counts.githubDeferredRepos ?? 0);
  const synced = Math.max(0, repos - deferred);
  if (counts.githubStopped) {
    return { kind: "info", title: `${name} sync stopped`, description: `Synced ${synced} of ${repos} repositories. The remaining ${deferred} continue on the next sync, or press Sync now.` };
  }
  if (deferred > 0) {
    return { kind: "warning", title: `${name} sync paused at the time budget`, description: `Synced ${synced} of ${repos} repositories. Press Sync now again to continue with the remaining ${deferred}.` };
  }
  if (counts.githubError || Number(counts.githubFailedRepos ?? 0) > 0) {
    const failed = Number(counts.githubFailedRepos ?? 0);
    return { kind: "warning", title: `${name} sync needs attention`, description: failed > 0 ? `${failed} repositories could not be checked. Other repositories were refreshed.` : counts.githubError || "Some GitHub work could not be refreshed." };
  }
  if (counts.githubReason === "no_repositories") {
    return { kind: "warning", title: `${name} has no repositories`, description: "Grant the GitHub App access to repositories, then sync again." };
  }
  if (counts.githubReason === "permission_required") {
    return { kind: "warning", title: `${name} needs permissions`, description: "Approve the required GitHub permissions, then sync again." };
  }
  return { kind: "success", title: `${name} synced`, description: `Checked ${repos.toLocaleString()} repositories and ${Number(counts.githubCommits ?? 0).toLocaleString()} commits.` };
}
