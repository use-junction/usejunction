# Testing

The admin app uses Vitest for fast unit/component tests and Playwright Chromium for browser workflows.

## Run the full CI suite locally

**One command** (prod build + all tests + E2E):

```sh
pnpm verify:e2e
```

Same as `./scripts/verify-work.sh --e2e`. Without E2E (no Postgres): `pnpm verify`.

GitHub Actions runs three jobs in [`.github/workflows/admin-tests.yml`](../.github/workflows/admin-tests.yml). The script above mirrors those gates plus the Go agent tests and production build. To run steps manually:

### Prerequisites

1. **PostgreSQL 16** (integration + E2E need a real database) on `localhost:5432`:

```sh
createdb usejunction
```

2. **Root `.env`** (monorepo root, not `apps/admin/.env`) with at least:

```sh
DATABASE_URL=postgresql://localhost:5432/usejunction
NEXTAUTH_SECRET=ci-test-secret
AUTH_TRUST_HOST=true
```

3. **One-time setup** from the repo root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @usejunction/db generate
pnpm --filter @usejunction/db exec prisma migrate deploy
pnpm --filter @usejunction/admin exec playwright install --with-deps chromium
```

### CI-equivalent commands

Run from the **repo root**. Export the same env vars CI uses for database-backed jobs:

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/usejunction
export NEXTAUTH_SECRET=ci-test-secret
export AUTH_TRUST_HOST=true
export RUN_AGENT_UPDATE_DB_TESTS=1
export E2E_OWNER_EMAIL=owner@example.com
export E2E_OWNER_PASSWORD=e2e-password
export RUN_CALC_VERIFICATION_TESTS=1
```

Then run each job in order:

```sh
# Job 1 — fast: type-check + unit/component/coverage
pnpm --filter @usejunction/admin exec tsc --noEmit --incremental false
pnpm --filter @usejunction/admin test:coverage

# Job 2 — integration (PostgreSQL)
pnpm --filter @usejunction/admin test:integration

# Production build (not a separate CI job, but run before shipping)
pnpm --filter @usejunction/admin build

# Job 3 — E2E + calculation verification
pnpm --filter @usejunction/admin e2e:seed
pnpm --filter @usejunction/admin verify:calcs
pnpm --filter @usejunction/admin exec vitest run tests/calculation-verification.integration.test.ts
pnpm --filter @usejunction/admin test:e2e
```

There is no single `pnpm` script that runs all of the above; the block mirrors CI exactly.

### Shorter commands

| Goal | Command |
|------|---------|
| Prod build only | `pnpm --filter @usejunction/admin build` |
| All Vitest (no E2E) | `pnpm --filter @usejunction/admin test` |
| E2E only (after seed) | `pnpm --filter @usejunction/admin e2e:seed && pnpm --filter @usejunction/admin test:e2e` |
| Root shortcuts | `pnpm test`, `pnpm test:coverage`, `pnpm test:e2e` |

### E2E time pinning (`E2E_AS_OF`)

The golden fixture in `apps/admin/e2e/seed.ts` uses fixed dates in **July 2026**. Dashboard and activity loaders resolve billing cycles and rolling windows against “now”. Without pinning, tests fail once the real calendar moves past that fixture (e.g. August current cycle is empty).

Playwright sets this automatically for the dev server it starts:

```sh
E2E_AS_OF=2026-07-16T12:00:00.000Z
```

(`apps/admin/playwright.config.ts` → `webServer.env`). You do **not** need to set it manually for `pnpm test:e2e`. Override only when debugging a different as-of instant:

```sh
E2E_AS_OF=2026-07-16T12:00:00.000Z pnpm --filter @usejunction/admin test:e2e
```

Implementation: `apps/admin/lib/report-now.ts` (`reportNow()`). Production ignores `E2E_AS_OF` and uses the real clock.

### Debugging failures

| Symptom | Likely fix |
|---------|------------|
| `e2e:seed` / `verify:calcs` connection errors | Check `DATABASE_URL` in root `.env` |
| `verify:calcs` KPI mismatches | Re-run `e2e:seed` (fixture was reset or dates drifted) |
| Playwright browser missing | `pnpm --filter @usejunction/admin exec playwright install --with-deps chromium` |
| Port 3001 in use | Stop other dev servers; Playwright starts its own on 3001 |
| Empty dashboard in E2E | Confirm `E2E_AS_OF` is set (Playwright config default) |

**Single spec, headed:**

```sh
cd apps/admin
pnpm exec playwright test e2e/developer.spec.ts --headed
```

**Failed trace:**

```sh
cd apps/admin
pnpm exec playwright show-trace test-results/<folder>/trace.zip
```

---

## Vitest

```sh
pnpm test
pnpm --filter @usejunction/admin test:unit
pnpm --filter @usejunction/admin test:component
pnpm --filter @usejunction/admin test:integration
pnpm test:coverage
```

Component tests use React Testing Library with `happy-dom`. Tests that render React components should include the `happy-dom` environment marker and import `tests/setup/component` so DOM cleanup, `jest-dom`, router-safe browser APIs, and chart observers are installed.

## Playwright (browser E2E)

For browser tests, prepare the database with the deterministic fixture and run Chromium:

```sh
pnpm --filter @usejunction/admin e2e:seed
pnpm --filter @usejunction/admin exec playwright install chromium
pnpm test:e2e
```

The seed uses `owner@example.com` / `e2e-password` by default. Override `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD`, `E2E_DEVELOPER_EMAIL`, or `E2E_ORG_SLUG` when needed. Authentication state, reports, traces, screenshots, and videos are ignored by Git.

Playwright validates the authenticated workspace pages, route variants, filters, tabs, seeded calculation output, and browser errors.

## Calculation verification (golden / reconciliation)

Separate from unit and browser tests: page query outputs are reconciled against an independent recompute from raw `usage_daily` rows. This is a **correctness verification suite**, not a performance benchmark.

```sh
# Deterministic e2e fixture (root .env)
pnpm --filter @usejunction/admin e2e:seed
pnpm --filter @usejunction/admin verify:calcs

# Real local org + ~/.usejunction agent cache (apps/admin/.env)
pnpm --filter @usejunction/admin verify:calcs:local
```

Full contract, surfaces, views, pass criteria, and triage: [Calculation verification suite](calculation-verification.md). Page/metric map: [Calculation inventory](calculation-inventory.md).

CI runs `verify:calcs` and `tests/calculation-verification.integration.test.ts` in the GitHub Actions `e2e` job after `e2e:seed` (see [calculation-verification.md](calculation-verification.md#ci-github-actions)).

## Load / bench (manual)

Opt-in snapshot pipeline load test (100-device staggered sync, dirty-marker backlog). **Not run in CI.** See [apps/admin/bench/snapshot-load/README.md](../apps/admin/bench/snapshot-load/README.md).

## Daily report cron (local)

Manual trigger and troubleshooting (`due: 0`, Resend, idempotency): [daily-reports.md](./daily-reports.md#run-the-report-job-locally).

Coverage is reported for the broader billing, metrics, quota, Signals, and period-preference surfaces. The 90% statements/lines/functions and 85% branch gates are applied per file to the calculation modules listed in `apps/admin/vitest.config.ts`; service adapters and broad UI/insight code remain report-only until they have deterministic fixtures.
