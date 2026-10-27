import { prisma } from "@usejunction/db";
import { releaseConnectionLease, syncConnection } from "@/lib/integrations/sync";
import { logServerError } from "@/lib/errors/public";

/** How long past its due time a connection may sit before a page view treats the scheduler as having missed it. */
export const STALE_GITHUB_SYNC_GRACE_MS = 20 * 60_000;

/** Leave headroom under the route's maxDuration so the last sync can still write its result. */
const RESYNC_BUDGET_MS = 270_000;
const MIN_CONNECTION_BUDGET_MS = 30_000;

/**
 * GitHub connections in one workspace that the scheduler should have run but has not:
 * due more than the grace period ago (a fresh connection is due at connect time, so one
 * that never synced qualifies too) and not currently leased. Claims each one so the
 * caller can resync it without racing the cron.
 */
export async function claimStaleGitHubConnections(
  orgId: string,
  options: { now?: Date; graceMs?: number; limit?: number } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const overdueBefore = new Date(now.getTime() - (options.graceMs ?? STALE_GITHUB_SYNC_GRACE_MS));
  const candidates = await prisma.providerConnection.findMany({
    where: {
      orgId,
      provider: "github",
      status: { in: ["active", "degraded", "pending", "error"] },
      AND: [
        { OR: [{ nextSyncAt: null }, { nextSyncAt: { lt: overdueBefore } }] },
        { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      ],
    },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true },
    take: options.limit ?? 5,
  });
  const claimed: string[] = [];
  for (const candidate of candidates) {
    const result = await prisma.providerConnection.updateMany({
      where: { id: candidate.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + 5 * 60_000) },
    });
    if (result.count === 1) claimed.push(candidate.id);
  }
  return claimed;
}

export type ResyncScheduler = (task: () => Promise<void>) => void;

/**
 * Self-heal for connections the scheduler missed. A page view claims every overdue
 * GitHub connection in the workspace and hands the syncs to `schedule`, which runs them
 * once the response has been sent (Next's `after`). Returns the ids that were claimed.
 */
export async function resyncStaleGitHubConnections(
  orgId: string,
  schedule: ResyncScheduler,
  options: { now?: Date } = {},
): Promise<string[]> {
  let claimed: string[];
  try {
    claimed = await claimStaleGitHubConnections(orgId, { now: options.now });
  } catch (error) {
    logServerError("integrations/stale-resync", error, { orgId });
    return [];
  }
  if (claimed.length === 0) return [];
  schedule(async () => {
    const deadline = new Date(Date.now() + RESYNC_BUDGET_MS);
    for (const id of claimed) {
      if (deadline.getTime() - Date.now() < MIN_CONNECTION_BUDGET_MS) {
        await releaseConnectionLease(id).catch((error) => logServerError("integrations/stale-resync", error, { id }));
        continue;
      }
      try {
        await syncConnection(id, { deadline });
      } catch (error) {
        logServerError("integrations/stale-resync", error, { orgId, id });
      }
    }
  });
  return claimed;
}
