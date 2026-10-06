-- Feature cost: GitHub pull requests, commits, and allocated usage.

CREATE TABLE IF NOT EXISTS "git_pull_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "head_ref_name" TEXT,
    "base_ref_name" TEXT,
    "author_login" TEXT,
    "author_developer_id" TEXT,
    "url" TEXT,
    "github_created_at" TIMESTAMP(3) NOT NULL,
    "merged_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changed_files" INTEGER NOT NULL DEFAULT 0,
    "ticket_keys" JSONB NOT NULL DEFAULT '[]',
    "closing_issues" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "git_pull_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "git_pull_requests_repository_id_number_key" ON "git_pull_requests"("repository_id", "number");
CREATE INDEX IF NOT EXISTS "git_pull_requests_org_id_author_developer_id_merged_at_idx" ON "git_pull_requests"("org_id", "author_developer_id", "merged_at");
CREATE INDEX IF NOT EXISTS "git_pull_requests_org_id_repository_id_idx" ON "git_pull_requests"("org_id", "repository_id");

ALTER TABLE "git_pull_requests"
  DROP CONSTRAINT IF EXISTS "git_pull_requests_org_id_fkey";
ALTER TABLE "git_pull_requests"
  ADD CONSTRAINT "git_pull_requests_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "git_pull_requests"
  DROP CONSTRAINT IF EXISTS "git_pull_requests_connection_id_fkey";
ALTER TABLE "git_pull_requests"
  ADD CONSTRAINT "git_pull_requests_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "git_pull_requests"
  DROP CONSTRAINT IF EXISTS "git_pull_requests_repository_id_fkey";
ALTER TABLE "git_pull_requests"
  ADD CONSTRAINT "git_pull_requests_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "git_pull_requests"
  DROP CONSTRAINT IF EXISTS "git_pull_requests_author_developer_id_fkey";
ALTER TABLE "git_pull_requests"
  ADD CONSTRAINT "git_pull_requests_author_developer_id_fkey"
  FOREIGN KEY ("author_developer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "git_commits" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "authored_at" TIMESTAMP(3) NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "author_email" TEXT,
    "author_login" TEXT,
    "author_developer_id" TEXT,
    "message_headline" TEXT NOT NULL DEFAULT '',
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "pull_request_id" TEXT,
    "is_direct_push" BOOLEAN NOT NULL DEFAULT false,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "ticket_keys" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "git_commits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "git_commits_repository_id_sha_key" ON "git_commits"("repository_id", "sha");
CREATE INDEX IF NOT EXISTS "git_commits_org_id_author_developer_id_authored_at_idx" ON "git_commits"("org_id", "author_developer_id", "authored_at");

ALTER TABLE "git_commits"
  DROP CONSTRAINT IF EXISTS "git_commits_org_id_fkey";
ALTER TABLE "git_commits"
  ADD CONSTRAINT "git_commits_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "git_commits"
  DROP CONSTRAINT IF EXISTS "git_commits_repository_id_fkey";
ALTER TABLE "git_commits"
  ADD CONSTRAINT "git_commits_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "git_commits"
  DROP CONSTRAINT IF EXISTS "git_commits_author_developer_id_fkey";
ALTER TABLE "git_commits"
  ADD CONSTRAINT "git_commits_author_developer_id_fkey"
  FOREIGN KEY ("author_developer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "git_commits"
  DROP CONSTRAINT IF EXISTS "git_commits_pull_request_id_fkey";
ALTER TABLE "git_commits"
  ADD CONSTRAINT "git_commits_pull_request_id_fkey"
  FOREIGN KEY ("pull_request_id") REFERENCES "git_pull_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "feature_cost_allocations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "developer_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "pull_request_id" TEXT,
    "commit_sha" TEXT,
    "ticket_key" TEXT,
    "cost_kind" TEXT NOT NULL,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_cost_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "feature_cost_allocations_org_id_date_idx" ON "feature_cost_allocations"("org_id", "date");
CREATE INDEX IF NOT EXISTS "feature_cost_allocations_org_id_ticket_key_idx" ON "feature_cost_allocations"("org_id", "ticket_key");
CREATE INDEX IF NOT EXISTS "feature_cost_allocations_org_id_pull_request_id_idx" ON "feature_cost_allocations"("org_id", "pull_request_id");
CREATE INDEX IF NOT EXISTS "feature_cost_allocations_org_id_developer_id_date_idx" ON "feature_cost_allocations"("org_id", "developer_id", "date");

ALTER TABLE "feature_cost_allocations"
  DROP CONSTRAINT IF EXISTS "feature_cost_allocations_org_id_fkey";
ALTER TABLE "feature_cost_allocations"
  ADD CONSTRAINT "feature_cost_allocations_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feature_cost_allocations"
  DROP CONSTRAINT IF EXISTS "feature_cost_allocations_developer_id_fkey";
ALTER TABLE "feature_cost_allocations"
  ADD CONSTRAINT "feature_cost_allocations_developer_id_fkey"
  FOREIGN KEY ("developer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feature_cost_allocations"
  DROP CONSTRAINT IF EXISTS "feature_cost_allocations_repository_id_fkey";
ALTER TABLE "feature_cost_allocations"
  ADD CONSTRAINT "feature_cost_allocations_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "feature_cost_allocations"
  DROP CONSTRAINT IF EXISTS "feature_cost_allocations_pull_request_id_fkey";
ALTER TABLE "feature_cost_allocations"
  ADD CONSTRAINT "feature_cost_allocations_pull_request_id_fkey"
  FOREIGN KEY ("pull_request_id") REFERENCES "git_pull_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
