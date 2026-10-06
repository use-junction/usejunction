-- Allow several GitHub App installations per workspace. Other providers
-- still have one row per (org, provider, product).
DROP INDEX IF EXISTS "provider_connections_org_id_provider_product_key";

CREATE UNIQUE INDEX "provider_connections_non_github_org_provider_product_key"
  ON "provider_connections"("org_id", "provider", "product")
  WHERE "provider" <> 'github';

CREATE UNIQUE INDEX "provider_connections_github_org_account_key"
  ON "provider_connections"("org_id", "external_org_id")
  WHERE "provider" = 'github' AND "external_org_id" IS NOT NULL;

CREATE INDEX "provider_connections_org_id_provider_product_idx"
  ON "provider_connections"("org_id", "provider", "product");

CREATE INDEX "provider_connections_org_id_provider_external_org_id_idx"
  ON "provider_connections"("org_id", "provider", "external_org_id");

-- Keep GitHub author matches when one of several connections is removed.
ALTER TABLE "external_identities" DROP CONSTRAINT IF EXISTS "external_identities_connection_id_fkey";
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
