const RESET_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function quotaWindowLabel(windowType: string): string {
  switch (windowType) {
    case "session_5h":
      return "5-hour";
    case "weekly":
    case "seven_day":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "credits":
      return "Credits";
    case "rate_limit_resets":
      return "Rate-limit resets";
    case "promo":
    case "promo_grant":
      return "Promo grant";
    case "credit_grant":
      return "Credit grant";
    case "bonus":
      return "Bonus usage";
    case "copilot_chat":
      return "Copilot chat";
    case "copilot_completions":
      return "Copilot completions";
    case "copilot_premium_interactions":
      return "Copilot premium";
    case "extra_usage":
      return "Extra usage";
    case "plan":
      return "Plan";
    case "api":
      return "API models";
    case "auto":
      return "Auto mode";
    case "claude_5h":
      return "Claude · 5-hour";
    case "claude_weekly":
      return "Claude · Weekly";
    case "claude_monthly":
      return "Claude · Monthly";
    case "gemini_5h":
      return "Gemini · 5-hour";
    case "gemini_weekly":
      return "Gemini · Weekly";
    case "gemini_monthly":
      return "Gemini · Monthly";
    case "gpt_5h":
      return "GPT · 5-hour";
    case "gpt_weekly":
      return "GPT · Weekly";
    case "gpt_monthly":
      return "GPT · Monthly";
    default:
      return windowType.replaceAll("_", " ");
  }
}

export function quotaResetLabel(resetAt: Date | string | null): string | null {
  if (!resetAt) return null;
  const date = resetAt instanceof Date ? resetAt : new Date(resetAt);
  if (Number.isNaN(date.getTime())) return null;
  return `resets ${RESET_TIME_FORMAT.format(date)}`;
}

/** Offers, grants, bonuses, and reset inventories — not primary plan pressure. */
export function isSecondaryQuotaWindow(windowType: string): boolean {
  return /promo|grant|bonus|rate_limit_resets|^credits$/i.test(windowType);
}

export function quotaRemainingLabel(
  remaining: number | null | undefined,
  windowType: string,
): string | null {
  if (remaining == null || Number.isNaN(remaining)) return null;
  const rounded =
    Math.abs(remaining) >= 100 || Number.isInteger(remaining)
      ? Math.round(remaining).toString()
      : remaining.toFixed(2).replace(/\.?0+$/, "");
  if (/rate_limit_resets/i.test(windowType)) {
    return `${rounded} reset${rounded === "1" ? "" : "s"} left`;
  }
  // Antigravity (and similar) report unit credits — not USD.
  if (/^credits$/i.test(windowType)) {
    return `${rounded} credit${rounded === "1" ? "" : "s"} left`;
  }
  // Cursor/Codex promo grants and bonuses are dollar balances.
  if (/promo|grant|bonus/i.test(windowType)) {
    return `$${rounded} left`;
  }
  return `${rounded} left`;
}

/** Prefer percent when present; otherwise remaining credits/resets. */
export function quotaSignalLabel(input: {
  windowType: string;
  usedPercent?: number | null;
  rawRatio?: number | null;
  remaining?: number | null;
  resetsAt?: Date | string | null;
}): string {
  const percent =
    input.usedPercent != null && !Number.isNaN(input.usedPercent)
      ? input.usedPercent
      : input.rawRatio != null && !Number.isNaN(input.rawRatio)
        ? input.rawRatio * 100
        : null;
  const parts: string[] = [];
  if (percent != null) {
    parts.push(`${percent.toFixed(0)}%`);
  } else {
    const remaining = quotaRemainingLabel(input.remaining ?? null, input.windowType);
    if (remaining) parts.push(remaining);
  }
  const reset = quotaResetLabel(input.resetsAt ?? null);
  if (reset) {
    // For inventory windows, "expires" reads clearer than "resets".
    const resetText = isSecondaryQuotaWindow(input.windowType)
      ? reset.replace(/^resets /, "expires ")
      : reset;
    parts.push(resetText);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Prefer longer billing windows when picking one signal per person. */
function quotaWindowRank(windowType: string): number {
  if (isSecondaryQuotaWindow(windowType)) return 4;
  if (/month/i.test(windowType)) return 0;
  if (/week|seven_day/i.test(windowType)) return 1;
  if (/day|session|5h|hour|plan|premium/i.test(windowType)) return 2;
  return 3;
}

export type TeamQuotaSnapshot = {
  windowType: string;
  usedPercent: number | null;
  deviceHostname?: string | null;
  developerName?: string | null;
};

export type TeamQuotaAggregate = {
  /** Average of each person's primary window %. Null if nobody has a signal. */
  avgPercent: number | null;
  peopleWithSignal: number;
  peopleReporting: number;
  primaryWindowLabel: string | null;
};

/**
 * Team lists cannot dump per-person session windows (5h / api / auto) as if they
 * were one org number. Aggregate by taking each person's primary window, then averaging.
 */
export function aggregateTeamQuotas(quotas: TeamQuotaSnapshot[]): TeamQuotaAggregate | null {
  if (!quotas.length) return null;

  const byPerson = new Map<string, TeamQuotaSnapshot[]>();
  for (const quota of quotas) {
    const personKey = quota.developerName?.trim() || quota.deviceHostname?.trim() || "unknown";
    const list = byPerson.get(personKey) ?? [];
    list.push(quota);
    byPerson.set(personKey, list);
  }

  const primaryPercents: number[] = [];
  let primaryWindowType: string | null = null;

  for (const personQuotas of byPerson.values()) {
    const ranked = [...personQuotas].sort(
      (a, b) => quotaWindowRank(a.windowType) - quotaWindowRank(b.windowType),
    );
    const primary = ranked.find((quota) => quota.usedPercent != null && !Number.isNaN(quota.usedPercent));
    if (!primary || primary.usedPercent == null) continue;
    primaryPercents.push(primary.usedPercent);
    if (
      primaryWindowType == null ||
      quotaWindowRank(primary.windowType) < quotaWindowRank(primaryWindowType)
    ) {
      primaryWindowType = primary.windowType;
    }
  }

  return {
    avgPercent:
      primaryPercents.length > 0
        ? primaryPercents.reduce((sum, value) => sum + value, 0) / primaryPercents.length
        : null,
    peopleWithSignal: primaryPercents.length,
    peopleReporting: byPerson.size,
    primaryWindowLabel: primaryWindowType ? quotaWindowLabel(primaryWindowType) : null,
  };
}

export function teamQuotaSummaryLabel(aggregate: TeamQuotaAggregate): string {
  if (aggregate.avgPercent == null) {
    return aggregate.peopleReporting > 0
      ? `${aggregate.peopleReporting} reporting`
      : "No signal";
  }
  const people =
    aggregate.peopleWithSignal === 1
      ? "1 person"
      : `${aggregate.peopleWithSignal} people`;
  const window = aggregate.primaryWindowLabel ? ` · ${aggregate.primaryWindowLabel}` : "";
  return `avg ${Math.round(aggregate.avgPercent)}%${window} · ${people}`;
}
