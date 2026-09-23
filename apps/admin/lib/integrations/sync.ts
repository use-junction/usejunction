import { prisma, type Prisma, type ProviderConnection } from "@usejunction/db";
import { normalizeEmail } from "@/lib/developer-identity";
import { resolveProviderApiKeyMapping } from "@/lib/integrations/api-key-mapping";
import { getAdapter } from "@/lib/integrations/adapters";
import { githubInstallationToken } from "@/lib/integrations/github-app";
import type { IntegrationConfig, ProviderApiKey, ProviderMember, ProviderUsage } from "@/lib/integrations/types";
import { decryptSecret } from "@/lib/security";
import { invalidateAnalyticsCache } from "@/lib/analytics/query";
import { syncTeamSeatQuantityBestEffort } from "@/lib/saas-billing/quantity";
import { sanitizeExtractionPayload } from "@usejunction/usage-schema";
import { extractionFingerprint, JUNCTION_EXTRACTION_SCHEMA_VERSION } from "@usejunction/usage-schema";
import { vendorUsageAllowed } from "@/lib/privacy/account-collection";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function configOf(connection: ProviderConnection): IntegrationConfig {
  return (connection.config ?? {}) as IntegrationConfig;
}

async function upsertMember(connection: ProviderConnection, member: ProviderMember) {
  const email = member.email ? normalizeEmail(member.email) : null;
  let developer = email
    ? await prisma.developer.findUnique({ where: { orgId_email: { orgId: connection.orgId, email } } })
    : null;
  return prisma.externalIdentity.upsert({
    where: { orgId_provider_externalUserId: { orgId: connection.orgId, provider: connection.provider, externalUserId: member.externalUserId } },
    update: {
      developerId: developer?.id ?? undefined,
      connectionId: connection.id,
      email,
      displayName: member.name ?? null,
      matchedBy: developer ? "email" : null,
      observedAt: new Date(),
      metadata: json(member.metadata),
    },
    create: {
      orgId: connection.orgId,
      developerId: developer?.id ?? null,
      connectionId: connection.id,
      provider: connection.provider,
      externalUserId: member.externalUserId,
      email,
      displayName: member.name ?? null,
      source: "vendor_verified",
      matchedBy: developer ? "email" : null,
      metadata: json(member.metadata),
    },
  });
}

async function recordCapability(input: {
  connection: ProviderConnection;
  capability: string;
  endpoint?: string | null;
  dataThrough?: Date | null;
  status?: string;
  error?: string | null;
}) {
  await prisma.providerConnectionCapability.upsert({
    where: { connectionId_capability: { connectionId: input.connection.id, capability: input.capability } },
    update: {
      endpoint: input.endpoint ?? undefined,
      status: input.status ?? "available",
      dataThrough: input.dataThrough ?? undefined,
      lastCheckedAt: new Date(),
      lastSuccessAt: input.status === "available" ? new Date() : undefined,
      lastError: input.error ?? null,
      schemaVersion: JUNCTION_EXTRACTION_SCHEMA_VERSION,
    },
    create: {
      orgId: input.connection.orgId, connectionId: input.connection.id, capability: input.capability,
      endpoint: input.endpoint ?? null, status: input.status ?? "available", dataThrough: input.dataThrough ?? null,
      lastCheckedAt: new Date(), lastSuccessAt: input.status === "available" ? new Date() : null,
      lastError: input.error ?? null, schemaVersion: JUNCTION_EXTRACTION_SCHEMA_VERSION,
    },
  });
}

async function recordSourceEnvelope(input: {
  connection: ProviderConnection;
  runId: string;
  row: ProviderUsage;
}) {
  const source = {
    provider: input.row.provider,
    product: input.row.product,
    tenantId: input.connection.externalOrgId,
    endpoint: input.row.sourceEndpoint ?? "provider-adapter",
    capability: input.row.sourceCapability ?? "usage",
  };
  const payload = sanitizeExtractionPayload(input.row.metadata ?? {});
  const fingerprint = extractionFingerprint({
    source,
    externalRecordId: input.row.sourceRecordId ?? input.row.externalKey,
    subject: { externalUserId: input.row.externalUserId, userEmail: input.row.email, workspaceId: input.row.externalWorkspaceId, projectId: input.row.externalProjectId, apiKeyId: input.row.externalApiKeyId, repository: input.row.repository },
    occurredAt: input.row.date.toISOString(),
    payload,
  });
  const expiresAt = new Date(Date.now() + 30 * 86400_000);
  await prisma.providerSourceRecord.upsert({
    where: { connectionId_capability_fingerprint: { connectionId: input.connection.id, capability: source.capability, fingerprint } },
    update: { payload: json(payload), occurredAt: input.row.date, expiresAt, syncRunId: input.runId },
    create: {
      orgId: input.connection.orgId, connectionId: input.connection.id, syncRunId: input.runId,
      capability: source.capability, externalRecordId: input.row.sourceRecordId ?? input.row.externalKey,
      fingerprint, schemaVersion: JUNCTION_EXTRACTION_SCHEMA_VERSION, occurredAt: input.row.date,
      payload: json(payload), expiresAt,
    },
  });
}

