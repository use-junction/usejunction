# Production deployment

How hosted UseJunction (`https://usejunction.dev`) is deployed and what you must configure before go-live.

To run a copy yourself (Vercel Deploy button, local Postgres, agent install), start with [Hosting](hosting.md).

## Architecture (hosted)

| Piece | How it ships |
|-------|----------------|
| Admin / control plane (`apps/admin`) | **Vercel** project `admin`, root directory `apps/admin` |
| Product database | Managed Postgres (`DATABASE_URL` on Vercel) |
| Agent binaries (OTA) | GitHub Releases + protect promote workflow — see [agent-releases.md](./agent-releases.md) |

There is **no** GitHub Actions workflow that deploys the web app. Merges to `main` (with the Vercel Git integration) deploy production. Agent updates are a separate tag → promote path.

## Vercel project settings

Confirm in the Vercel dashboard (or local `.vercel/project.json`):

- Framework: Next.js
- Root Directory: `apps/admin`
- Install Command: `cd ../.. && corepack enable && pnpm install --frozen-lockfile`
- Build: `apps/admin/vercel.json` generates Prisma, applies migrations when `DATABASE_URL` is set, enforces client/server import boundaries, runs `next build`, then asserts that application UI routes were prerendered
- Function region: `iad1`
- Git: `Dinuda/usejunction`, production branch `main`
- Domains: `usejunction.dev` (www / `.com` redirect to apex via `next.config.ts`); staging uses `staging.usejunction.dev` on the `staging` branch

## Staging

Staging lives on the **same** Vercel project (`admin`), not a second app. Push the `staging` git branch, check the deployment at `https://staging.usejunction.dev`, then use **Promote to Production** in the Vercel dashboard. That reuses the already-built deployment. Merges to `main` can still deploy production through the Git integration.

| Piece | Staging value |
|-------|----------------|
| Vercel project | `admin` (root `apps/admin`, same install and build as production) |
| Git branch | `staging` |
| Domain | `staging.usejunction.dev` assigned to the `staging` branch |
| Postgres | A **separate** managed database; never point staging at production `DATABASE_URL` |

Vercel `NODE_ENV` is `production` on this deployment, so the same required secrets as Production apply — with **different values**. Set these on the Preview environment (or a Custom Environment named Staging assigned to the `staging` branch, if the Vercel plan supports it):

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Staging Postgres (pooled, Prisma-compatible) |
| `AUTH_SECRET` | `openssl rand -base64 48` — do not copy production |
| `INGEST_SECRET` | `openssl rand -base64 48` |
| `CRON_SECRET` | `openssl rand -base64 48` |
| `AGENT_RELEASE_OPERATIONS_TOKEN` | Staging-only token |
| `ABLY_API_KEY` | Staging Ably app or key — do not copy production |
| `NEXTAUTH_URL` | `https://staging.usejunction.dev` |
| `NEXT_PUBLIC_APP_URL` | `https://staging.usejunction.dev` |
| `AUTH_TRUST_HOST` | `true` |

Copy the remaining optional Production variables (Resend, OAuth, GitHub App, Lemon) only when you need those flows on staging. Do not reuse production webhook secrets.

The next staging deploy applies schema automatically when `DATABASE_URL` is set. Do not point staging at the production database.

Vercel crons (`apps/admin/vercel.json`) and GitHub Actions (`.github/workflows/production-crons.yml`, `device-health.yml`, `provider-sync.yml`) stay **production-only**. They keep calling `https://usejunction.dev`. Do not point those jobs at staging.

Hobby Preview env vars apply to every preview deployment, including pull requests. Isolate staging with a Custom Environment on Pro, **or** scope Preview variables to the `staging` git branch (`vercel env add NAME preview staging`) so pull request previews stay untouched.

### First-time staging setup

`usejunction.dev` DNS stays at GoDaddy (`ns35.domaincontrol.com` / `ns36.domaincontrol.com`). Vercel CLI is linked to project `admin`. There is **no** staging Postgres yet — do not copy Production `DATABASE_URL`.

