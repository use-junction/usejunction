CREATE TABLE "github_projects" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "sync_status" TEXT NOT NULL DEFAULT 'pending',
  "last_attempt_at" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "github_projects_connection_id_external_id_key" ON "github_projects"("connection_id", "external_id");
CREATE INDEX "github_projects_org_id_connection_id_idx" ON "github_projects"("org_id", "connection_id");
ALTER TABLE "github_projects" ADD CONSTRAINT "github_projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_projects" ADD CONSTRAINT "github_projects_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "github_project_items" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "external_item_id" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "repository_id" TEXT NOT NULL,
  "repository_full_name" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT,
  "status_source" TEXT,
  "url" TEXT NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "github_project_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "github_project_items_project_id_external_item_id_key" ON "github_project_items"("project_id", "external_item_id");
CREATE INDEX "github_project_items_org_id_repository_id_content_type_number_idx" ON "github_project_items"("org_id", "repository_id", "content_type", "number");
CREATE INDEX "github_project_items_org_id_repository_id_content_id_idx" ON "github_project_items"("org_id", "repository_id", "content_id");
ALTER TABLE "github_project_items" ADD CONSTRAINT "github_project_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_project_items" ADD CONSTRAINT "github_project_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "github_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_project_items" ADD CONSTRAINT "github_project_items_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
