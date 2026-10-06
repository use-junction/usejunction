import { prisma, type ProviderConnection, type ProviderConnectionCapability } from "@usejunction/db";
import {
  githubAppPermissionsUrl,
  githubCodePermissionsGranted,
  githubMembersReadGranted,
  githubPermissionUpdateUrl,
  normalizeGitHubAccountType,
  type GitHubAccountType,
} from "@/lib/integrations/github-app";
import type { IntegrationConfig } from "@/lib/integrations/types";
import { isGitHubEmptyRepositoryError, sanitizeGitHubSyncError } from "@/lib/integrations/github-empty-repo";

export function githubInstallationIdFromConfig(config: unknown): string {
  if (!config || typeof config !== "object" || Array.isArray(config)) return "";
  return String((config as Record<string, unknown>).installationId ?? "");
}

export function githubAccountTypeFromConfig(config: unknown): GitHubAccountType {
  if (!config || typeof config !== "object" || Array.isArray(config)) return "Organization";
  return normalizeGitHubAccountType((config as Record<string, unknown>).accountType) ?? "Organization";
}

export async function listWorkspaceGitHubConnections(orgId: string) {
  return prisma.providerConnection.findMany({
    where: { orgId, provider: "github", status: { not: "disconnected" } },
    include: { capabilities: { where: { capability: { in: ["pull_requests", "org_members"] } } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function findGitHubConnectionByAccount(orgId: string, accountLogin: string) {
  return prisma.providerConnection.findFirst({
    where: { orgId, provider: "github", externalOrgId: accountLogin },
  });
}

export async function findClaimedGitHubInstallation(installationId: string, excludeOrgId?: string) {
  const rows = await prisma.providerConnection.findMany({
    where: {
      provider: "github",
      status: { not: "disconnected" },
      ...(excludeOrgId ? { orgId: { not: excludeOrgId } } : {}),
      config: { path: ["installationId"], equals: installationId },
    },
    select: { id: true, orgId: true },
    take: 1,
  });
  return rows[0] ?? null;
}

export async function listLinkedGitHubInstallationIds(orgId?: string) {
  const rows = await prisma.providerConnection.findMany({
    where: { provider: "github", status: { not: "disconnected" } },
    select: { orgId: true, config: true },
  });
  const thisWorkspace = new Set<string>();
  const otherWorkspaces = new Set<string>();
  for (const row of rows) {
    const installationId = githubInstallationIdFromConfig(row.config);
    if (!installationId) continue;
    if (orgId && row.orgId === orgId) thisWorkspace.add(installationId);
    else otherWorkspaces.add(installationId);
  }
  return { thisWorkspace, otherWorkspaces };
}

export type GitHubConnectionState = "permission_required" | "syncing" | "partial" | "ready";

export type GitHubConnectionView = {
  id: string;
  githubOrg: string | null;
  accountType: GitHubAccountType;
  installationId: string | null;
  state: GitHubConnectionState;
  needsMembers: boolean;
  approveUrl: string | null;
  appPermissionsUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type GitHubConnectionsSummary = {
  id: string | null;
  githubOrg: string | null;
  accountType: GitHubAccountType;
  installationId: string | null;
  state: "none" | GitHubConnectionState;
  needsMembers: boolean;
  approveUrl: string | null;
  appPermissionsUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  connections: GitHubConnectionView[];
};

type ConnectionRow = Pick<ProviderConnection, "id" | "externalOrgId" | "config" | "permissions" | "lastSyncedAt" | "lastError"> & {
  capabilities?: Pick<ProviderConnectionCapability, "capability" | "status" | "lastError">[];
};

const STATE_RANK: Record<GitHubConnectionState, number> = {
  permission_required: 0,
  partial: 1,
  syncing: 2,
  ready: 3,
};

export function githubConnectionView(
  connection: ConnectionRow,
  options: { hasRepoErrors?: boolean } = {},
): GitHubConnectionView {
  const config = (connection.config ?? {}) as IntegrationConfig;
  const installationId = githubInstallationIdFromConfig(config);
  const githubOrg = connection.externalOrgId || String(config.org ?? "") || null;
  const accountType = githubAccountTypeFromConfig(config);
  const pullRequestsCapability = connection.capabilities?.find((item) => item.capability === "pull_requests");
  const membersCapability = connection.capabilities?.find((item) => item.capability === "org_members");
  const needsMembers = accountType === "Organization"
    && (!githubMembersReadGranted(connection.permissions) || membersCapability?.status === "permission_required");
  const rawError = connection.lastError ?? membersCapability?.lastError ?? pullRequestsCapability?.lastError ?? null;
  const lastError = sanitizeGitHubSyncError(rawError);
  const pullRequestsFailed = pullRequestsCapability?.status === "error"
    && !isGitHubEmptyRepositoryError(pullRequestsCapability.lastError);
  let state: GitHubConnectionState = "ready";
  if (!githubCodePermissionsGranted(connection.permissions) || needsMembers) state = "permission_required";
  else if (!connection.lastSyncedAt || pullRequestsCapability?.status === "unknown") state = "syncing";
  else if (pullRequestsFailed || options.hasRepoErrors) state = "partial";
  return {
    id: connection.id,
    githubOrg,
    accountType,
    installationId: installationId || null,
    state,
    needsMembers,
    approveUrl: githubOrg && installationId ? githubPermissionUpdateUrl(githubOrg, installationId, accountType) : null,
    appPermissionsUrl: process.env.GITHUB_APP_SLUG ? githubAppPermissionsUrl(process.env.GITHUB_APP_SLUG) : null,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastError,
  };
}

export function summarizeGitHubConnections(views: GitHubConnectionView[]): GitHubConnectionsSummary {
  if (views.length === 0) {
    return {
      id: null,
      githubOrg: null,
      accountType: "Organization",
      installationId: null,
      state: "none",
      needsMembers: false,
      approveUrl: null,
      appPermissionsUrl: process.env.GITHUB_APP_SLUG ? githubAppPermissionsUrl(process.env.GITHUB_APP_SLUG) : null,
      lastSyncedAt: null,
      lastError: null,
      connections: [],
    };
  }
  const ranked = [...views].sort((left, right) => STATE_RANK[left.state] - STATE_RANK[right.state]);
  const worst = ranked[0]!;
  const latest = [...views].sort((left, right) => (right.lastSyncedAt ?? "").localeCompare(left.lastSyncedAt ?? ""))[0];
  const errored = views.find((row) => row.lastError);
  return {
    id: views.length === 1 ? worst.id : null,
    githubOrg: views.length === 1 ? worst.githubOrg : views.map((row) => row.githubOrg).filter(Boolean).join(", ") || null,
    accountType: views.length === 1 ? worst.accountType : worst.accountType,
    installationId: views.length === 1 ? worst.installationId : null,
    state: worst.state,
    needsMembers: views.some((row) => row.needsMembers),
    approveUrl: views.length === 1 ? worst.approveUrl : null,
    appPermissionsUrl: worst.appPermissionsUrl,
    lastSyncedAt: latest?.lastSyncedAt ?? null,
    lastError: errored?.lastError ?? worst.lastError,
    connections: views,
  };
}