1. Create and push a `staging` branch from current `main` (Vercel rejects a git-branch domain until that ref exists on the connected GitHub repo):

```bash
git fetch origin
git branch staging origin/main
git push -u origin staging
```

2. Add a CNAME at GoDaddy: host `staging`, target `cname.vercel-dns.com`.

3. In the Vercel dashboard, project `admin` → Settings → Domains → add `staging.usejunction.dev` assigned to git branch `staging`.

4. Provision a **separate** Postgres database, then set branch-scoped Preview env (stdin, so values never land in the shell history file as `vercel env add` arguments):

```bash
printf '%s' 'postgresql://…staging…' | vercel env add DATABASE_URL preview staging
printf '%s' "$(openssl rand -base64 48)" | vercel env add AUTH_SECRET preview staging
printf '%s' "$(openssl rand -base64 48)" | vercel env add INGEST_SECRET preview staging
printf '%s' "$(openssl rand -base64 48)" | vercel env add CRON_SECRET preview staging
printf '%s' "$(openssl rand -base64 32)" | vercel env add AGENT_RELEASE_OPERATIONS_TOKEN preview staging
printf '%s' "$(openssl rand -base64 32)" | vercel env add INTEGRATION_ENCRYPTION_KEY preview staging
printf '%s' 'https://staging.usejunction.dev' | vercel env add NEXTAUTH_URL preview staging
printf '%s' 'https://staging.usejunction.dev' | vercel env add NEXT_PUBLIC_APP_URL preview staging
printf '%s' 'true' | vercel env add AUTH_TRUST_HOST preview staging
```

`ABLY_API_KEY` is already on Preview (shared with Production). Override it for branch `staging` when you want a separate Ably app.

5. Redeploy the `staging` branch so the build applies migrations against that database.

6. After the deployment is healthy, use **Promote to Production** on that deployment in the Vercel dashboard.

## Database migrations

Production (and any Vercel deploy with `DATABASE_URL`) runs `prisma migrate deploy` during the build via [`apps/admin/scripts/migrate-if-database.sh`](../apps/admin/scripts/migrate-if-database.sh). Preview builds without a database skip that step.

To apply SQL without a deploy:

```bash
DATABASE_URL='postgresql://…' pnpm --filter @usejunction/db exec prisma migrate deploy
```

EU is a separate database — a US production build does not migrate it. Run the command above against the EU URL, or deploy the EU project so its build migrates that database.

How to author a new SQL migration and apply it locally is in [Database migrations](database-migrations.md).

## Database connection and function region

Authenticated page models are served by `/api/app/*`, so database placement is part of the request latency budget:

- `DATABASE_URL` must be the provider's pooled, Prisma-compatible runtime URL (not a direct single-connection endpoint). Keep a direct URL only for migration tooling when the provider requires it.
- Set the Vercel Function Region to the supported region closest to the primary Postgres region. Do not choose from the visitor location alone.
- Verify a preview from that region using the `Server-Timing` response header (`session`, `membership`, `data`, and `total` where applicable) before promotion. Warm `/api/auth/session` p95 must remain below 300 ms, workspace-context below 750 ms, page-data below 1.5 seconds, and cold page-data below 3 seconds.
- Investigate measured slow SQL before adding an index. The application endpoints aggregate and parallelize independent readers first.

## Required environment variables (Vercel Production)

Set these on the `admin` project for **Production**. Build/runtime fail closed without the secrets marked required.

### Core (required)

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Production Postgres connection string |
| `AUTH_SECRET` | `openssl rand -base64 48` |
| `INGEST_SECRET` | `openssl rand -base64 48` |
| `CRON_SECRET` | `openssl rand -base64 48` |
| `AGENT_RELEASE_OPERATIONS_TOKEN` | `openssl rand -base64 32` — **same value** as GitHub `agent-production` |
| `ABLY_API_KEY` | Ably API key for instant fleet sync push (`ably-key:…` from the Ably dashboard) |
| `INTEGRATION_ENCRYPTION_KEY` | `openssl rand -base64 32` (must decode to 32 bytes) |
| `NEXTAUTH_URL` | `https://usejunction.dev` |
| `NEXT_PUBLIC_APP_URL` | `https://usejunction.dev` |
| `AUTH_TRUST_HOST` | `true` |
| `USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT` | omit or `false` |

