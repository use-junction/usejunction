-- Teams group people for rollups and filters. One team per person.
CREATE TABLE IF NOT EXISTS "teams" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "teams_org_id_name_key" ON "teams"("org_id", "name");
CREATE INDEX IF NOT EXISTS "teams_org_id_idx" ON "teams"("org_id");

ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_org_id_fkey";
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team_id" TEXT;
CREATE INDEX IF NOT EXISTS "users_org_id_team_id_idx" ON "users"("org_id", "team_id");

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_team_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
