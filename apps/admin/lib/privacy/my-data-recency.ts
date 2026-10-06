import { normalizeAccountKey } from "@/lib/privacy/account-collection-policy";
import type { PublicCollectionAccount } from "@/lib/privacy/account-collection-types";
import type {
  MyDataAccountRow,
  UsageStorageAggregate,
  UsageStorageState,
} from "@/lib/privacy/my-data-types";

export function usageRetentionCutoff(retentionDays: number, now = new Date()): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export function isoUsageDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const day = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function usageStorageToken(deviceId: string, toolName: string, accountKey: string): string {
  return `${deviceId}\0${toolName.trim()}\0${normalizeAccountKey(accountKey)}`;
}

function laterDay(left: string | null | undefined, right: string): string {
  return left && left > right ? left : right;
}

export function attachUsageStorage(
  accounts: PublicCollectionAccount[],
  aggregates: UsageStorageAggregate[],
): {
  accounts: MyDataAccountRow[];
  hasUnattributedUsage: boolean;
  latestStoredUsageDay: string | null;
} {
  const namedTokens = new Set(
    accounts
      .filter((account) => Boolean(normalizeAccountKey(account.accountKey)))
      .map((account) => usageStorageToken(account.deviceId, account.toolName, account.accountKey)),
  );
  const emptyTokens = new Set(
    accounts
      .filter((account) => !normalizeAccountKey(account.accountKey))
      .map((account) => usageStorageToken(account.deviceId, account.toolName, "")),
  );

  const matched = new Map<string, { last: string; first: string; requests: number }>();
  let hasUnattributedUsage = false;
  let latestStoredUsageDay: string | null = null;

  function record(token: string, day: string, row: UsageStorageAggregate) {
    const first = isoUsageDay(row.firstUsageDay) ?? day;
    const current = matched.get(token);
    matched.set(token, {
      last: laterDay(current?.last, day),
      first: current && current.first < first ? current.first : first,
      requests: (current?.requests ?? 0) + (row.requests ?? 0),
    });
  }

  for (const row of aggregates) {
    const day = isoUsageDay(row.lastUsageDay);
    if (!day) continue;
    latestStoredUsageDay = laterDay(latestStoredUsageDay, day);
    const deviceId = String(row.deviceId ?? "").trim();
    if (!deviceId) {
      hasUnattributedUsage = true;
      continue;
    }
    const key = normalizeAccountKey(row.accountKey);
    const token = usageStorageToken(deviceId, row.toolName, key);
    if ((key ? namedTokens : emptyTokens).has(token)) {
      record(token, day, row);
    } else {
      hasUnattributedUsage = true;
    }
  }

  return {
    hasUnattributedUsage,
    latestStoredUsageDay,
    accounts: accounts.map((account) => {
      const stored = matched.get(usageStorageToken(account.deviceId, account.toolName, account.accountKey));
      const lastUsageDay = stored?.last ?? null;
      let state: UsageStorageState = "none";
      if (lastUsageDay && account.usageAllowed) state = "active_day";
      else if (lastUsageDay) state = "historical_day";
      return {
        ...account,
        usageStorage: {
          state,
          lastUsageDay,
          firstUsageDay: stored?.first ?? null,
          storedRequests: stored?.requests ?? 0,
        },
      };
    }),
  };
}

export function formatStoredUsageDay(day: string, locale?: string): string {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatPreferenceTime(value: string, locale?: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  return parsed.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

export function preferenceEventCopy(
  event: { createdAt: string; actor: string; stream: string; enabled: boolean; displayName: string; email: string | null; hostname: string },
  locale?: string,
): string {
  const actor = event.actor === "admin" ? "Workspace admin" : "You";
  const stream = event.stream === "logging" ? "Activity logging" : "Usage";
  const who = event.email || "this device";
  const place = event.hostname ? ` on ${event.hostname}` : "";
  return `${formatPreferenceTime(event.createdAt, locale)} · ${actor} turned ${stream} ${event.enabled ? "on" : "off"} for ${event.displayName} · ${who}${place}`;
}

export function usageStorageCopy(row: MyDataAccountRow, locale?: string): string {
  const last = row.usageStorage.lastUsageDay ? formatStoredUsageDay(row.usageStorage.lastUsageDay, locale) : "";
  const first = row.usageStorage.firstUsageDay ? formatStoredUsageDay(row.usageStorage.firstUsageDay, locale) : "";
  const requests = row.usageStorage.storedRequests ?? 0;
  const extras = [
    first && first !== last ? `since ${first}` : null,
    requests > 0 ? `${requests.toLocaleString(locale)} requests stored` : null,
  ].filter(Boolean);
  const detail = extras.length ? ` · ${extras.join(" · ")}` : "";
  if (row.usageStorage.state === "active_day") return `Last stored usage day: ${last}${detail}`;
  if (row.usageStorage.state === "historical_day") return `Usage off · last stored day ${last}${detail}`;
  if (row.usageAllowed) return "Usage on · no days stored yet";
  return "Usage off · nothing stored for this login";
}
