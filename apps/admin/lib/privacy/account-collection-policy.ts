import type { CollectionStream } from "@/lib/privacy/account-collection-types";

export const GATED_COLLECTION_TOOLS = ["cursor", "codex", "claude", "copilot", "antigravity", "opencode"] as const;
export type GatedCollectionTool = string;

export type AccountCollectionFlags = {
  usageEnabled: boolean;
  loggingEnabled: boolean;
  usageAdminLocked: boolean;
  loggingAdminLocked: boolean;
};

export function isGatedCollectionTool(toolName: string): toolName is GatedCollectionTool {
  return toolName.trim().length > 0;
}

export function normalizeAccountKey(accountKey?: string | null, email?: string | null): string {
  const key = String(accountKey ?? "").trim();
  if (key) return key;
  return String(email ?? "").trim().toLowerCase();
}

export function defaultCollectionFlags(_toolName?: string): AccountCollectionFlags {
  return {
    usageEnabled: true,
    loggingEnabled: false,
    usageAdminLocked: false,
    loggingAdminLocked: false,
  };
}

export function usageEffectivelyEnabled(account: Pick<AccountCollectionFlags, "usageEnabled" | "usageAdminLocked">): boolean {
  return account.usageEnabled && !account.usageAdminLocked;
}

export function loggingEffectivelyEnabled(account: Pick<AccountCollectionFlags, "loggingEnabled" | "loggingAdminLocked">): boolean {
  return account.loggingEnabled && !account.loggingAdminLocked;
}

export function developerSwitchBlocked(account: AccountCollectionFlags, stream: CollectionStream): string | null {
  if (stream === "usage" && account.usageAdminLocked) {
    return "An admin has locked usage collection for this account.";
  }
  if (stream === "logging" && account.loggingAdminLocked) {
    return "An admin has locked logging for this account.";
  }
  return null;
}

export function pickExistingAccount<T extends { accountKey: string; email: string | null }>(
  existing: T[],
  incoming: { accountKey: string; email?: string | null },
): T | null {
  const key = incoming.accountKey;
  const email = String(incoming.email ?? "").trim().toLowerCase();
  const byKey = existing.find((row) => row.accountKey === key);
  if (byKey) return byKey;
  if (email) {
    const byEmail = existing.find((row) => String(row.email ?? "").trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const legacy = existing.find((row) => row.accountKey === "");
  if (legacy) return legacy;
  return null;
}

export function usageAccountToken(toolName: string, accountKey?: string | null): string {
  return `${toolName.trim()}\0${normalizeAccountKey(accountKey)}`;
}

export function keepUsageRow(toolName: string, accountKey: string | undefined | null, allowed: Set<string>): boolean {
  const name = toolName.trim();
  const key = normalizeAccountKey(accountKey);
  if (!name || !key) return false;
  return allowed.has(usageAccountToken(name, key));
}
