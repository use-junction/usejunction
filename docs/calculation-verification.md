# Calculation verification suite

This document describes how UseJunction **verifies calculation correctness** across workspace pages and views.

These are **not performance benchmarks** and not comparative leaderboard scores. They are a **golden verification / reconciliation suite**: given known data, do page KPIs match the accounting rules?

Related docs:

- [Calculation inventory](calculation-inventory.md) — what each page displays and which modules compute it
- [Usage accounting contract](usage-accounting.md) — requests, tokens, cost kinds, sources
- [Central analytics engine](central-analytics-engine.md) — SQL selection / aggregation runtime
- [Subscription cycle utilization](subscription-cycle-utilization.md) — cycle windows and commitment
- [Testing](testing.md) — Vitest / Playwright entry points

## Terminology

| Term | Meaning here |
|---|---|
| **Verification run** | Execute page query functions + independently recompute expected values from raw rows; compare |
| **Golden fixture** | Deterministic seeded org (`e2e-calculation-fixture`) with fixed dates and known expected KPIs |
| **Reconciliation** | Page A and page B (or page vs raw data / agent cache) must agree within tolerance |
| **Baseline / snapshot** | Captured numbers from a verification run used to catch regressions |
| **Benchmark** | **Do not use** for this suite — implies perf or external comparative scoring |

## What the suite proves

For each exercised **surface × view**:

1. **Page query output** matches an **independent recompute** from `usage_daily` using the same source-priority and cost-kind rules as the analytics SQL.
2. **Cross-page consistency** — e.g. dashboard verified/estimated equals activity verified/estimated for the same window.
3. **Commitment math** — seat capacity × cycle price, with multi-cycle overlap proration on rolling windows.
4. **Scope rules** — org-wide vs tool-scoped (`/tools/cursor`) vs developer-scoped (member / personal).
5. On a real machine: **agent cache** (`~/.usejunction`) reconciles with the member’s verified Cursor usage.

It does **not** prove UI chrome, Playwright-only navigation, or gateway ingest performance.

## Two tracks

### Track A — Golden fixture (deterministic)

| | |
|---|---|
| **Org** | `e2e-calculation-fixture` (“Calculation E2E”) |
| **Seed** | `apps/admin/e2e/seed.ts` |
| **asOf** | Pinned `2026-07-16T12:00:00.000Z` |
| **DB** | Usually root `.env` → `localhost:5432` |
| **Script** | `apps/admin/scripts/verify-calculation-run.ts` (CLI) / `apps/admin/scripts/lib/run-calculation-verification.ts` (library) |
| **Purpose** | CI-friendly correctness; fixed expected dollars/calls |

Seed highlights (Cursor-centric story used by Playwright too):

| Seed row | Date | Activity? | Cost |
|---|---|---|---|
| cursor `vendor_verified` | 2026-07-10 | 10 calls, 1.5M tokens | verified **$5** |
| cursor `estimated` | 2026-07-11 | requests **excluded** | estimated **$1** |
| openai / anthropic / gateway | Jul 12–16 | org-wide extras | verified + estimated |
| opencode `device_observed` usage | 2026-07-14 | **28** calls (free/detected — still counts) | actual_spend |
| opencode productivity | 2026-07-14 | lines only — requests **excluded** from modelCalls | — |

Fixed expectations (current cycles, Cursor tool line):

- Subscription commitment: **$40** (2 seats × $20)
- Cursor verified **$5**, estimated **$1**, model calls **10**
- Org-wide modelCalls: **78** (10+25+12+3+28; excludes synthetic estimated and productivity)
- Developer current-cycle requests: **66** (10+25+3+28; excludes synthetic estimated and productivity)

### Track B — Local machine data (real org)

| | |
|---|---|
| **Org** | From `~/.usejunction/config.json` → `orgId` (e.g. Junction) |
| **asOf** | Wall-clock `new Date()` |
| **DB** | `apps/admin/.env` → often `localhost:5432` (dev Postgres.app) |
| **Agent cache** | `~/.usejunction/cache/` |
| **Script** | `apps/admin/scripts/verify-local-data-run.ts` |
| **Purpose** | Catch env-specific drift; reconcile device cache vs control plane |

Important: root `.env` and `apps/admin/.env` can point at **different databases**. Local verification must use the admin env that the running app and agent actually use.

## Surfaces and views

### Views (every track)

