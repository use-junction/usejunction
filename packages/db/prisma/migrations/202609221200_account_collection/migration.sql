-- Per-account collection opt-in for Cursor and ChatGPT/Codex.

ALTER TABLE "tool_accounts"
  ADD COLUMN IF NOT EXISTS "account_key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tool_accounts"
  ADD COLUMN IF NOT EXISTS "usage_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tool_accounts"
  ADD COLUMN IF NOT EXISTS "logging_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tool_accounts"
  ADD COLUMN IF NOT EXISTS "usage_admin_locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tool_accounts"
  ADD COLUMN IF NOT EXISTS "logging_admin_locked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tool_accounts"
SET "account_key" = LOWER(TRIM("email"))
WHERE "account_key" = '' AND "email" IS NOT NULL AND TRIM("email") <> '';

UPDATE "tool_accounts"
SET "usage_enabled" = true, "logging_enabled" = true
WHERE "tool_name" NOT IN ('cursor', 'codex');

ALTER TABLE "tool_accounts"
  DROP CONSTRAINT IF EXISTS "tool_accounts_device_id_tool_name_key";
DROP INDEX IF EXISTS "tool_accounts_device_id_tool_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tool_accounts_device_id_tool_name_account_key_key"
  ON "tool_accounts"("device_id", "tool_name", "account_key");
CREATE INDEX IF NOT EXISTS "tool_accounts_org_id_tool_name_email_idx"
  ON "tool_accounts"("org_id", "tool_name", "email");

CREATE TABLE IF NOT EXISTS "account_collection_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "tool_account_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "account_key" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "actor" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_collection_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_collection_events_org_id_created_at_idx"
  ON "account_collection_events"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "account_collection_events_device_tool_account_created_idx"
  ON "account_collection_events"("device_id", "tool_name", "account_key", "created_at");

ALTER TABLE "account_collection_events"
  DROP CONSTRAINT IF EXISTS "account_collection_events_org_id_fkey";
ALTER TABLE "account_collection_events"
  ADD CONSTRAINT "account_collection_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_collection_events"
  DROP CONSTRAINT IF EXISTS "account_collection_events_device_id_fkey";
ALTER TABLE "account_collection_events"
  ADD CONSTRAINT "account_collection_events_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_collection_events"
  DROP CONSTRAINT IF EXISTS "account_collection_events_tool_account_id_fkey";
ALTER TABLE "account_collection_events"
  ADD CONSTRAINT "account_collection_events_tool_account_id_fkey"
  FOREIGN KEY ("tool_account_id") REFERENCES "tool_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
