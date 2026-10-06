-- Per-account usage, work sessions, quotas, and org snapshots.
-- Existing rows keep account_key = '' (legacy unscoped history). New writes
-- use a non-empty key so they do not update those rows.

ALTER TABLE "usage_daily"
  ADD COLUMN IF NOT EXISTS "account_key" TEXT NOT NULL DEFAULT '';

ALTER TABLE "local_work_sessions"
  ADD COLUMN IF NOT EXISTS "account_key" TEXT NOT NULL DEFAULT '';

ALTER TABLE "quota_snapshots"
  ADD COLUMN IF NOT EXISTS "account_key" TEXT NOT NULL DEFAULT '';

ALTER TABLE "quota_observations"
  ADD COLUMN IF NOT EXISTS "account_key" TEXT NOT NULL DEFAULT '';

ALTER TABLE "org_usage_day_snapshots"
  ADD COLUMN IF NOT EXISTS "account_key" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "local_work_sessions_device_id_local_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "local_work_sessions_device_id_local_id_account_key_key"
  ON "local_work_sessions"("device_id", "local_id", "account_key");

DROP INDEX IF EXISTS "quota_observations_device_tool_window_reset_bucket_key";
CREATE UNIQUE INDEX IF NOT EXISTS "quota_observations_device_tool_account_window_reset_bucket_key"
  ON "quota_observations"("device_id", "tool_name", "account_key", "window_type", "reset_at", "sample_bucket");

DROP INDEX IF EXISTS "org_usage_day_snapshots_org_id_date_tool_name_developer_id_model_name_metric_version_key";
CREATE UNIQUE INDEX IF NOT EXISTS "org_usage_day_snapshots_org_date_tool_dev_model_account_metric_key"
  ON "org_usage_day_snapshots"("org_id", "date", "tool_name", "developer_id", "model_name", "account_key", "metric_version");

CREATE INDEX IF NOT EXISTS "quota_snapshots_device_tool_account_window_idx"
  ON "quota_snapshots"("device_id", "tool_name", "account_key", "window_type");