| View label | `cycleView` | Window rule |
|---|---|---|
| `current_cycles` | `current_cycles` | Union of active coding-plan billing cycles at `now` |
| `previous_cycles` | `previous_cycles` | Previous cycle offset (−1) per plan |
| `last_30_days` | `last_30_days` | Rolling 30 UTC days ending today |
| `last_14_days` | `last_30_days` + `days=14` | Rolling 14 days |
| `last_7_days` | `last_30_days` + `days=7` | Rolling 7 days |
| custom bounds (fixture track) | `last_30_days` + `from`/`to` | Explicit UTC date range |

Rolling commitment is **not** `windowDays/cycleDays × price` alone. It sums **overlap slices** across every billing cycle that intersects the report window (e.g. last 30 days can touch Jun + Jul cycles).

### Surfaces checked

| Surface | Server entrypoints |
|---|---|
| `/dashboard` (admin overview) | `getOrgOverview` |
| `/activity` | `getDashboardUsage` |
| `/tools` subscriptions | `listSubscriptions` |
| `/tools` detected activity | `getDashboardTools` |
| `/tools/[toolKey]` | `getToolDetail` |
| `/team` | `getDeveloperRoster`, `getPlanUsage` |
| `/team/[developerId]` | `getDeveloperOverview` |
| Personal `/dashboard`, `/activity` | `getMeOverview` (fixture track) |
| `/signals`, `/signals/activity` | `getWorkOverview`, `getWorkActivity` |
| Agent cache (local track) | `~/.usejunction/cache/cursor-usage-events.json` vs member verified |

Playwright (`apps/admin/e2e/workspace.spec.ts`, `developer.spec.ts`) asserts a subset of golden numbers in the browser; the scripts above are the fuller reconciliation layer.

## Independent recompute rules

The verifier mirrors `apps/admin/lib/analytics/query/sql.ts` (see also [usage-accounting.md](usage-accounting.md)):

### Activity (model calls / tokens)

- Partition: `(date, developer_id, provider, product, tool_name, model)`
- **Include free / detected tool usage** (`device_observed`, OpenCode, etc.) — $0 spend does not remove model calls from KPIs
- Exclude `metric_kind = productivity` and `cursor_local` / `opencode_local` / productivity-classified rows (lines/commits are not model calls)
- Exclude synthetic `estimated` source from observed activity
- Among remaining rows, keep those at the **best activity priority**; **sum** all ties
- Tokens for UI totals: **input + output** (cache/reasoning separate)

### Cost (verified / estimated)

- Partition: `(date, provider)` for priority
- Among rows with `cost_micros > 0`, keep those at the **best cost priority**; **sum all winners** (multiple models on one day all count)
- Classify via `cost_kind` / `costKindForRow` into `verified_usage` | `estimated_api` | `actual_spend`

### Commitment

- Coding subscriptions only (same filter as overview)
- Current/previous: `cycleSeatMicros × seatCapacity` (full cycle)
- Rolling: for each intersecting cycle slice, `round(fullSpend × overlapDays / cycle.totalDays)` then sum

### Scope

| KPI scope | Includes |
|---|---|
| Org dashboard / activity | All tools/providers in window after selection |
| `/tools/cursor` | Cursor tool names / aliases only |
| Member / personal | Rows with that `developerId` (org-only cost rows without developer do not appear) |
| Device agent cache | This machine’s uploaded Cursor events only (subset of org) |

## How to run

### Golden fixture

```sh
# DB on :5432 (root .env), schema current
pnpm --filter @usejunction/db exec prisma migrate deploy
pnpm --filter @usejunction/admin e2e:seed

cd apps/admin
dotenv -e ../../.env -- tsx --tsconfig tsconfig.json scripts/verify-calculation-run.ts
```

Exit code `0` only if every hard check passes. JSON report:

`apps/admin/scripts/calculation-verification-report.json`

Optional package scripts:

```sh
pnpm --filter @usejunction/admin verify:calcs
```

### Local machine org

```sh
# Uses apps/admin/.env (real org DB) + ~/.usejunction/config.json
cd apps/admin
dotenv -e .env -- tsx --tsconfig tsconfig.json scripts/verify-local-data-run.ts
```

JSON report:

`apps/admin/scripts/local-data-verification-report.json`

```sh
pnpm --filter @usejunction/admin verify:calcs:local
```

### Playwright (UI smoke on golden numbers)

```sh
pnpm --filter @usejunction/admin e2e:seed
pnpm --filter @usejunction/admin test:e2e
```

### CI (GitHub Actions)

The `e2e` job in `.github/workflows/admin-tests.yml` runs after `e2e:seed`:

1. `pnpm --filter @usejunction/admin verify:calcs` — CLI reconciliation (exit 1 on failure)
2. `vitest run tests/calculation-verification.integration.test.ts` — spot-checks golden KPIs (`RUN_CALC_VERIFICATION_TESTS=1`)
3. Playwright workspace E2E

