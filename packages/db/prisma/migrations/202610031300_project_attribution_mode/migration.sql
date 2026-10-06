ALTER TABLE "github_projects" ADD COLUMN IF NOT EXISTS "attribution_mode" TEXT NOT NULL DEFAULT 'wi_order';