### Auth email (required for invites / reset / magic links)

| Variable | Notes |
|----------|--------|
| `RESEND_API_KEY` | Resend API key |
| `AUTH_EMAIL_FROM` | Verified sender for auth flows, e.g. `UseJunction <auth@usejunction.dev>` |
| `INVITE_EMAIL_FROM` | Verified sender for team/workspace invites, e.g. `UseJunction <invites@usejunction.dev>` |

### OAuth (optional)

Enable matching `NEXT_PUBLIC_*_AUTH_ENABLED=true` only when credentials are set:

- GitHub: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `NEXT_PUBLIC_GITHUB_AUTH_ENABLED`
- Google: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`
- Microsoft: `AUTH_MICROSOFT_ENTRA_ID_*`, `NEXT_PUBLIC_MICROSOFT_AUTH_ENABLED`

### Billing (optional until Team checkout)

See [saas-billing-lemon.md](./saas-billing-lemon.md):

- `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_VARIANT_ID_TEAM`, `LEMONSQUEEZY_WEBHOOK_SECRET`
- Set all four together on hosted production; omit all four for self-hosted Community-only installs
- Production builds fail fast if any Lemon variable is set without the full validated set (`assertSecureProductionEnv`)
- Webhook URL: `https://usejunction.dev/api/webhooks/lemonsqueezy`

### Optional ops / SEO

- `SLACK_WEBHOOK_URL`, `SALES_NOTIFICATION_TO`
- `INDEXNOW_KEY`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `NEXT_PUBLIC_TWITTER_HANDLE`
- GitHub App: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`
  - Repository permissions required for Work & spend: **Pull requests: read**, **Contents: read**, **Issues: read** (Metadata is already granted). Organization installs also need **Members: read** for author matching and **Organization Projects: read** for selected Projects. Missing Projects permission affects only Project enrichment, not repository sync. Existing installations must approve newly requested permissions once (orgs: `github.com/organizations/{org}/settings/installations/{id}/permissions/update`; personal: `github.com/settings/installations/{id}/permissions/update`). Personal installs skip Members and cannot use organization Projects.
  - Install: set the App to **Any account**. Connect GitHub opens `github.com/settings/apps/{slug}/installations` (Install App) so the owner can pick a user or organization, then repositories. GitHub’s `/installations/new` skips that list when a personal install already exists. Setup URL: `{NEXT_PUBLIC_APP_URL}/api/integrations/github/callback` with **Redirect on update**.
  - Copilot billing remains optional — personal accounts and orgs without Copilot still sync commits. Cost is allocated onto ticket keys in commit messages, not PRs.
- PostHog product analytics: set both `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and
  `NEXT_PUBLIC_POSTHOG_HOST` (for PostHog US Cloud, `https://us.i.posthog.com`);
  omit both to keep analytics disabled

After changing env vars, **redeploy** Production so the new values are picked up.

## Cron jobs

Hobby Vercel only allows **once-per-day** native crons. The hourly report fan-out runs via GitHub Actions (`.github/workflows/production-crons.yml`).

