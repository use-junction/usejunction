CREATE TABLE "github_repository_accesses" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "repository_id" TEXT NOT NULL,
  "sync_status" TEXT NOT NULL DEFAULT 'pending',
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_attempt_at" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "last_error" TEXT,
  CONSTRAINT "github_repository_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "github_repository_accesses_connection_id_repository_id_key" ON "github_repository_accesses"("connection_id", "repository_id");
CREATE INDEX "github_repository_accesses_org_id_repository_id_idx" ON "github_repository_accesses"("org_id", "repository_id");
ALTER TABLE "github_repository_accesses" ADD CONSTRAINT "github_repository_accesses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_repository_accesses" ADD CONSTRAINT "github_repository_accesses_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_repository_accesses" ADD CONSTRAINT "github_repository_accesses_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_tool_connections" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_workspace_id" TEXT NOT NULL,
  "external_workspace_name" TEXT NOT NULL,
  "access_token_ciphertext" TEXT NOT NULL,
  "refresh_token_ciphertext" TEXT NOT NULL,
  "access_token_expires_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'connected',
  "last_synced_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_tool_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_tool_connections_org_id_provider_key" ON "project_tool_connections"("org_id", "provider");
ALTER TABLE "project_tool_connections" ADD CONSTRAINT "project_tool_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_issues" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "url" TEXT,
  "issue_updated_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_issues_connection_id_external_id_key" ON "project_issues"("connection_id", "external_id");
CREATE INDEX "project_issues_org_id_identifier_idx" ON "project_issues"("org_id", "identifier");
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_issues" ADD CONSTRAINT "project_issues_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "project_tool_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feature_cost_allocations" ADD COLUMN "ticket_key_source" TEXT;
