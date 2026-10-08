-- A person can hold several logins for one tool (e.g. a personal Pro account and
-- a work Team account). We record each login's vendor organization id so the
-- control plane can resolve a login's plan from its org even when the plan is
-- not readable on the device that reported it.
ALTER TABLE "tool_accounts" ADD COLUMN "vendor_org_id" TEXT;

CREATE INDEX "tool_accounts_org_id_tool_name_vendor_org_id_idx"
  ON "tool_accounts" ("org_id", "tool_name", "vendor_org_id");
