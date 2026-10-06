CREATE INDEX "git_commits_repository_id_authored_at_idx" ON "git_commits"("repository_id", "authored_at");
CREATE INDEX "git_commits_pull_request_id_authored_at_idx" ON "git_commits"("pull_request_id", "authored_at");
CREATE INDEX "feature_cost_allocations_org_id_repository_id_date_idx" ON "feature_cost_allocations"("org_id", "repository_id", "date");
