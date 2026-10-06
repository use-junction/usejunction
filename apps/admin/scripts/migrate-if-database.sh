#!/usr/bin/env bash
# Apply Prisma migrations during a Vercel build when DATABASE_URL is present.
# Preview/PR builds without a database skip this step.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Skipping prisma migrate deploy (DATABASE_URL is unset)"
  exit 0
fi

pnpm --filter @usejunction/db exec prisma migrate deploy
