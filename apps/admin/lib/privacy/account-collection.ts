import { prisma } from "@usejunction/db";
import { toolDisplayName } from "@/lib/tools/catalog";
import type { CollectionStream, PublicCollectionAccount, PublicCollectionEvent } from "@/lib/privacy/account-collection-types";
import {
  developerSwitchBlocked,
  isGatedCollectionTool,
  loggingEffectivelyEnabled,
  usageEffectivelyEnabled,
  type AccountCollectionFlags,
} from "@/lib/privacy/account-collection-policy";

export type { CollectionStream, PublicCollectionAccount, PublicCollectionEvent } from "@/lib/privacy/account-collection-types";
export {
  defaultCollectionFlags,
  developerSwitchBlocked,
  GATED_COLLECTION_TOOLS,
  isGatedCollectionTool,
  keepUsageRow,
  loggingEffectivelyEnabled,
  normalizeAccountKey,
  pickExistingAccount,
  usageEffectivelyEnabled,
} from "@/lib/privacy/account-collection-policy";
export type { AccountCollectionFlags, GatedCollectionTool } from "@/lib/privacy/account-collection-policy";

export type CollectionActor = "developer" | "admin";

export const ACCOUNT_COLLECTION_AUDIT = {
  usageEnabled: "account_collection.usage_enabled",
  usageDisabled: "account_collection.usage_disabled",
  loggingEnabled: "account_collection.logging_enabled",
  loggingDisabled: "account_collection.logging_disabled",
  usageLocked: "account_collection.usage_locked",
  usageUnlocked: "account_collection.usage_unlocked",
  loggingLocked: "account_collection.logging_locked",
  loggingUnlocked: "account_collection.logging_unlocked",
} as const;

export type AccountCollectionRow = AccountCollectionFlags & {
  id: string;
  orgId: string;
  userId: string;
  deviceId: string;
  toolName: string;
  accountKey: string;
  email: string | null;
  plan: string | null;
  loginMethod: string;
  authPresent: boolean;
  updatedAt: Date;
};

function displayName(toolName: string): string {
  return toolDisplayName(toolName);
}