| Route | Purpose | Scheduler | Schedule |
|-------|---------|-----------|----------|
| `GET/POST /api/cron/usage-daily-refresh` | Seal UTC day for agent full usage rescans + invalidate analytics caches | Vercel (`apps/admin/vercel.json`) | `15 0 * * *` |
| `GET/POST /api/cron/materialize-org-day-snapshots` | Materialize org day analytics snapshots | Vercel (`apps/admin/vercel.json`) | `45 0 * * *` |
| `POST /api/cron/daily-report-send` | Email daily report teasers at 19:00 in each user’s timezone | GitHub Actions | `5 * * * *` |
| `POST /api/cron/device-health` | Queue silent stale-device resyncs and send one 48-hour repair notice per outage | GitHub Actions | `*/15 * * * *` |
| `POST /api/cron/provider-sync` | Pull due provider connections (Copilot + GitHub commits, then feature-cost allocation) | GitHub Actions (`.github/workflows/provider-sync.yml`) | `*/15 * * * *` |

#### Recovery email alerts for reserved domains

Resend rejects reserved domains such as `@example.com`. If a stale device is tied to a developer with one of these addresses, the cron used to retry every 15 minutes and emit duplicate Slack alerts (`auth email` + `device-health/recovery-email`). The app now marks those notices as `skipped` instead of retrying.

After deploying the skip logic, inspect and clean up affected production rows:

```sql
SELECT d.id, d.hostname, d.last_seen_at, dev.email, drn.status, drn.attempt_count, drn.last_error
FROM devices d
JOIN developers dev ON dev.id = d.user_id
LEFT JOIN device_recovery_notices drn ON drn.device_id = d.id AND drn.recovered_at IS NULL
WHERE d.id = 'cmshr9tc900059a9k4p8vobyv'
   OR d.org_id = 'cmshr9sh800009a9k2bygsao0';
```

Then update the developer to a real email, decommission the stale device, or mark open notices as skipped:

```sql
UPDATE device_recovery_notices
SET status = 'skipped', last_error = 'undeliverable recipient (manual cleanup)'
WHERE device_id = 'cmshr9tc900059a9k4p8vobyv'
  AND recovered_at IS NULL
  AND status IN ('pending', 'failed', 'sending');
```

Also scan for other reserved-domain developers with stale devices:

```sql
SELECT d.id, d.org_id, d.hostname, dev.email
FROM devices d
JOIN developers dev ON dev.id = d.user_id
WHERE dev.email ~* '@(example\\.com|example\\.org|example\\.net|localhost)$'
   OR dev.email ~* '\\.(test|invalid)$';
```

### GitHub Environment `agent-production` (required for hourly report send)

`.github/workflows/production-crons.yml` runs with `environment: agent-production` (same as agent release workflows — **not** repository secrets).

| Secret | Value |
|--------|--------|
| `CRON_SECRET` | Same value as Vercel Production `CRON_SECRET` |
| `CONTROL_PLANE_URL` | `https://usejunction.dev` (no trailing slash; already required for agent promote/pause) |
| `CONTROL_PLANE_URL_EU` | `https://eu.usejunction.dev` (optional until the EU project is live; EU matrix jobs skip if unset) |

```bash
gh secret set CRON_SECRET --env agent-production -b '<same as Vercel CRON_SECRET>'
# CONTROL_PLANE_URL is usually already set for agent releases:
gh secret list --env agent-production
```

You can also run **Actions → Production crons → Run workflow** to invoke report send manually.

These routes exist but are **not** scheduled by default (add a Vercel daily cron, extend the Actions workflow, or an external ping if needed):

| Route | Purpose | When to schedule |
|-------|---------|------------------|
| `POST /api/cron/billing-seat-sync` | Reconcile Lemon Team seat quantities | Every ~5 min if selling Team; roster + webhooks already sync on demand |
| `POST /api/cron/provider-sync` | Sync due provider connections | Only if you rely on automatic provider pulls |
| `POST /api/cron/litellm-budget` | Reset LiteLLM budgets | Only if LiteLLM runs in production |

Authenticate with `Authorization: Bearer $CRON_SECRET`. Vercel Cron invokes **GET**; Actions and local curl use **POST**.

The usage daily refresh stores `fullUsageRescanDay` (UTC `YYYY-MM-DD`) in `app_runtime_settings`. Enrolled agents receive that day on heartbeat and run one full 60-day local usage rescan, then return to incremental snapshot syncs.

