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

# A previous production deploy left this migration failed after the FK already
# existed. Mark it applied so migrate deploy can continue; ignore if it is
# already applied or not in a failed state.
echo "Resolving enrollment_token_repair_device if it was left failed"
DATABASE_URL="$migrate_url" pnpm --filter @usejunction/db exec prisma migrate resolve --applied 202608090001_enrollment_token_repair_device \
  && echo "Marked 202608090001_enrollment_token_repair_device as applied" \
  || echo "No failed enrollment_token_repair_device migration to resolve"

echo "Running prisma migrate deploy"
DATABASE_URL="$migrate_url" pnpm --filter @usejunction/db exec prisma migrate deploy
