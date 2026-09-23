-- Every provider is opt-in. Existing usage rows stay.
-- Skip a row once someone has used the collection switches.

UPDATE "tool_accounts"
SET "usage_enabled" = false, "logging_enabled" = false
WHERE "usage_admin_locked" = false
  AND "logging_admin_locked" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "account_collection_events" AS "event"
    WHERE "event"."device_id" = "tool_accounts"."device_id"
      AND "event"."tool_name" = "tool_accounts"."tool_name"
      AND "event"."account_key" = "tool_accounts"."account_key"
  );
