import { prisma } from "@usejunction/db";
import { logServerError } from "@/lib/errors/public";
import { createFeaturesGitHubAuthorSyncRequest } from "@/lib/sync/remote-sync";

export const FEATURES_GITHUB_TRIGGER = "features_github";
export const FEATURES_GITHUB_WAKE_MS = 15 * 60 * 1000;

export function featuresGithubAutomationKey(
  developerId: string,
  now: Date,
  force = false,
) {
  if (force) return `${FEATURES_GITHUB_TRIGGER}:${developerId}:${now.getTime()}`;
  const bucket = Math.floor(now.getTime() / FEATURES_GITHUB_WAKE_MS);
  return `${FEATURES_GITHUB_TRIGGER}:${developerId}:${bucket}`;
}

export type GitHubAuthorDaemonWakeResult = {
  skipped: boolean;
  reason?: string;
  developers: number;
  devices: number;
  requestsCreated: number;
};

async function githubFeaturesConnectionId(orgId: string) {
  const connection = await prisma.providerConnection.findFirst({
    where: { orgId, provider: "github", status: { not: "disconnected" } },
    select: { id: true },
  });
  return connection?.id ?? null;
}

/**
 * After GitHub/Features updates, wake Junction daemons for mapped GitHub authors
 * so usage lands before the next cost allocation.
 */
export async function wakeGitHubAuthorDaemons(
  orgId: string,
  options: { now?: Date; force?: boolean; developerIds?: string[] } = {},
): Promise<GitHubAuthorDaemonWakeResult> {
  const now = options.now ?? new Date();
  const connectionId = await githubFeaturesConnectionId(orgId);
  if (!connectionId) {
    return { skipped: true, reason: "github_disconnected", developers: 0, devices: 0, requestsCreated: 0 };
  }

  const identities = await prisma.externalIdentity.findMany({
    where: {
      orgId,
      provider: "github",
      developerId: options.developerIds?.length
        ? { in: options.developerIds }
        : { not: null },
    },
    select: { developerId: true },
  });
  const developerIds = [...new Set(
    identities
      .map((identity) => identity.developerId)
      .filter((id): id is string => Boolean(id)),
  )];
  if (developerIds.length === 0) {
    return { skipped: true, reason: "no_mapped_authors", developers: 0, devices: 0, requestsCreated: 0 };
  }

  try {
    return await createFeaturesGitHubAuthorSyncRequest({
      orgId,
      developerIds,
      now,
      automationKeyFor: (developerId) => featuresGithubAutomationKey(developerId, now, Boolean(options.force)),
    });
  } catch (error) {
    logServerError("features/github-author-daemons", error, { orgId, developers: developerIds.length });
    throw error;
  }
}