On verification failure, CI uploads `apps/admin/scripts/calculation-verification-report.json` as an artifact.

To run the **entire** admin CI pipeline locally (including type-check, coverage, integration, and prod build), see [Testing — Run the full CI suite locally](testing.md#run-the-full-ci-suite-locally).

## Pass criteria

| Check class | Pass rule |
|---|---|
| Money | Absolute difference < $0.02 after rounding to cents |
| Counts / tokens | Exact equality |
| Dates | Compare `YYYY-MM-DD` (ignore time suffix) |
| Booleans | Exact equality |
| Soft / informational | Documented separately (e.g. cache requests ≤ org requests) — must not fail the suite when intentional |

A run is green only when **failed = 0** for hard checks.

## Example baselines (for regression awareness)

Numbers below are **snapshots from verification runs**, not forever-frozen contracts. Re-seed / re-run after accounting changes. Prefer the JSON reports as the source of truth for a given machine/day.

### Golden fixture (asOf 2026-07-16) — selected

| View | Commitment | Org verified | Org estimated | Notes |
|---|---|---|---|---|
| current_cycles | $40.00 | $25.00 | $2.00 | Org modelCalls **78** (10+25+12+3+28; excludes estimated + productivity) |
| previous_cycles | $40.00 | $0 | $0 | No June usage in seed |
| last_30_days | $39.31 | $25.00 | $2.00 | Jun+Jul overlap proration on commitment |
| `/tools/cursor` (July windows) | — | usage cost **$6.00** | — | 10 calls, 1.5M tokens |
| Member `e2e-developer` | — | $5.00 | $2.00 | No orphan org cost rows |

### Local Junction org (example run, asOf 2026-07-20) — last 30 days

| Scope | Verified | Estimated | Model calls |
|---|---|---|---|
| Org dashboard / activity | $948.47 | $1,991.61 | 26,515 |
| `/tools/cursor` | $948.47 | — | 3,288 |
| Member (owner) | $524.35 | $1,140.64 | 15,388 |
| This Mac Cursor cache | $524.35 | — | 1,845 (cache subset) |

Current-cycle commitment on that run: **$80** (Cursor Pro+ $60 + Codex Plus $20).

## Failure triage

| Symptom | Likely cause |
|---|---|
| Verified/estimated mismatch, calls OK | Cost priority / `cost_kind` classification drift |
| Calls off by small constant (e.g. 3) | Productivity row `requests` counted in independent recompute — exclude `metric_kind = productivity` and `cursor_local` / `opencode_local` |
| Calls ~2× expected | Productivity / `local_scan` rows counted as activity |
| Tokens mismatch, calls OK | Input/output vs cache inclusion |
| Commitment wrong on rolling views | Missing multi-cycle overlap slices |
| Tool page ≠ org cursor | Alias / tool-name filter |
| Member ≠ org | Orphan rows without `developerId`; multi-member split |
| Cache ≠ member verified | Stale agent upload; wrong `orgId`/`userId` in config |
| Empty / only e2e org on “local” run | Wrong `DATABASE_URL` (root `.env` vs `apps/admin/.env`) |
| Roster count off | Soft-removed developers (`removed_at`) |

## Artifacts

| Path | Role |
|---|---|
| `apps/admin/e2e/seed.ts` | Golden fixture writer |
| `apps/admin/scripts/lib/run-calculation-verification.ts` | Shared verification runner (CLI + tests) |
| `apps/admin/scripts/verify-calculation-run.ts` | Golden verification CLI |
| `apps/admin/scripts/verify-local-data-run.ts` | Local org + agent cache runner |
| `apps/admin/scripts/*-verification-report.json` | Last run machine-readable output (gitignored if desired) |
| `apps/admin/tests/calculation-verification.integration.test.ts` | Vitest gate on golden KPIs (CI e2e job) |
| `apps/admin/e2e/workspace.spec.ts` | Browser assertions on seeded KPIs |
| `docs/calculation-inventory.md` | Page/calculation map |

## Extending the suite

1. Add a surface only if it exposes product metrics (see inventory).
2. Call the **same server function** the page uses — do not reimplement page loaders in the verifier.
3. Extend independent recompute only when the analytics SQL contract changes; keep it in lockstep with `sql.ts`.
4. Prefer new **hard checks** for money/counts; use soft checks for intentionally unequal scopes (device cache ⊂ org).
5. Update this doc’s baseline tables when golden seed math changes deliberately.
6. Keep Playwright assertions aligned with the golden seed story ($40 / $5 / $1 / 10) so UI and scripts do not diverge.
