import { prisma } from "@usejunction/db";

export type InstallationRepo = {
  name: string;
  owner: { login?: string | null };
  default_branch?: string | null;
  fork?: boolean | null;
  archived?: boolean | null;
  pushed_at?: string | null;
};

function repoKey(owner: string, name: string) {
  return `${owner}/${name}`.toLowerCase();
}

/**
 * Reconcile only after GitHub returned a complete installation repository list.
 * Runs a fixed number of queries however many repositories the install exposes:
 * a personal install can list hundreds, and one upsert per repository was enough
 * on its own to eat most of a serverless function's time limit.
 */
export async function reconcileGitHubRepositoryAccess(orgId: string, connectionId: string, repos: InstallationRepo[]) {
  const wanted = new Map<string, { owner: string; name: string }>();
  for (const repo of repos) {
    const owner = repo.owner?.login;
    if (!owner || !repo.name) continue;
    wanted.set(repoKey(owner, repo.name), { owner, name: repo.name });
  }

  const ids = new Map<string, string>();
  const loadRepositories = () => prisma.repository.findMany({
    where: { orgId, host: "github.com", OR: [...wanted.values()].map(({ owner, name }) => ({ owner, name })) },
    select: { id: true, owner: true, name: true },
  });
  if (wanted.size > 0) {
    const existing = await loadRepositories();
    for (const row of existing) ids.set(repoKey(row.owner, row.name), row.id);
    const missing = [...wanted].filter(([key]) => !ids.has(key)).map(([, repo]) => ({ orgId, host: "github.com", ...repo }));
    if (missing.length > 0) {
      await prisma.repository.createMany({ data: missing, skipDuplicates: true });
      for (const row of await loadRepositories()) ids.set(repoKey(row.owner, row.name), row.id);
    }
  }

  const repositoryIds = [...ids.values()];
  if (repositoryIds.length > 0) {
    const granted = new Set(
      (await prisma.gitHubRepositoryAccess.findMany({
        where: { connectionId, repositoryId: { in: repositoryIds } },
        select: { repositoryId: true },
      })).map((row) => row.repositoryId),
    );
    const newGrants = repositoryIds.filter((repositoryId) => !granted.has(repositoryId)).map((repositoryId) => ({ orgId, connectionId, repositoryId }));
    if (newGrants.length > 0) await prisma.gitHubRepositoryAccess.createMany({ data: newGrants, skipDuplicates: true });
  }
  await prisma.gitHubRepositoryAccess.deleteMany({
    where: { connectionId, repositoryId: { notIn: repositoryIds } },
  });
  await prisma.gitHubProjectItem.deleteMany({
    where: { orgId, project: { connectionId }, repositoryId: { notIn: repositoryIds } },
  });
  return ids;
}
