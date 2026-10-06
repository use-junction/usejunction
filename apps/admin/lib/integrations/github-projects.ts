import { Prisma, prisma, type GitHubProject, type ProviderConnection } from "@usejunction/db";
import {
  getGitHubInstallation,
  githubGraphql,
  githubInstallationToken,
  githubProjectsReadGranted,
  normalizeGitHubAccountType,
} from "@/lib/integrations/github-app";
import { githubAccountTypeFromConfig, githubInstallationIdFromConfig } from "@/lib/integrations/github-connections";

type AvailableProject = { id: string; number: number; title: string; url: string };
type ProjectPage = {
  organization: { projectsV2: { nodes: Array<AvailableProject | null>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null;
};
type Content = {
  __typename: "Issue" | "PullRequest" | string;
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt?: string | null;
  closedAt?: string | null;
  repository: { nameWithOwner: string };
};
type ItemNode = {
  id: string;
  content: Content | null;
  fieldValueByName: { name?: string | null } | null;
};
type ItemPage = {
  node: { id: string; title: string; url: string; items: { nodes: Array<ItemNode | null>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null;
};

const PROJECTS_QUERY = /* GraphQL */ `
query OrganizationProjects($login: String!, $after: String) {
  organization(login: $login) {
    projectsV2(first: 100, after: $after) {
      nodes { id number title url }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const ITEMS_QUERY = /* GraphQL */ `
query SelectedProjectItems($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2 {
      id title url
      items(first: 100, after: $after) {
        nodes {
          id
          content {
            __typename
            ... on Issue { id number title url state createdAt closedAt repository { nameWithOwner } }
            ... on PullRequest { id number title url state createdAt closedAt repository { nameWithOwner } }
          }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export class GitHubProjectsUnavailable extends Error {
  constructor(readonly reason: "not_connected" | "personal_account" | "permission_required") {
    super(reason);
  }
}

async function githubConnections(orgId: string) {
  return prisma.providerConnection.findMany({
    where: { orgId, provider: "github", status: { not: "disconnected" } },
    orderBy: { createdAt: "asc" },
  });
}

async function organizationConnections(orgId: string) {
  const connections = await githubConnections(orgId);
  return connections.filter((connection) => githubAccountTypeFromConfig(connection.config) === "Organization");
}

function installationId(connection: ProviderConnection): string {
  return githubInstallationIdFromConfig(connection.config);
}

async function authorizedInstallation(connection: ProviderConnection) {
  const id = installationId(connection);
  if (!id) throw new GitHubProjectsUnavailable("not_connected");
  const installation = await getGitHubInstallation(id);
  if (normalizeGitHubAccountType(installation.account?.type) !== "Organization") {
    throw new GitHubProjectsUnavailable("personal_account");
  }
  if (!githubProjectsReadGranted(installation.permissions)) {
    throw new GitHubProjectsUnavailable("permission_required");
  }
  const login = String(installation.account?.login ?? "");
  if (!login) throw new Error("GitHub installation has no organization");
  return { id, login, permissions: installation.permissions };
}

async function listProjects(token: string, login: string): Promise<AvailableProject[]> {
  const projects: AvailableProject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result: ProjectPage = await githubGraphql<ProjectPage>(token, PROJECTS_QUERY, { login, after: cursor }, { rejectPartial: true });
    const connection = result.organization?.projectsV2;
    if (!connection || !Array.isArray(connection.nodes)) throw new Error("GitHub returned an incomplete Projects list");
    for (const row of connection.nodes) if (row?.id && Number.isInteger(row.number) && row.title && row.url) projects.push(row);
    if (!connection.pageInfo.hasNextPage) return projects;
    if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor) throw new Error("GitHub Projects pagination did not advance");
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error("GitHub Projects list exceeded the pagination limit");
}

type PickerProject = AvailableProject & { connectionId: string; accountLogin: string };

export async function githubProjectsPicker(orgId: string) {
  const connections = await githubConnections(orgId);
  if (!connections.length) return { state: "not_connected" as const, available: [] as PickerProject[], selected: [] as GitHubProject[], accounts: [] as Array<{ connectionId: string; login: string }> };
  const selected = await prisma.gitHubProject.findMany({
    where: { orgId, connectionId: { in: connections.map((row) => row.id) } },
    orderBy: { title: "asc" },
  });
  const orgConnections = connections.filter((connection) => githubAccountTypeFromConfig(connection.config) === "Organization");
  if (!orgConnections.length) {
    return { state: "personal_account" as const, available: [] as PickerProject[], selected, accounts: [] as Array<{ connectionId: string; login: string }> };
  }
  const available: PickerProject[] = [];
  const accounts: Array<{ connectionId: string; login: string }> = [];
  let permissionRequired = false;
  for (const connection of orgConnections) {
    try {
      const installation = await authorizedInstallation(connection);
      const token = await githubInstallationToken(installation.id);
      const projects = await listProjects(token, installation.login);
      accounts.push({ connectionId: connection.id, login: installation.login });
      available.push(...projects.map((project) => ({ ...project, connectionId: connection.id, accountLogin: installation.login })));
    } catch (error) {
      if (error instanceof GitHubProjectsUnavailable && error.reason === "permission_required") {
        permissionRequired = true;
        continue;
      }
      if (error instanceof GitHubProjectsUnavailable && error.reason === "personal_account") continue;
      throw error;
    }
  }
  if (available.length === 0 && permissionRequired) {
    return { state: "permission_required" as const, available, selected, accounts };
  }
  if (available.length === 0 && !accounts.length) {
    return { state: "permission_required" as const, available, selected, accounts };
  }
  return { state: "available" as const, available, selected, accounts };
}

export async function saveGitHubProjectSelection(orgId: string, externalIds: string[]) {
  const connections = await organizationConnections(orgId);
  if (!connections.length) {
    const any = await githubConnections(orgId);
    throw new GitHubProjectsUnavailable(any.length ? "personal_account" : "not_connected");
  }
  if (new Set(externalIds).size !== externalIds.length || externalIds.length > 100) throw new Error("Invalid Project selection");
  const available = externalIds.length ? await githubProjectsPicker(orgId) : { state: "available" as const, available: [] as PickerProject[] };
  if (available.state !== "available") throw new GitHubProjectsUnavailable(available.state);
  const byId = new Map(available.available.map((project) => [project.id, project]));
  if (externalIds.some((id) => !byId.has(id))) throw new Error("Select only Projects available to this GitHub installation");
  const selectedByConnection = new Map<string, string[]>();
  for (const id of externalIds) {
    const project = byId.get(id)!;
    const list = selectedByConnection.get(project.connectionId) ?? [];
    list.push(id);
    selectedByConnection.set(project.connectionId, list);
  }
  await prisma.$transaction(async (tx) => {
    for (const connection of connections) {
      const ids = selectedByConnection.get(connection.id) ?? [];
      await tx.gitHubProject.deleteMany({ where: { orgId, connectionId: connection.id, ...(ids.length ? { externalId: { notIn: ids } } : {}) } });
      for (const id of ids) {
        const project = byId.get(id)!;
        await tx.gitHubProject.upsert({
          where: { connectionId_externalId: { connectionId: connection.id, externalId: id } },
          create: { orgId, connectionId: connection.id, externalId: id, number: project.number, title: project.title, url: project.url },
          update: { number: project.number, title: project.title, url: project.url },
        });
      }
    }
  });
  return { selected: externalIds.length };
}

type ImportedItem = {
  externalItemId: string; contentId: string; contentType: string; repositoryId: string; repositoryFullName: string;
  number: number; title: string; status: string | null; statusSource: string | null; url: string;
  contentCreatedAt: Date | null; contentClosedAt: Date | null;
};

function githubTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readProjectItems(token: string, project: GitHubProject, repositories: Map<string, string>) {
  const items: ImportedItem[] = [];
  let cursor: string | null = null;
  let title = project.title;
  let url = project.url;
  for (let page = 0; page < 250; page++) {
    const result: ItemPage = await githubGraphql<ItemPage>(token, ITEMS_QUERY, { id: project.externalId, after: cursor }, { rejectPartial: true });
    if (!result.node?.items || !Array.isArray(result.node.items.nodes)) throw new Error("GitHub Project is unavailable or returned incomplete items");
    title = result.node.title || title;
    url = result.node.url || url;
    for (const row of result.node.items.nodes) {
      const content = row?.content;
      if (!row?.id || !content || !["Issue", "PullRequest"].includes(content.__typename) || !content.id || !content.number || !content.title || !content.url) continue;
      const fullName = content.repository?.nameWithOwner;
      const repositoryId = fullName ? repositories.get(fullName.toLowerCase()) : null;
      if (!repositoryId) continue;
      const projectStatus = row.fieldValueByName?.name?.trim();
      items.push({
        externalItemId: row.id, contentId: content.id, contentType: content.__typename,
        repositoryId, repositoryFullName: fullName, number: content.number, title: content.title,
        status: projectStatus || content.state || null, statusSource: projectStatus ? "project" : content.state ? "content" : null,
        url: content.url,
        contentCreatedAt: githubTime(content.createdAt),
        contentClosedAt: githubTime(content.closedAt),
      });
    }
    const info = result.node.items.pageInfo;
    if (!info.hasNextPage) return { items, title, url };
    if (!info.endCursor || info.endCursor === cursor) throw new Error("GitHub Project item pagination did not advance");
    cursor = info.endCursor;
  }
  throw new Error("GitHub Project item list exceeded the pagination limit");
}

export async function syncGitHubProjects(orgId: string, connectionId?: string) {
  const connections = connectionId
    ? await prisma.providerConnection.findMany({ where: { id: connectionId, orgId, provider: "github", status: { not: "disconnected" } } })
    : await organizationConnections(orgId);
  if (!connections.length) {
    const any = connectionId ? [] : await githubConnections(orgId);
    if (!any.length) throw new GitHubProjectsUnavailable("not_connected");
    throw new GitHubProjectsUnavailable("personal_account");
  }
  let selected = 0;
  let synced = 0;
  let failed = 0;
  let imported = 0;
  let skipped = 0;
  let reason: string | undefined;
  for (const connection of connections) {
    const result = await syncGitHubProjectsForConnection(orgId, connection);
    selected += result.selected;
    synced += result.synced ?? 0;
    failed += result.failed ?? 0;
    imported += result.imported ?? 0;
    skipped += result.skipped ?? 0;
    if (result.reason) reason = result.reason;
  }
  return { selected, synced, failed, skipped, imported, ...(reason ? { reason } : {}) };
}

async function syncGitHubProjectsForConnection(orgId: string, connection: ProviderConnection) {
  const projects = await prisma.gitHubProject.findMany({ where: { orgId, connectionId: connection.id } });
  if (!projects.length) return { selected: 0, synced: 0, failed: 0, imported: 0 };
  let installation: Awaited<ReturnType<typeof authorizedInstallation>>;
  try {
    installation = await authorizedInstallation(connection);
  } catch (error) {
    if (error instanceof GitHubProjectsUnavailable) {
      await prisma.gitHubProject.updateMany({ where: { orgId, connectionId: connection.id }, data: { syncStatus: error.reason, lastError: error.reason === "permission_required" ? "Approve organization Projects: read on GitHub." : "Organization Projects require an organization installation." } });
      return { selected: projects.length, synced: 0, failed: projects.length, imported: 0, reason: error.reason };
    }
    throw error;
  }
  let token: string;
  let grants: Array<{ repositoryId: string; repository: { owner: string; name: string } }> = [];
  try {
    token = await githubInstallationToken(installation.id);
    await prisma.providerConnection.update({ where: { id: connection.id }, data: { permissions: installation.permissions as Prisma.InputJsonValue } });
    grants = await prisma.gitHubRepositoryAccess.findMany({
      where: { orgId, connectionId: connection.id },
      include: { repository: { select: { id: true, owner: true, name: true } } },
    });
  } catch (error) {
    await prisma.gitHubProject.updateMany({ where: { orgId, connectionId: connection.id }, data: { syncStatus: "error", lastError: error instanceof Error ? error.message.slice(0, 400) : "Project sync failed" } });
    return { selected: projects.length, synced: 0, failed: projects.length, imported: 0 };
  }
  const repositories = new Map(grants.map((grant) => [`${grant.repository.owner}/${grant.repository.name}`.toLowerCase(), grant.repositoryId]));
  let synced = 0, failed = 0, imported = 0, skipped = 0;
  for (const project of projects) {
    const seenAt = new Date();
    const claimed = await prisma.gitHubProject.updateMany({
      where: { id: project.id, orgId, OR: [{ syncStatus: { not: "syncing" } }, { lastAttemptAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
      data: { syncStatus: "syncing", lastAttemptAt: seenAt, lastError: null },
    });
    if (!claimed.count) { skipped++; continue; }
    try {
      const result = await readProjectItems(token, project, repositories);
      await prisma.$transaction(async (tx) => {
        for (const item of result.items) {
          await tx.gitHubProjectItem.upsert({
            where: { projectId_externalItemId: { projectId: project.id, externalItemId: item.externalItemId } },
            create: { orgId, projectId: project.id, ...item, lastSeenAt: seenAt },
            update: { ...item, lastSeenAt: seenAt },
          });
        }
        await tx.gitHubProjectItem.deleteMany({ where: { projectId: project.id, lastSeenAt: { lt: seenAt } } });
        await tx.gitHubProject.update({ where: { id: project.id }, data: { title: result.title, url: result.url, syncStatus: "available", lastSuccessAt: new Date(), lastError: null } });
      }, { timeout: 120_000 });
      imported += result.items.length;
      synced++;
    } catch (error) {
      failed++;
      await prisma.gitHubProject.update({ where: { id: project.id }, data: { syncStatus: "error", lastError: error instanceof Error ? error.message.slice(0, 400) : "Project sync failed" } }).catch(() => undefined);
    }
  }
  return { selected: projects.length, synced, failed, skipped, imported };
}

export async function syncGitHubProjectsIfDue(orgId: string, force = false, connectionId?: string) {
  const connections = connectionId
    ? await prisma.providerConnection.findMany({ where: { id: connectionId, orgId, provider: "github", status: { not: "disconnected" } } })
    : await organizationConnections(orgId);
  if (!connections.length) return null;
  const projects = await prisma.gitHubProject.findMany({
    where: { orgId, connectionId: { in: connections.map((row) => row.id) } },
    select: { lastSuccessAt: true, syncStatus: true, connectionId: true },
  });
  if (!projects.length) return null;
  const due = projects.some((project) => project.syncStatus !== "syncing" && (project.syncStatus !== "available" || !project.lastSuccessAt || project.lastSuccessAt.getTime() < Date.now() - 60 * 60_000));
  return force || due ? syncGitHubProjects(orgId, connectionId) : null;
}

export async function disconnectGitHubProjects(orgId: string, connectionId?: string) {
  const connections = connectionId
    ? await prisma.providerConnection.findMany({ where: { id: connectionId, orgId, provider: "github" } })
    : await githubConnections(orgId);
  if (!connections.length) return { removedProjects: 0, removedItems: 0 };
  const ids = connections.map((row) => row.id);
  const where = { orgId, connectionId: { in: ids } };
  const [removedProjects, removedItems] = await Promise.all([
    prisma.gitHubProject.count({ where }),
    prisma.gitHubProjectItem.count({ where: { orgId, project: { connectionId: { in: ids } } } }),
  ]);
  await prisma.gitHubProject.deleteMany({ where });
  return { removedProjects, removedItems };
}
