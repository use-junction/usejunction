-- Restore opt-in for Cursor and ChatGPT. Do not delete stored usage or sessions.
-- Leaves a row alone if someone already used the collection switches.

UPDATE "tool_accounts"
SET "usage_enabled" = false, "logging_enabled" = false
WHERE "tool_name" IN ('cursor', 'codex')
  AND "usage_admin_locked" = false
  AND "logging_admin_locked" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "account_collection_events" AS "event"
    WHERE "event"."device_id" = "tool_accounts"."device_id"
      AND "event"."tool_name" = "tool_accounts"."tool_name"
      AND "event"."account_key" = "tool_accounts"."account_key"
  );
