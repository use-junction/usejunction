// A login nobody has reported for this long is stale: it is hidden from the
// tool page and its detected seat ends, so seat counts fall when a login or
// seat goes away instead of lingering forever.
export const STALE_LOGIN_DAYS = 30;

export function staleLoginCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_LOGIN_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * A login is stale when its device has not checked in for 30 days, or when its
 * device stopped reporting it (signed out) more than 30 days ago.
 */
export function isStaleLogin(
  row: { authPresent: boolean; updatedAt: Date; device?: { lastSeenAt: Date } | null },
  now = new Date(),
): boolean {
  const cutoff = staleLoginCutoff(now);
  if (row.device && row.device.lastSeenAt < cutoff) return true;
  return !row.authPresent && row.updatedAt < cutoff;
}
