import { prisma } from "@usejunction/db";
import { decryptSecret } from "@/lib/security";
import {
  encryptLinearTokens,
  getLinearIssuePage,
  getLinearWorkspace,
  refreshLinearToken,
  revokeLinearToken,
  type LinearTokens,
} from "@/lib/integrations/linear";

export async function saveLinearConnection(orgId: string, userId: string, tokens: LinearTokens) {
  const workspace = await getLinearWorkspace(tokens.accessToken);
  const encrypted = encryptLinearTokens(tokens);
  let previousRefreshToken: string | null = null;
  const connection = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectToolConnection.findUnique({
      where: { orgId_provider: { orgId, provider: "linear" } },
      select: { id: true, externalWorkspaceId: true, refreshTokenCiphertext: true },
    });
    previousRefreshToken = existing?.refreshTokenCiphertext ?? null;
    if (existing) {
      // Every reconnect gets a new ID. An import already running with the old
      // ID then cannot write or prune issues in the new connection, even when
      // the administrator reconnects the same Linear workspace.
      await tx.projectToolConnection.delete({ where: { id: existing.id } });
    }
    const data = {
      orgId,
      provider: "linear",
      externalWorkspaceId: workspace.id,
      externalWorkspaceName: workspace.name,
      ...encrypted,
      status: "connected",
      createdByUserId: userId,
    };
    return tx.projectToolConnection.create({
      data,
      select: { id: true, externalWorkspaceId: true, externalWorkspaceName: true },
    });
  });
  if (previousRefreshToken && decryptSecret(previousRefreshToken) !== tokens.refreshToken) {
    try {
      await revokeLinearToken(previousRefreshToken, "refresh_token");
    } catch {
      // The old grant can also be revoked from Linear; the new connection is usable.
    }
  }
  return connection;
}

async function accessTokenFor(connection: {
  id: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: Date | null;
}): Promise<string> {
  if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 120_000) {
    return decryptSecret(connection.accessTokenCiphertext);
  }
  const refreshed = await refreshLinearToken(connection.refreshTokenCiphertext);
  const updated = await prisma.projectToolConnection.updateMany({
    where: { id: connection.id, refreshTokenCiphertext: connection.refreshTokenCiphertext },
    data: encryptLinearTokens(refreshed),
  });
  if (updated.count) return refreshed.accessToken;
  // Another sync may have rotated the refresh token while this request was in flight.
  const latest = await prisma.projectToolConnection.findUnique({
    where: { id: connection.id },
    select: { accessTokenCiphertext: true },
  });
  if (!latest) throw new Error("Linear connection was removed during sync");
  return decryptSecret(latest.accessTokenCiphertext);
}

export async function syncLinearConnection(orgId: string) {
  const connection = await prisma.projectToolConnection.findUnique({
    where: { orgId_provider: { orgId, provider: "linear" } },
  });
  if (!connection) throw new Error("Linear is not connected");
  const seenAt = new Date();
  try {
    const accessToken = await accessTokenFor(connection);
    let cursor: string | null = null;
    let imported = 0;
    let pages = 0;
    do {
      const page = await getLinearIssuePage(accessToken, cursor);
      const valid = page.nodes.filter((issue) => issue.id && issue.identifier && issue.title);
      const operations = valid.map((issue) => prisma.projectIssue.upsert({
        where: { connectionId_externalId: { connectionId: connection.id, externalId: issue.id } },
        create: {
          orgId,
          connectionId: connection.id,
          externalId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: issue.state?.name ?? "Unknown",
          url: linearIssueUrl(issue.url),
          issueUpdatedAt: linearIssueDate(issue.updatedAt),
          lastSeenAt: seenAt,
        },
        update: {
          identifier: issue.identifier,
          title: issue.title,
          status: issue.state?.name ?? "Unknown",
          url: linearIssueUrl(issue.url),
          issueUpdatedAt: linearIssueDate(issue.updatedAt),
          lastSeenAt: seenAt,
        },
      }));
      if (operations.length) await prisma.$transaction(operations);
      imported += valid.length;
      pages++;
      if (pages >= 250 && page.pageInfo.hasNextPage) throw new Error("Linear issue sync exceeded page limit");
      if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor)) {
        throw new Error("Linear issue pagination did not advance");
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);

    const removed = await prisma.projectIssue.deleteMany({
      where: { connectionId: connection.id, lastSeenAt: { lt: seenAt } },
    });
    await prisma.projectToolConnection.update({
      where: { id: connection.id },
      data: { status: "connected", lastSyncedAt: new Date(), lastError: null },
    });
    return { imported, removed: removed.count };
  } catch (error) {
    await prisma.projectToolConnection.update({
      where: { id: connection.id },
      data: { status: "error", lastError: "Linear issue sync failed. Try syncing again." },
    }).catch(() => {});
    throw error;
  }
}

function linearIssueUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "linear.app" ? url.toString() : null;
  } catch {
    return null;
  }
}

function linearIssueDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function linearConnectionSummary(orgId: string) {
  const connection = await prisma.projectToolConnection.findUnique({
    where: { orgId_provider: { orgId, provider: "linear" } },
    select: {
      id: true,
      externalWorkspaceName: true,
      status: true,
      lastSyncedAt: true,
      lastError: true,
      _count: { select: { issues: true } },
    },
  });
  return connection ? {
    connected: true,
    workspaceName: connection.externalWorkspaceName,
    status: connection.status,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    issueCount: connection._count.issues,
  } : {
    connected: false,
    workspaceName: null,
    status: "disconnected",
    lastSyncedAt: null,
    lastError: null,
    issueCount: 0,
  };
}

export async function disconnectLinearConnection(orgId: string) {
  const connection = await prisma.projectToolConnection.findUnique({
    where: { orgId_provider: { orgId, provider: "linear" } },
  });
  if (!connection) return { disconnected: false, revoked: false, removedIssues: 0 };
  let revoked = false;
  try {
    revoked = await revokeLinearToken(connection.refreshTokenCiphertext, "refresh_token");
  } catch {
    // Local disconnect still removes credentials and imported data if Linear is unavailable.
  }
  const removedIssues = await prisma.projectIssue.count({ where: { connectionId: connection.id } });
  await prisma.projectToolConnection.delete({ where: { id: connection.id } });
  return { disconnected: true, revoked, removedIssues };
}
