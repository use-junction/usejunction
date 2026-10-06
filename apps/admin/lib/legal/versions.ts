export const LEGAL_TERMS_VERSION = "2026-09-18";
export const LEGAL_PRIVACY_VERSION = "2026-09-18";
export const COLLECTION_NOTICE_VERSION = "2026-09-18";
export const ANALYTICS_CONSENT_VERSION = "2026-09-18";

export const USAGE_RETENTION_OPTIONS = [90, 180, 365, 730, 1095] as const;
export type UsageRetentionDays = (typeof USAGE_RETENTION_OPTIONS)[number];
export const DEFAULT_USAGE_RETENTION_DAYS = 1095;
export const ERASURE_GRACE_DAYS = 30;
export const AUDIT_RETENTION_DAYS = 730;
export const DEVICE_ACTIVITY_RETENTION_DAYS = 30;

/**
 * Cutoff deletion for UsageDaily is not enabled yet. Keep the job and org
 * setting as WIP; after three years we should only retain what is still needed.
 */
export const USAGE_RETENTION_ENFORCEMENT_ENABLED = false;

export function isUsageRetentionDays(value: unknown): value is UsageRetentionDays {
  return typeof value === "number" && (USAGE_RETENTION_OPTIONS as readonly number[]).includes(value);
}

export function formatUsageRetention(days: number): string {
  if (days > 0 && days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return `${days} days`;
}