async function developerForUsage(connection: ProviderConnection, row: ProviderUsage) {
  if (row.externalApiKeyId) {
    const apiKey = await prisma.providerApiKey.findUnique({
      where: { connectionId_externalKeyId: { connectionId: connection.id, externalKeyId: row.externalApiKeyId } },
      select: { developerId: true },
    });
    if (apiKey?.developerId) return apiKey.developerId;
  }
  if (row.externalUserId) {
    const identity = await prisma.externalIdentity.findUnique({
      where: { orgId_provider_externalUserId: { orgId: connection.orgId, provider: connection.provider, externalUserId: row.externalUserId } },
      select: { developerId: true },
    });
    if (identity?.developerId) return identity.developerId;
  }
  if (row.email) {
    const developer = await prisma.developer.findUnique({ where: { orgId_email: { orgId: connection.orgId, email: normalizeEmail(row.email) } }, select: { id: true } });
    return developer?.id ?? null;
  }
  return null;
}

async function upsertApiKey(connection: ProviderConnection, key: ProviderApiKey) {
  const existing = await prisma.providerApiKey.findUnique({
    where: { connectionId_externalKeyId: { connectionId: connection.id, externalKeyId: key.externalKeyId } },
  });
  const ownerEmail = key.ownerEmail ? normalizeEmail(key.ownerEmail) : null;
  const owner = ownerEmail
    ? await prisma.developer.findUnique({ where: { orgId_email: { orgId: connection.orgId, email: ownerEmail } }, select: { id: true } })
    : null;
  const { developerId, mappingSource } = resolveProviderApiKeyMapping(existing, owner?.id ?? null);
  return prisma.providerApiKey.upsert({
    where: { connectionId_externalKeyId: { connectionId: connection.id, externalKeyId: key.externalKeyId } },
    update: {
      developerId, name: key.name ?? null, redactedHint: key.redactedHint ?? null, projectId: key.projectId ?? null,
      workspaceId: key.workspaceId ?? null, ownerExternalId: key.ownerExternalId ?? null, ownerEmail,
      principalType: key.principalType ?? null, status: key.status ?? "active", mappingSource,
      metadata: json(key.metadata), lastSeenAt: new Date(),
    },
    create: {
      orgId: connection.orgId, connectionId: connection.id, developerId, externalKeyId: key.externalKeyId,
      name: key.name ?? null, redactedHint: key.redactedHint ?? null, projectId: key.projectId ?? null,
      workspaceId: key.workspaceId ?? null, ownerExternalId: key.ownerExternalId ?? null, ownerEmail,
      principalType: key.principalType ?? null, status: key.status ?? "active", mappingSource,
      metadata: json(key.metadata),
    },
  });
}

function usageMetadata(row: ProviderUsage) {
  return json({
    ...sanitizeExtractionPayload(row.metadata ?? {}),
    apiKeyId: row.externalApiKeyId ?? (row.metadata?.apiKeyId as string | undefined) ?? null,
    projectId: row.externalProjectId ?? (row.metadata?.projectId as string | undefined) ?? null,
    workspaceId: row.externalWorkspaceId ?? (row.metadata?.workspaceId as string | undefined) ?? null,
    sourceEndpoint: row.sourceEndpoint ?? null,
    sourceCapability: row.sourceCapability ?? "usage",
    sourceRecordId: row.sourceRecordId ?? row.externalKey,
    evidence: row.evidence ?? "vendor_verified",
    metricKind: row.metricKind ?? "usage",
    surface: row.surface ?? null,
    repository: row.repository ?? null,
  });
}

function usageCostKind(row: ProviderUsage) {
  if (!row.costMicros || row.costMicros <= BigInt(0)) return null;
  if (row.costKind) return row.costKind;
  return row.sourceCapability === "costs" || row.sourceCapability === "cost_report"
    ? "actual_spend"
    : "vendor_reported";
}

