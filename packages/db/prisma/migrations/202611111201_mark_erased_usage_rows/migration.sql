-- Snapshots now require a sync run behind each device usage row. Privacy erasure
-- deletes a person's devices (and with them their sync runs) but keeps their
-- usage rows so org totals stay whole; it now marks those rows with erasedAt.
-- Mark rows erased before that change. Every row the agent uploads carries
-- metadata.originalSource, so a device row with no developer, no device and
-- empty metadata can only be an erased one.
UPDATE "usage_daily"
SET "metadata" = jsonb_build_object('erasedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE "source" IN ('device_observed', 'local_scan', 'cursor_local', 'antigravity_local', 'antigravity_usage', 'opencode_local', 'opencode_usage', 'cursor_plan_percent')
  AND "developer_id" IS NULL
  AND "device_id" IS NULL
  AND ("metadata" IS NULL OR "metadata" = '{}'::jsonb);
