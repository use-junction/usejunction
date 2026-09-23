/**
 * Account inventory apply + content hash for sync-engine start sidecar.
 * Keep byte-compatible with agent/internal/syncengine/accounts.go.
 */
import { createHash } from "crypto";
import { prisma } from "@usejunction/db";
import {
  recordDeviceActivityEvent,
  uniqueStrings,
} from "@/lib/activity/record-device-activity-event";
import { syncDetectedPlansForDevice } from "@/lib/tools/sync-detected";
import { logServerError } from "@/lib/errors/public";
import {
  defaultCollectionFlags,
  normalizeAccountKey,
  pickExistingAccount,
} from "@/lib/privacy/account-collection-policy";

export type AccountInventoryItem = {
  toolName: string;
  accountKey?: string | null;
  email?: string | null;
  plan?: string | null;
  loginMethod?: string | null;
  authPresent?: boolean;
};

export type SidecarAppliedStatus = "unchanged" | "updated" | "failed" | "skipped";

export type AccountInventoryReported = {
  toolName: string;
  accountKey: string;
  plan: string | null;
  email: string | null;
  authPresent: boolean;
  usageEnabled: boolean;
  loggingEnabled: boolean;
  usageAdminLocked: boolean;
  loggingAdminLocked: boolean;
};

export function accountsInventoryCanonicalLine(item: AccountInventoryItem): string {
  const toolName = String(item.toolName ?? "").trim();
  const accountKey = String(item.accountKey ?? "").trim();
  const email = String(item.email ?? "").trim();
  const plan = String(item.plan ?? "").trim();
  const loginMethod = String(item.loginMethod ?? "").trim();
  const authPresent = item.authPresent ? "1" : "0";
  return `${toolName}|${accountKey}|${email}|${plan}|${loginMethod}|${authPresent}`;
}

/** Plan merge: non-empty incoming always wins; sticky last-known only while authPresent. */
export function resolveStickyAccountPlan(params: {
  incomingPlan: string;
  existingPlan: string | null | undefined;
  authPresent: boolean;
}): string | null {
  const incoming = params.incomingPlan.trim();
  if (incoming !== "") return incoming;
  if (params.authPresent) return params.existingPlan?.trim() || null;
  return null;
}

export function accountsInventoryContentHash(items: AccountInventoryItem[]): string {
  const lines = items
    .filter((item) => String(item.toolName ?? "").trim())
    .map(accountsInventoryCanonicalLine)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}

export async function applyDeviceAccountInventory(params: {
  orgId: string;
  userId: string;
  deviceId: string;
  items: AccountInventoryItem[];
  contentHash: string;
  runPlanSync?: boolean;
}): Promise<{
  upserted: number;
  reported: AccountInventoryReported[];
}> {
  const started = Date.now();
  let upserted = 0;
  const reported: AccountInventoryReported[] = [];
  const incomingKeysByTool = new Map<string, string[]>();

  for (const acct of params.items) {
    const toolName = String(acct.toolName ?? "").trim();
    if (!toolName) continue;

    const incomingEmail = typeof acct.email === "string" ? acct.email.trim() : "";
    const accountKey = normalizeAccountKey(acct.accountKey, incomingEmail);
    const existingRows = await prisma.toolAccount.findMany({
      where: { deviceId: params.deviceId, toolName },
      select: { id: true, accountKey: true, email: true, plan: true },
    });
    const existing = pickExistingAccount(existingRows, { accountKey, email: incomingEmail });

    const incomingPlan = typeof acct.plan === "string" ? acct.plan.trim() : "";
    const authPresent = Boolean(acct.authPresent);
    const plan = resolveStickyAccountPlan({
      incomingPlan,
      existingPlan: existing?.plan,
      authPresent,
    });
    const email = incomingEmail || existing?.email || null;
    const flags = defaultCollectionFlags(toolName);

    if (existing) {
      await prisma.toolAccount.update({
        where: { id: existing.id },
        data: {
          accountKey,
          email,
          plan,
          loginMethod: acct.loginMethod?.trim() || "unknown",
          authPresent,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.toolAccount.create({
        data: {
          orgId: params.orgId,
          userId: params.userId,
          deviceId: params.deviceId,
          toolName,
          accountKey,
          email,
          plan,
          loginMethod: acct.loginMethod?.trim() || "unknown",
          authPresent,
          usageEnabled: flags.usageEnabled,
          loggingEnabled: flags.loggingEnabled,
        },
      });
    }

    const stored = await prisma.toolAccount.findUnique({
      where: {
        deviceId_toolName_accountKey: {
          deviceId: params.deviceId,
          toolName,
          accountKey,
        },
      },
      select: {
        usageEnabled: true,
        loggingEnabled: true,
        usageAdminLocked: true,
        loggingAdminLocked: true,
      },
    });

    reported.push({
      toolName,
      accountKey,
      plan,
      email,
      authPresent,
      usageEnabled: stored?.usageEnabled ?? flags.usageEnabled,
      loggingEnabled: stored?.loggingEnabled ?? flags.loggingEnabled,
      usageAdminLocked: stored?.usageAdminLocked ?? false,
      loggingAdminLocked: stored?.loggingAdminLocked ?? false,
    });
    const keys = incomingKeysByTool.get(toolName) ?? [];
    keys.push(accountKey);
    incomingKeysByTool.set(toolName, keys);
    upserted += 1;
  }

  for (const [toolName, keys] of incomingKeysByTool) {
    await prisma.toolAccount.updateMany({
      where: {
        deviceId: params.deviceId,
        toolName,
        accountKey: { notIn: keys },
      },
      data: { authPresent: false, updatedAt: new Date() },
    });
  }

  const now = new Date();
  await prisma.device.update({
    where: { id: params.deviceId },
    data: {
      lastSeenAt: now,
      lastAccountSyncAt: now,
      accountsContentHash: params.contentHash,
    },
  });

  if (params.runPlanSync !== false && reported.length > 0) {
    try {
      await syncDetectedPlansForDevice({
        orgId: params.orgId,
        developerId: params.userId,
        accounts: reported,
      });
    } catch (syncError) {
      logServerError("sync/accounts-plan-sync", syncError, {
        orgId: params.orgId,
        deviceId: params.deviceId,
      });
    }
  }

  const toolNames = uniqueStrings(reported.map((row) => row.toolName));
  await recordDeviceActivityEvent({
    orgId: params.orgId,
    developerId: params.userId,
    deviceId: params.deviceId,
    kind: "accounts",
    status: "ok",
    summary: `Account sync · ${upserted} accounts${toolNames.length ? ` · ${toolNames.join(", ")}` : ""}`,
    requestSummary: {
      accounts: upserted,
      tools: toolNames,
      sample: reported.slice(0, 8),
      via: "sync-start",
    },
    responseSummary: { upserted },
    durationMs: Date.now() - started,
  });

  return { upserted, reported };
}