function toPublicAccount(
  row: AccountCollectionRow & { device?: { hostname: string } | null },
): PublicCollectionAccount {
  return {
    id: row.id,
    deviceId: row.deviceId,
    hostname: row.device?.hostname ?? "",
    toolName: row.toolName,
    displayName: displayName(row.toolName),
    accountKey: row.accountKey,
    email: row.email,
    plan: row.plan,
    authPresent: row.authPresent,
    usageEnabled: row.usageEnabled,
    loggingEnabled: row.loggingEnabled,
    usageAdminLocked: row.usageAdminLocked,
    loggingAdminLocked: row.loggingAdminLocked,
    usageAllowed: usageEffectivelyEnabled(row),
    loggingAllowed: loggingEffectivelyEnabled(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const accountSelect = {
  id: true,
  orgId: true,
  userId: true,
  deviceId: true,
  toolName: true,
  accountKey: true,
  email: true,
  plan: true,
  loginMethod: true,
  authPresent: true,
  usageEnabled: true,
  loggingEnabled: true,
  usageAdminLocked: true,
  loggingAdminLocked: true,
  updatedAt: true,
  device: { select: { hostname: true } },
} as const;

export async function listGatedAccounts(params: {
  orgId: string;
  userId?: string;
  deviceId?: string;
}): Promise<PublicCollectionAccount[]> {
  const rows = await prisma.toolAccount.findMany({
    where: {
      orgId: params.orgId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
    },
    select: accountSelect,
    orderBy: [{ toolName: "asc" }, { email: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(toPublicAccount);
}

export async function listCollectionEvents(params: {
  orgId: string;
  userId?: string;
  deviceId?: string;
  take?: number;
}): Promise<PublicCollectionEvent[]> {
  const rows = await prisma.accountCollectionEvent.findMany({
    where: {
      orgId: params.orgId,
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
      ...(params.userId
        ? { device: { userId: params.userId } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.take ?? 40,
    select: {
      id: true,
      deviceId: true,
      toolName: true,
      accountKey: true,
      stream: true,
      enabled: true,
      actor: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    deviceId: row.deviceId,
    toolName: row.toolName,
    accountKey: row.accountKey,
    stream: row.stream,
    enabled: row.enabled,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function loadAccount(params: {
  orgId: string;
  deviceId: string;
  toolName: string;
  accountKey: string;
  userId?: string;
}) {
  return prisma.toolAccount.findFirst({
    where: {
      orgId: params.orgId,
      deviceId: params.deviceId,
      toolName: params.toolName,
      accountKey: params.accountKey,
      ...(params.userId ? { userId: params.userId } : {}),
    },
    select: accountSelect,
  });
}

async function recordCollectionChange(params: {
  account: AccountCollectionRow;
  stream: CollectionStream;
  enabled: boolean;
  actor: CollectionActor;
  actorId: string;
  action: string;
}) {
  await prisma.accountCollectionEvent.create({
    data: {
      orgId: params.account.orgId,
      deviceId: params.account.deviceId,
      toolAccountId: params.account.id,
      toolName: params.account.toolName,
      accountKey: params.account.accountKey,
      stream: params.stream,
      enabled: params.enabled,
      actor: params.actor,
      actorId: params.actorId,
    },
  });
  await prisma.auditLog.create({
    data: {
      orgId: params.account.orgId,
      actorType: "user",
      actorId: params.actorId,
      action: params.action,
      targetType: "tool_account",
      targetId: params.account.id,
      metadata: {
        toolName: params.account.toolName,
        accountKey: params.account.accountKey,
        email: params.account.email,
        stream: params.stream,
        enabled: params.enabled,
        actor: params.actor,
      },
    },
  });
}

export async function setDeveloperCollectionSwitch(params: {
  orgId: string;
  userId: string;
  actorId: string;
  deviceId: string;
  toolName: string;
  accountKey: string;
  stream: CollectionStream;
  enabled: boolean;
}): Promise<PublicCollectionAccount | { error: string; status: number }> {
  if (!isGatedCollectionTool(params.toolName)) {
    return { error: "A provider is required.", status: 400 };
  }
  const account = await loadAccount({
    orgId: params.orgId,
    deviceId: params.deviceId,
    toolName: params.toolName,
    accountKey: params.accountKey,
    userId: params.userId,
  });
  if (!account) return { error: "account not found", status: 404 };

  const blocked = developerSwitchBlocked(account, params.stream);
  if (blocked) return { error: blocked, status: 403 };

  const data =
    params.stream === "usage"
      ? { usageEnabled: params.enabled, updatedAt: new Date() }
      : { loggingEnabled: params.enabled, updatedAt: new Date() };
  const updated = await prisma.toolAccount.update({
    where: { id: account.id },
    data,
    select: accountSelect,
  });
  await recordCollectionChange({
    account: updated,
    stream: params.stream,
    enabled: params.enabled,
    actor: "developer",
    actorId: params.actorId,
    action:
      params.stream === "usage"
        ? params.enabled
          ? ACCOUNT_COLLECTION_AUDIT.usageEnabled
          : ACCOUNT_COLLECTION_AUDIT.usageDisabled
        : params.enabled
          ? ACCOUNT_COLLECTION_AUDIT.loggingEnabled
          : ACCOUNT_COLLECTION_AUDIT.loggingDisabled,
  });
  return toPublicAccount(updated);
}

export async function setAdminCollectionLock(params: {
  orgId: string;
  actorId: string;
  deviceId: string;
  toolName: string;
  accountKey: string;
  stream: CollectionStream;
  locked: boolean;
}): Promise<PublicCollectionAccount | { error: string; status: number }> {
  if (!isGatedCollectionTool(params.toolName)) {
    return { error: "A provider is required.", status: 400 };
  }
  const account = await loadAccount({
    orgId: params.orgId,
    deviceId: params.deviceId,
    toolName: params.toolName,
    accountKey: params.accountKey,
  });
  if (!account) return { error: "account not found", status: 404 };

  const data =
    params.stream === "usage"
      ? { usageAdminLocked: params.locked, updatedAt: new Date() }
      : { loggingAdminLocked: params.locked, updatedAt: new Date() };
  const updated = await prisma.toolAccount.update({
    where: { id: account.id },
    data,
    select: accountSelect,
  });
  await recordCollectionChange({
    account: updated,
    stream: params.stream,
    enabled: !params.locked,
    actor: "admin",
    actorId: params.actorId,
    action:
      params.stream === "usage"
        ? params.locked
          ? ACCOUNT_COLLECTION_AUDIT.usageLocked
          : ACCOUNT_COLLECTION_AUDIT.usageUnlocked
        : params.locked
          ? ACCOUNT_COLLECTION_AUDIT.loggingLocked
          : ACCOUNT_COLLECTION_AUDIT.loggingUnlocked,
  });
  return toPublicAccount(updated);
}

export async function setDeveloperAccountOptIn(params: {
  orgId: string;
  userId: string;
  actorId: string;
  deviceId: string;
  toolName: string;
  accountKey: string;
  enabled: boolean;
}): Promise<PublicCollectionAccount | { error: string; status: number }> {
  if (!isGatedCollectionTool(params.toolName)) {
    return { error: "A provider is required.", status: 400 };
  }
  const account = await loadAccount({
    orgId: params.orgId,
    deviceId: params.deviceId,
    toolName: params.toolName,
    accountKey: params.accountKey,
    userId: params.userId,
  });
  if (!account) return { error: "account not found", status: 404 };

  const usageBlocked = developerSwitchBlocked(account, "usage");
  const loggingBlocked = developerSwitchBlocked(account, "logging");
  if (params.enabled && usageBlocked && loggingBlocked) {
    return { error: usageBlocked ?? loggingBlocked ?? "An admin has locked this account.", status: 403 };
  }

  const updated = await prisma.toolAccount.update({
    where: { id: account.id },
    data: {
      ...(usageBlocked ? {} : { usageEnabled: params.enabled }),
      ...(loggingBlocked ? {} : { loggingEnabled: params.enabled }),
      updatedAt: new Date(),
    },
    select: accountSelect,
  });
  if (!usageBlocked && account.usageEnabled !== params.enabled) {
    await recordCollectionChange({
      account: updated,
      stream: "usage",
      enabled: params.enabled,
      actor: "developer",
      actorId: params.actorId,
      action: params.enabled ? ACCOUNT_COLLECTION_AUDIT.usageEnabled : ACCOUNT_COLLECTION_AUDIT.usageDisabled,
    });
  }
  if (!loggingBlocked && account.loggingEnabled !== params.enabled) {
    await recordCollectionChange({
      account: updated,
      stream: "logging",
      enabled: params.enabled,
      actor: "developer",
      actorId: params.actorId,
      action: params.enabled ? ACCOUNT_COLLECTION_AUDIT.loggingEnabled : ACCOUNT_COLLECTION_AUDIT.loggingDisabled,
    });
  }
  return toPublicAccount(updated);
}

export async function setDeveloperProviderCollection(params: {
  orgId: string;
  userId: string;
  actorId: string;
  toolName: string;
  enabled: boolean;
}): Promise<{ accounts: PublicCollectionAccount[] } | { error: string; status: number }> {
  if (!isGatedCollectionTool(params.toolName)) {
    return { error: "A provider is required.", status: 400 };
  }
  if (params.enabled) {
    return { error: "Opt in the signed-in account. Turning a provider on does not opt every account in.", status: 400 };
  }
  const rows = await prisma.toolAccount.findMany({
    where: { orgId: params.orgId, userId: params.userId, toolName: params.toolName },
    select: accountSelect,
  });
  if (!rows.length) return { error: "No account for this provider yet.", status: 404 };

  for (const account of rows) {
    const usageBlocked = developerSwitchBlocked(account, "usage");
    const loggingBlocked = developerSwitchBlocked(account, "logging");
    if ((usageBlocked || !account.usageEnabled) && (loggingBlocked || !account.loggingEnabled)) continue;
    const updated = await prisma.toolAccount.update({
      where: { id: account.id },
      data: {
        ...(usageBlocked ? {} : { usageEnabled: false }),
        ...(loggingBlocked ? {} : { loggingEnabled: false }),
        updatedAt: new Date(),
      },
      select: accountSelect,
    });
    if (!usageBlocked && account.usageEnabled) {
      await recordCollectionChange({
        account: updated,
        stream: "usage",
        enabled: false,
        actor: "developer",
        actorId: params.actorId,
        action: ACCOUNT_COLLECTION_AUDIT.usageDisabled,
      });
    }
    if (!loggingBlocked && account.loggingEnabled) {
      await recordCollectionChange({
        account: updated,
        stream: "logging",
        enabled: false,
        actor: "developer",
        actorId: params.actorId,
        action: ACCOUNT_COLLECTION_AUDIT.loggingDisabled,
      });
    }
  }
  return { accounts: await listGatedAccounts({ orgId: params.orgId, userId: params.userId }) };
}

export async function deviceActiveAccountAllowed(params: {
  deviceId: string;
  toolName: string;
  stream: CollectionStream;
}): Promise<boolean> {
  if (!isGatedCollectionTool(params.toolName)) return false;
  const accounts = await prisma.toolAccount.findMany({
    where: { deviceId: params.deviceId, toolName: params.toolName },
    select: {
      authPresent: true,
      updatedAt: true,
      usageEnabled: true,
      loggingEnabled: true,
      usageAdminLocked: true,
      loggingAdminLocked: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const active = accounts.find((row) => row.authPresent) ?? accounts[0];
  if (!active) return false;
  return params.stream === "usage" ? usageEffectivelyEnabled(active) : loggingEffectivelyEnabled(active);
}

export async function filterGatedUsageToolNames(
  deviceId: string,
  toolNames: string[],
): Promise<Set<string>> {
  const names = [...new Set(toolNames.map((name) => name.trim()).filter(isGatedCollectionTool))];
  const allowed = new Set<string>();
  for (const toolName of names) {
    if (await deviceActiveAccountAllowed({ deviceId, toolName, stream: "usage" })) {
      allowed.add(toolName);
    }
  }
  return allowed;
}

export async function vendorUsageAllowed(params: {
  orgId: string;
  toolName: string;
  email?: string | null;
}): Promise<boolean> {
  if (!isGatedCollectionTool(params.toolName)) return false;
  const email = String(params.email ?? "").trim().toLowerCase();
  const accounts = await prisma.toolAccount.findMany({
    where: { orgId: params.orgId, toolName: params.toolName },
    select: {
      email: true,
      usageEnabled: true,
      usageAdminLocked: true,
    },
  });
  if (accounts.length === 0) return true;
  if (!email) return false;
  const matching = accounts.filter((row) => String(row.email ?? "").trim().toLowerCase() === email);
  if (matching.length === 0) return false;
  return matching.some(usageEffectivelyEnabled);
}
