ALTER TABLE "github_project_items" ADD COLUMN IF NOT EXISTS "content_created_at" TIMESTAMP(3);
ALTER TABLE "github_project_items" ADD COLUMN IF NOT EXISTS "content_closed_at" TIMESTAMP(3);
