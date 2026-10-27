import { randomBytes } from "crypto";
import { Prisma, prisma } from "@usejunction/db";
import { chunkRows } from "@/lib/concurrency";

export type DeviceUsageFingerprintRow = {
  partitionKey: string;
  contentHash: string;
  date: Date;
};

function newFingerprintId() {
  return `c${randomBytes(12).toString("hex")}`;
}


/** Collapse duplicate partition keys; last-write wins (matches per-row upsert semantics). */
export function collapseDeviceUsageFingerprints(rows: DeviceUsageFingerprintRow[]): DeviceUsageFingerprintRow[] {
  const byKey = new Map<string, DeviceUsageFingerprintRow>();
  for (const row of rows) {
    byKey.set(row.partitionKey, row);
  }
  return [...byKey.values()];
}

const BULK_CHUNK = 200;

/**
 * Bulk upsert device usage fingerprints in one SQL round-trip per chunk batch.
 * Replaces per-row Prisma upserts on the hot chunk path.
 */
export async function bulkUpsertDeviceUsageFingerprints(params: {
  orgId: string;
  deviceId: string;
  rows: DeviceUsageFingerprintRow[];
}): Promise<number> {
  const rows = collapseDeviceUsageFingerprints(params.rows);
  if (!rows.length) return 0;

  let upserted = 0;
  for (const batch of chunkRows(rows, BULK_CHUNK)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        ${newFingerprintId()},
        ${params.orgId},
        ${params.deviceId},
        ${row.partitionKey},
        ${row.contentHash},
        ${row.date}::date,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )`,
    );

    await prisma.$executeRaw`
      INSERT INTO device_usage_fingerprints (
        id, org_id, device_id, partition_key, content_hash, date, updated_at, created_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (device_id, partition_key) DO UPDATE SET
        content_hash = EXCLUDED.content_hash,
        date = EXCLUDED.date,
        updated_at = CURRENT_TIMESTAMP
    `;
    upserted += batch.length;
  }
  return upserted;
}
