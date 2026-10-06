import { prisma } from "@usejunction/db";

export type InstallationRepo = {
  name: string;
  owner: { login?: string | null };
  default_branch?: string | null;
};

/** Reconcile only after GitHub returned a complete installation repository list. */
export async function reconcileGitHubRepositoryAccess(orgId: string, connectionId: string, repos: InstallationRepo[]) {
  const ids = new Map<string, string>();
  for (const repo of repos) {
    const owner = repo.owner?.login;
    if (!owner || !repo.name) continue;
    const row = await prisma.repository.upsert({
      where: { orgId_host_owner_name: { orgId, host: "github.com", owner, name: repo.name } },
      update: {},
      create: { orgId, host: "github.com", owner, name: repo.name },
    });
    ids.set(`${owner}/${repo.name}`.toLowerCase(), row.id);
    await prisma.gitHubRepositoryAccess.upsert({
      where: { connectionId_repositoryId: { connectionId, repositoryId: row.id } },
      update: {},
      create: { orgId, connectionId, repositoryId: row.id },
    });
  }
  await prisma.gitHubRepositoryAccess.deleteMany({
    where: { connectionId, repositoryId: { notIn: [...ids.values()] } },
  });
  await prisma.gitHubProjectItem.deleteMany({
    where: { orgId, project: { connectionId }, repositoryId: { notIn: [...ids.values()] } },
  });
  return ids;
}
