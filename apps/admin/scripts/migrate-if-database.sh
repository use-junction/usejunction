#!/usr/bin/env bash
# Apply Prisma migrations during a Vercel build when DATABASE_URL is present.
# Preview/PR builds without a database skip this step.
#
# Prisma migrate takes advisory locks. Supabase transaction poolers (:6543)
# never finish that handshake, so prefer DIRECT_URL or the session pooler (:5432).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Skipping prisma migrate deploy (DATABASE_URL is unset)"
  exit 0
fi

migrate_url="${DIRECT_URL:-$DATABASE_URL}"
migrate_url="${migrate_url/:6543/:5432}"

# Production was db-pushed after a failed migrate. Mark leftover migrations
# applied when their objects already exist so deploy can finish.
already_on_prod=(
  202608090001_enrollment_token_repair_device
  202609241200_work_spend
  202609241300_work_spend_query_indexes
  202609241400_github_projects
  202609251200_multi_github_connections
  202610031200_wi_item_timeline
  202610031300_project_attribution_mode
  202610061200_usage_collection_default_on
)
for migration in "${already_on_prod[@]}"; do
  echo "Resolving $migration if it was left failed or already pushed"
  DATABASE_URL="$migrate_url" pnpm --filter @usejunction/db exec prisma migrate resolve --applied "$migration" \
    && echo "Marked $migration as applied" \
    || echo "No resolve needed for $migration"
done

echo "Running prisma migrate deploy"
DATABASE_URL="$migrate_url" pnpm --filter @usejunction/db exec prisma migrate deploy
