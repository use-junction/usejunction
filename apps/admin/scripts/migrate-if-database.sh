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
echo "Running prisma migrate deploy"
DATABASE_URL="$migrate_url" pnpm --filter @usejunction/db exec prisma migrate deploy
