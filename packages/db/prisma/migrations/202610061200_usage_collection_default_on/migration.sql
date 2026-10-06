-- Usage collection is on unless someone has already turned that login off.
-- Activity logging stays opt-in.

ALTER TABLE "tool_accounts" ALTER COLUMN "usage_enabled" SET DEFAULT true;

UPDATE "tool_accounts"
SET "usage_enabled" = true
WHERE "usage_admin_locked" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "account_collection_events" AS "event"
    WHERE "event"."device_id" = "tool_accounts"."device_id"
      AND "event"."tool_name" = "tool_accounts"."tool_name"
      AND "event"."account_key" = "tool_accounts"."account_key"
      AND "event"."stream" = 'usage'
  );
