import { prisma } from "@usejunction/db";

/**
 * Stop requests for in-flight provider syncs.
 *
 * A serverless sync cannot be interrupted from outside, so the UI records a
 * request here and the running sync checks it between repositories. Requests
 * expire so a stale click never halts a later cron run; a run that honours a
 * request deletes it.
 */
const STOP_REQUEST_MAX_AGE_MS = 10 * 60_000;

export function providerSyncStopKey(connectionId: string) {
  return `providerSyncStop:${connectionId}`;
}

export async function requestProviderSyncStop(connectionId: string, now = new Date()): Promise<void> {
  const key = providerSyncStopKey(connectionId);
  await prisma.appRuntimeSetting.upsert({
    where: { key },
    create: { key, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
}

export async function clearProviderSyncStop(connectionId: string): Promise<void> {
  await prisma.appRuntimeSetting.deleteMany({ where: { key: providerSyncStopKey(connectionId) } });
}

/** True when a stop was requested recently enough to apply to a run active now. */
export async function providerSyncStopRequested(
  connectionId: string,
  options: { now?: Date; maxAgeMs?: number } = {},
): Promise<boolean> {
  const row = await prisma.appRuntimeSetting.findUnique({
    where: { key: providerSyncStopKey(connectionId) },
    select: { value: true },
  });
  if (!row) return false;
  const requestedAt = new Date(row.value).getTime();
  if (!Number.isFinite(requestedAt)) return false;
  const now = (options.now ?? new Date()).getTime();
  return now - requestedAt <= (options.maxAgeMs ?? STOP_REQUEST_MAX_AGE_MS);
}
