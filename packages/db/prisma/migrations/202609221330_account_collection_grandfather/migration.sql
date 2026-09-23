-- Repair: if 202609221200 had already run with Cursor/ChatGPT left off, turn
-- those rows back on unless someone has already used the new switches.

UPDATE "tool_accounts"
SET "usage_enabled" = true, "logging_enabled" = true
WHERE "tool_name" IN ('cursor', 'codex')
  AND "usage_enabled" = false
  AND "logging_enabled" = false
  AND "usage_admin_locked" = false
  AND "logging_admin_locked" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "account_collection_events" AS "event"
    WHERE "event"."device_id" = "tool_accounts"."device_id"
      AND "event"."tool_name" = "tool_accounts"."tool_name"
      AND "event"."account_key" = "tool_accounts"."account_key"
  );
