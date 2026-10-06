-- GDPR foundations: region, retention, legal acceptance, collection notice, privacy requests.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "data_region" TEXT NOT NULL DEFAULT 'us',
  ADD COLUMN IF NOT EXISTS "usage_retention_days" INTEGER NOT NULL DEFAULT 365;

ALTER TABLE "auth_users"
  ADD COLUMN IF NOT EXISTS "terms_accepted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terms_version" TEXT,
  ADD COLUMN IF NOT EXISTS "privacy_version" TEXT;

ALTER TABLE "organization_memberships"
  ADD COLUMN IF NOT EXISTS "collection_notice_ack_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "collection_notice_version" TEXT;

ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "collection_notice_ack_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "collection_notice_version" TEXT;

CREATE TABLE IF NOT EXISTS "privacy_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "subject_developer_id" TEXT,
    "subject_user_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by_user_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "artifact_path" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "privacy_requests_org_id_status_idx" ON "privacy_requests"("org_id", "status");
CREATE INDEX IF NOT EXISTS "privacy_requests_org_id_subject_developer_id_idx" ON "privacy_requests"("org_id", "subject_developer_id");
CREATE INDEX IF NOT EXISTS "privacy_requests_status_scheduled_for_idx" ON "privacy_requests"("status", "scheduled_for");

ALTER TABLE "privacy_requests"
  DROP CONSTRAINT IF EXISTS "privacy_requests_org_id_fkey";
ALTER TABLE "privacy_requests"
  ADD CONSTRAINT "privacy_requests_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "privacy_requests"
  DROP CONSTRAINT IF EXISTS "privacy_requests_subject_developer_id_fkey";
ALTER TABLE "privacy_requests"
  ADD CONSTRAINT "privacy_requests_subject_developer_id_fkey"
  FOREIGN KEY ("subject_developer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
