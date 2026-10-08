-- Terms are accepted at signup now; existing accounts are treated as having agreed
-- to the current Terms and Privacy Policy.

-- Keep the pre-backfill values so no acceptance history is lost and the update can
-- be reverted from this table if needed.
CREATE TABLE IF NOT EXISTS "legal_acceptance_backfill_backup" (
  "user_id" TEXT NOT NULL,
  "terms_accepted_at" TIMESTAMP(3),
  "terms_version" TEXT,
  "privacy_version" TEXT,
  "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_acceptance_backfill_backup_pkey" PRIMARY KEY ("user_id")
);

INSERT INTO "legal_acceptance_backfill_backup" ("user_id", "terms_accepted_at", "terms_version", "privacy_version")
SELECT "id", "terms_accepted_at", "terms_version", "privacy_version"
FROM "auth_users"
WHERE "terms_accepted_at" IS NULL
   OR "terms_version" IS DISTINCT FROM '2026-09-18'
   OR "privacy_version" IS DISTINCT FROM '2026-09-18'
ON CONFLICT ("user_id") DO NOTHING;

UPDATE "auth_users"
SET "terms_accepted_at" = COALESCE("terms_accepted_at", NOW()),
    "terms_version" = '2026-09-18',
    "privacy_version" = '2026-09-18'
WHERE "terms_accepted_at" IS NULL
   OR "terms_version" IS DISTINCT FROM '2026-09-18'
   OR "privacy_version" IS DISTINCT FROM '2026-09-18';