export async function validateConnection(connection: ProviderConnection) {
  const credential = await credentialForConnection(connection);
  const adapter = getAdapter(connection.provider, connection.product);
  return adapter.validate({ credential, config: configOf(connection), initialSync: !connection.lastSyncedAt, now: new Date() });
}

async function credentialForConnection(connection: ProviderConnection) {
  const config = configOf(connection);
  if (connection.provider === "github" && connection.method === "oauth" && config.installationId) {
    return githubInstallationToken(String(config.installationId));
  }
  if (!connection.credentialCiphertext) throw new Error("connection has no credential");
  return decryptSecret(connection.credentialCiphertext);
}

export async function syncConnection(connectionId: string) {
  const connection = await prisma.providerConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status === "disconnected") throw new Error("connection not available");
  const run = await prisma.providerSyncRun.create({ data: { orgId: connection.orgId, connectionId: connection.id } });
  try {
    const adapter = getAdapter(connection.provider, connection.product);
    const data = await adapter.sync({ credential: await credentialForConnection(connection), config: configOf(connection), initialSync: !connection.lastSyncedAt, now: new Date() });
    const identities = new Map<string, Awaited<ReturnType<typeof upsertMember>>>();
    for (const member of data.members) {
      if (!member.externalUserId || identities.has(member.externalUserId)) continue;
      identities.set(member.externalUserId, await upsertMember(connection, member));
    }

    if (data.apiKeys) {
      await prisma.providerApiKey.updateMany({ where: { connectionId: connection.id }, data: { status: "inactive" } });
      for (const key of data.apiKeys) await upsertApiKey(connection, key);
    }

    for (const seat of data.seats) {
      const identity = identities.get(seat.externalUserId) ?? await prisma.externalIdentity.findUnique({
        where: { orgId_provider_externalUserId: { orgId: connection.orgId, provider: connection.provider, externalUserId: seat.externalUserId } },
      });
      await prisma.seatAssignment.upsert({
        where: { connectionId_externalUserId: { connectionId: connection.id, externalUserId: seat.externalUserId } },
        update: { developerId: identity?.developerId ?? null, plan: seat.plan ?? null, status: seat.status ?? "active", assignedAt: seat.assignedAt ?? null, lastActivityAt: seat.lastActivityAt ?? null, observedAt: new Date(), metadata: json(seat.metadata) },
        create: { orgId: connection.orgId, connectionId: connection.id, developerId: identity?.developerId ?? null, externalUserId: seat.externalUserId, provider: connection.provider, product: seat.product, plan: seat.plan ?? null, status: seat.status ?? "active", source: "vendor_verified", assignedAt: seat.assignedAt ?? null, lastActivityAt: seat.lastActivityAt ?? null, metadata: json(seat.metadata) },
      });
    }

    for (const row of data.usage) {
      if (!(await vendorUsageAllowed({ orgId: connection.orgId, toolName: row.toolName ?? "", email: row.email }))) {
        continue;
      }
      await recordSourceEnvelope({ connection, runId: run.id, row });
      const developerId = await developerForUsage(connection, row);
      const dedupeKey = `${connection.id}:${row.externalKey}`;
      await prisma.usageDaily.upsert({
        where: { orgId_dedupeKey: { orgId: connection.orgId, dedupeKey } },
        update: {
          developerId, date: row.date, provider: row.provider, product: row.product, toolName: row.toolName ?? "", model: row.model ?? "",
          requests: row.requests ?? 0, sessions: row.sessions ?? 0, inputTokens: row.inputTokens ?? BigInt(0), outputTokens: row.outputTokens ?? BigInt(0),
          cacheReadTokens: row.cacheReadTokens ?? BigInt(0), cacheWriteTokens: row.cacheWriteTokens ?? BigInt(0), activeSeconds: row.activeSeconds ?? BigInt(0), suggestedLines: row.suggestedLines ?? BigInt(0),
          acceptedLines: row.acceptedLines ?? BigInt(0), addedLines: row.addedLines ?? BigInt(0), deletedLines: row.deletedLines ?? BigInt(0),
          commits: row.commits ?? 0, pullRequests: row.pullRequests ?? 0, costMicros: row.costMicros ?? BigInt(0),
          costKind: usageCostKind(row), metricKind: row.metricKind ?? "usage", observedAt: new Date(), metadata: usageMetadata(row),
        },
        create: {
          orgId: connection.orgId, developerId, connectionId: connection.id, date: row.date, provider: row.provider, product: row.product,
          toolName: row.toolName ?? "", model: row.model ?? "", source: "vendor_verified", sourceRef: row.externalKey, verified: true,
          requests: row.requests ?? 0, sessions: row.sessions ?? 0, inputTokens: row.inputTokens ?? BigInt(0), outputTokens: row.outputTokens ?? BigInt(0),
          cacheReadTokens: row.cacheReadTokens ?? BigInt(0), cacheWriteTokens: row.cacheWriteTokens ?? BigInt(0), activeSeconds: row.activeSeconds ?? BigInt(0), suggestedLines: row.suggestedLines ?? BigInt(0),
          acceptedLines: row.acceptedLines ?? BigInt(0), addedLines: row.addedLines ?? BigInt(0), deletedLines: row.deletedLines ?? BigInt(0),
          commits: row.commits ?? 0, pullRequests: row.pullRequests ?? 0, costMicros: row.costMicros ?? BigInt(0),
          costKind: usageCostKind(row), metricKind: row.metricKind ?? "usage", dedupeKey, metadata: usageMetadata(row),
        },
      });
    }
    const counts = { members: identities.size, seats: data.seats.length, apiKeys: data.apiKeys?.length ?? 0, usage: data.usage.length };
    const capabilityRows = new Map<string, { endpoint: string | null; dataThrough: Date | null }>();
    for (const row of data.usage) {
      const capability = row.sourceCapability ?? "usage";
      const current = capabilityRows.get(capability);
      const date = row.date;
      capabilityRows.set(capability, {
        endpoint: row.sourceEndpoint ?? current?.endpoint ?? null,
        dataThrough: !current?.dataThrough || date > current.dataThrough ? date : current.dataThrough,
      });
    }
    for (const [capability, details] of capabilityRows) {
      await recordCapability({ connection, capability, endpoint: details.endpoint, dataThrough: details.dataThrough });
    }
    if (data.members.length > 0) await recordCapability({ connection, capability: "members", endpoint: "provider-members", dataThrough: new Date() });
    if (data.seats.length > 0) await recordCapability({ connection, capability: "seats", endpoint: "provider-seats", dataThrough: new Date() });
    const now = new Date();
    await prisma.$transaction([
      prisma.providerConnection.update({ where: { id: connection.id }, data: {
        status: "active", externalOrgId: data.externalOrgId ?? connection.externalOrgId, permissions: json(data.permissions ?? []),
        lastSyncedAt: now, lastCostSyncedAt: data.costSyncSucceeded ? now : undefined,
        costDataThrough: data.costSyncSucceeded ? (data.costDataThrough ?? now) : undefined,
        nextSyncAt: new Date(now.getTime() + 15 * 60_000), leaseUntil: null, lastError: null,
      } }),
      prisma.providerSyncRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: now, counts } }),
    ]);
    await syncTeamSeatQuantityBestEffort(connection.orgId, "provider_sync.members");
    if (data.usage.length > 0) {
      await invalidateAnalyticsCache(connection.orgId, {
        dirtyDates: data.usage.map((row) => row.date).filter(Boolean),
      });
    }
    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date();
    await prisma.$transaction([
      prisma.providerConnection.update({ where: { id: connection.id }, data: { status: connection.lastSyncedAt ? "degraded" : "error", lastError: message.slice(0, 4000), leaseUntil: null, nextSyncAt: new Date(now.getTime() + 15 * 60_000) } }),
      prisma.providerSyncRun.update({ where: { id: run.id }, data: { status: "error", finishedAt: now, error: message.slice(0, 4000) } }),
    ]);
    throw error;
  }
}

export async function claimDueConnections(limit = 5) {
  const now = new Date();
  const candidates = await prisma.providerConnection.findMany({
    where: { status: { in: ["active", "degraded", "pending", "error"] }, AND: [{ OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] }, { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }] },
    orderBy: [{ nextSyncAt: "asc" }, { createdAt: "asc" }],
    take: limit * 2,
  });
  const claimed: string[] = [];
  for (const candidate of candidates) {
    if (claimed.length >= limit) break;
    const result = await prisma.providerConnection.updateMany({
      where: { id: candidate.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + 5 * 60_000) },
    });
    if (result.count === 1) claimed.push(candidate.id);
  }
  return claimed;
}