Daily report emails are **separate** from the usage seal. The hourly `daily-report-send` job selects users whose local clock is 19:00, sends a branded HTML teaser (personal + owner/admin org rollup), and deep-links to `/reports/daily` (React + shadcn charts). Users opt out under Settings → Email reports. Timezone is captured from the browser and agent heartbeat (`User.timeZone`).

**Note:** GitHub Actions schedules can drift by a few minutes (and occasionally longer on free plans). That is acceptable for the timezone-gated report send.

**Local dev:** how to trigger the report cron, test the UI without email, and interpret `due` / `skipped` — [daily-reports.md](./daily-reports.md#run-the-report-job-locally).

## EU deployment

Hosted EU traffic is a **separate** Vercel project and Postgres database. Do not share `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, or `ABLY_API_KEY` with the US project.

| Piece | EU value |
|-------|----------|
| Vercel project | `admin-eu` (root `apps/admin`) |
| Domain | `eu.usejunction.dev` |
| Function region | `fra1` (or the region closest to the EU Postgres) |
| Postgres | EU-region managed Postgres; run `prisma migrate deploy` against this URL only |
| `DEPLOYMENT_REGION` / `NEXT_PUBLIC_DEPLOYMENT_REGION` | `eu` |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | `https://eu.usejunction.dev` |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.i.posthog.com` (startup fails closed if a US host is set) |
| `NEXT_PUBLIC_US_APP_URL` / `NEXT_PUBLIC_EU_APP_URL` | Used by the signup region picker |
| Resend / Ably | Prefer EU-region options when the vendor offers them |
| GitHub `CONTROL_PLANE_URL_EU` | `https://eu.usejunction.dev` on `agent-production` |

Product behavior on the EU deployment:

- Signals work extraction and classic journey ingest return 403.
- Slack signup/login notifications send counts and method only (no name or email).
- `Organization.dataRegion` is recorded as `eu` at workspace creation.

Provisioning the Vercel project and EU database is a human step; this document is the checklist.

## Agent OTA (separate from web deploy)

Pushing to `main` does **not** update enrolled devices.

1. Configure GitHub signing + promote secrets — [agent-releases.md § Production secrets setup](./agent-releases.md#production-secrets-setup)
2. Tag `agent-vX.Y.Z` → draft candidate
3. Manually promote via **Agent release control** workflow

Full ship checklist: [agent-releases.md § How to ship a production agent release](./agent-releases.md#how-to-ship-a-production-agent-release).

**Before sharing the customer install URL:** confirm promotion, not just the GitHub tag:

```bash
curl -fsSL https://usejunction.dev/api/agent-releases/latest
```

A `404` means `curl | install.sh` will fail for customers without a local dev checkout. See [Install script behavior (prod vs dev)](./agent-releases.md#install-script-behavior-prod-vs-dev).

## First-time go-live checklist

1. [ ] Staging Postgres provisioned; Preview (or Staging custom) env vars set; `staging.usejunction.dev` assigned to the `staging` branch
2. [ ] `prisma migrate deploy` against staging, then production
3. [ ] Production Postgres provisioned; pooled Prisma-compatible `DATABASE_URL` set
4. [ ] Required Vercel env vars set; Production redeployed (or a staging deployment promoted)
5. [ ] Vercel Function Region is closest to the database; preview `Server-Timing` budgets pass
6. [ ] Sign-up / sign-in / email invite works (Resend)
7. [ ] Domain `https://usejunction.dev` serves the app
8. [ ] (If Team billing) Lemon keys + webhook configured
9. [ ] GitHub `agent-production` env configured (`CONTROL_PLANE_URL`, `CRON_SECRET`, signing + promote secrets)
10. [ ] First `agent-v*` candidate built and promoted when ready to OTA

## Related docs

- [Controlled Agent Releases](./agent-releases.md)
- [SaaS billing (Lemon Squeezy)](./saas-billing-lemon.md)
- [SEO / AEO measurement](./seo-aeo-measurement.md)
