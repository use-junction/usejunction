#!/usr/bin/env bash
# Run the same verification gates as CI before pushing or tagging a release.
# Usage:
#   ./scripts/verify-work.sh           # agent + admin fast + integration
#   ./scripts/verify-work.sh --e2e     # also run Playwright e2e (needs Postgres + .env)
#   ./scripts/verify-work.sh --quick   # skip integration (no Postgres required)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_E2E=0
RUN_INTEGRATION=1

for arg in "$@"; do
  case "$arg" in
    --e2e) RUN_E2E=1 ;;
    --quick) RUN_INTEGRATION=0 ;;
    -h|--help)
      sed -n '2,6p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

step() {
  printf '\n==> %s\n' "$1"
}

step "Agent tests (go test ./...)"
(
  cd "$ROOT/agent"
  go test ./...
)

step "Admin type-check"
(
  cd "$ROOT"
  pnpm --filter @usejunction/db generate
  pnpm --filter @usejunction/admin exec tsc --noEmit --incremental false
)

step "Admin unit tests with coverage"
(
  cd "$ROOT"
  pnpm --filter @usejunction/admin test:coverage
)

step "Production build (Vercel-equivalent)"
(
  cd "$ROOT"
  pnpm build
)

if [[ "$RUN_INTEGRATION" -eq 1 ]]; then
  if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "WARN: DATABASE_URL not set; skipping integration tests (use --quick to silence)" >&2
  else
    step "PostgreSQL integration tests"
    (
      cd "$ROOT"
      export RUN_AGENT_UPDATE_DB_TESTS=1
      pnpm --filter @usejunction/db exec prisma migrate deploy
      pnpm --filter @usejunction/admin test:integration
    )
  fi
fi

if [[ "$RUN_E2E" -eq 1 ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL required for e2e" >&2
    exit 1
  fi
  step "E2E seed + calculation verification + Playwright"
  (
    cd "$ROOT"
    export RUN_AGENT_UPDATE_DB_TESTS=1
    export RUN_CALC_VERIFICATION_TESTS=1
    export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-ci-test-secret}"
    export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"
    export E2E_OWNER_EMAIL="${E2E_OWNER_EMAIL:-owner@example.com}"
    export E2E_OWNER_PASSWORD="${E2E_OWNER_PASSWORD:-e2e-password}"
    pnpm --filter @usejunction/db exec prisma migrate deploy
    pnpm --filter @usejunction/admin e2e:seed
    pnpm --filter @usejunction/admin verify:calcs
    pnpm --filter @usejunction/admin exec vitest run tests/calculation-verification.integration.test.ts
    pnpm --filter @usejunction/admin exec playwright install chromium
    echo "==> Playwright e2e (us)"
    E2E_FORCE_WEB_SERVER=1 DEPLOYMENT_REGION=us NEXT_PUBLIC_DEPLOYMENT_REGION=us \
      NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED=false \
      pnpm --filter @usejunction/admin test:e2e
    echo "==> Playwright e2e (eu)"
    DEPLOYMENT_REGION=eu NEXT_PUBLIC_DEPLOYMENT_REGION=eu \
      pnpm --filter @usejunction/admin e2e:seed
    E2E_FORCE_WEB_SERVER=1 DEPLOYMENT_REGION=eu NEXT_PUBLIC_DEPLOYMENT_REGION=eu \
      NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED=false \
      pnpm --filter @usejunction/admin test:e2e
  )
fi

step "All selected verification checks passed"
