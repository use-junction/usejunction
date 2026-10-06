# Hosting

How to run UseJunction yourself: one-click Vercel (recommended), local development, and the device agent.

Hosted production for [usejunction.dev](https://usejunction.dev) (domains, crons, EU, agent OTA) is a separate runbook: [Production deployment](production-deployment.md).

## Deploy on Vercel

This matches the live [usejunction.dev](https://usejunction.dev) project (`admin` on GitHub `main`).

1. Click **Deploy** on the [README](../README.md).
2. When Vercel asks for a database, create a **Neon** Postgres store (US East `iad1`, same region as the app). That sets `DATABASE_URL` for you.
3. Paste the secrets below. Set `AUTH_TRUST_HOST` to `true`.
4. Wait for the build. Schema is applied automatically (`prisma migrate deploy` runs when `DATABASE_URL` is present).
5. In the Vercel project, set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the deployment URL (`https://….vercel.app` or your domain) and redeploy if those were empty.
6. Open the site, create an account, then enroll a device with the install command the UI shows.

### Secrets to paste

Generate with `openssl rand -base64 48` unless noted.

| Variable | What to enter |
|----------|----------------|
| `AUTH_SECRET` | Session signing |
| `INGEST_SECRET` | Agent ingest |
| `CRON_SECRET` | Cron bearer |
| `AGENT_RELEASE_OPERATIONS_TOKEN` | `openssl rand -base64 32` |
| `ABLY_API_KEY` | Ably API key (`ably-key:…` from the Ably dashboard) — fleet sync |
| `INTEGRATION_ENCRYPTION_KEY` | `openssl rand -base64 32` (must decode to 32 bytes) |
| `AUTH_TRUST_HOST` | `true` |

`DATABASE_URL` comes from Neon. Do not paste the production usejunction.dev database URL.

Optional after it boots: Resend (`RESEND_API_KEY`, `AUTH_EMAIL_FROM`) for invites; GitHub/Google OAuth; Lemon Squeezy. Full production list: [Production deployment](production-deployment.md#required-environment-variables-vercel-production).

Do not set `USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT=true`.

### Project settings (same as production)

If you wire a Vercel project by hand instead of the button:

| Setting | Value |
|---------|--------|
| Framework | Next.js |
| Root Directory | `apps/admin` |
| Install Command | `cd ../.. && corepack enable && pnpm install --frozen-lockfile` |
| Node | 20+ (production uses 24.x) |
| Function region | Closest to Postgres (`iad1` on usejunction.dev) |
| Production branch | `main` |

Build is defined in [`apps/admin/vercel.json`](../apps/admin/vercel.json): generate Prisma client, migrate if `DATABASE_URL` is set, then `next build`.

## Run locally

Postgres 16 on `localhost:5432`, database `usejunction`. From the repo root:

```bash
createdb usejunction

cp .env.example .env
# Set AUTH_SECRET: openssl rand -base64 48
# DATABASE_URL defaults to postgresql://localhost:5432/usejunction

pnpm install
pnpm --filter @usejunction/db exec prisma migrate deploy
pnpm dev
```

Admin UI: [http://localhost:3001](http://localhost:3001)

Schema changes after first setup: [Database migrations](database-migrations.md).

## Install the agent

From a checkout (builds the Go agent locally — preferred for development):

```bash
./install.sh --token <token> --url http://localhost:3001
```

Against a hosted or Vercel control plane:

```bash
curl -fsSL https://YOUR_APP_ORIGIN/install.sh | sh -s -- --token <token> --url https://YOUR_APP_ORIGIN
```

Windows 10/11 PowerShell (x64 or ARM64, no administrator shell required):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing 'https://YOUR_APP_ORIGIN/install.ps1'))) -Token '<token>' -Url 'https://YOUR_APP_ORIGIN'"
```

The installer adds `~/.usejunction/bin` (Windows: `%USERPROFILE%\.usejunction\bin`) to `PATH`. Open a new terminal before using `usejunction` commands.

Teammate connect uses the shared team invite link (`/i/<token>`). After signing in, the UI shows the install command with an enrollment token.

Windows installs run through a per-user Scheduled Task at logon and collect native Windows coding-tool data; WSL stores are not scanned.

Or build manually:

```bash
cd agent && go build -o usejunction .
./usejunction enroll --token <token> --url http://localhost:3001
./usejunction doctor
./usejunction report
```

### Two agents on one Mac (production + local dev)

| Profile              | Home                  | App (macOS)                          | CLI                | launchd label                | Local sync port |
| -------------------- | --------------------- | ------------------------------------ | ------------------ | ---------------------------- | --------------- |
| Production (default) | `~/.usejunction`      | `~/Applications/UseJunction.app`     | `usejunction`      | `com.usejunction.agent`      | `47832`         |
| Test (local dev)     | `~/.usejunction-test` | `~/Applications/UseJunctionTest.app` | `usejunction-test` | `com.usejunction.agent.test` | `47833`         |

- Enroll **production** from your hosted control plane (e.g. `https://usejunction.dev`).
- Enroll **local dev** from `http://localhost:3001` — the installer auto-selects the test profile for loopback URLs.

Both daemons can run at the same time without clobbering each other's enrollment.

### Hot-reload the local agent

After the test agent is enrolled once, rebuild and reinstall whenever `agent/` changes:

```bash
pnpm dev            # admin + agent watcher
pnpm dev:admin      # admin only
pnpm agent:reinstall
pnpm dev:agent      # watch agent/ and reinstall
```

Requires `~/.usejunction-test/config.json`. This stamps a `0.0.0-dev.<sha>.<unix>` version and does **not** publish a control-plane release.

When you enroll against a local control plane, `/install.sh` injects `USEJUNCTION_ROOT` and `USEJUNCTION_PROFILE=test` so `curl | sh` builds from this checkout into `~/.usejunction-test`. Production hosts still serve published releases only.

A prior `pnpm agent:reinstall` writes `~/.usejunction-test/dev-source`, so later `curl | sh` against prod may still build a dev version if that pin exists. Customer installs need a **promoted** release (`GET /api/agent-releases/latest` must return 200). See [Install script behavior](agent-releases.md#install-script-behavior-prod-vs-dev).

`fswatch` (`brew install fswatch`) makes the watcher faster; without it, it polls every ~750ms.

Optional: `./scripts/build-agent-releases.sh 0.2.0` publishes binaries into `apps/admin/public` for local `curl | sh`.

## Verified coverage

Tested on real machines and confirmed in the admin UI:

| Tool        | Platform |
| ----------- | -------- |
| Cursor      | macOS, Windows |
| Codex       | macOS |
| Claude Code | macOS |
| OpenCode    | macOS |
| Gemini      | macOS |
| Antigravity | macOS |

Other tools are collected by the agent; this table grows as stacks are validated end-to-end.

Vendor-reported charges (e.g. Cursor `chargedCents > 0`) are **verified usage**. Local scans and rate-card pricing are **estimated usage**. See [Usage accounting](usage-accounting.md).

## Architecture

```
Developer machines (Claude Code / Codex / Cursor / …)
        │
        ▼
Go agent  (~/.usejunction or ~/.usejunction-test)
        │  UUS sync, OTEL, heartbeats
        ▼
Control plane  (apps/admin · Next.js)  →  PostgreSQL
```

Optional LiteLLM budget reset still runs when `LITELLM_URL` and `LITELLM_MASTER_KEY` are set.

**Reads:** [Central analytics engine](central-analytics-engine.md) and [Subscription cycle utilization](subscription-cycle-utilization.md).

**Sync paths:** [Tool sync methodology](tool-sync-methodology.md).

**Agent OTA:** [Controlled agent releases](agent-releases.md). Signals: [signals-collection.md](signals-collection.md).

## CLI

After install, `usejunction` is on `PATH` in new terminals.

| Command                          | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `usejunction enroll --token <t>` | Enroll device (runs setup by default)                   |
| `usejunction setup`              | Enable Claude OTEL and send initial report              |
| `usejunction doctor`             | Detect installed tools                                  |
| `usejunction status`             | Show enrollment state                                   |
| `usejunction cost --tool all`    | Local usage scan (JSONL / sqlite / extension task JSON) |
| `usejunction update --check`     | Check the active release without installing             |
| `usejunction update`             | Download, verify, and install an available update       |
| `usejunction update --rollback`  | Restore the retained previous binary                    |
| `usejunction update --force`     | Reinstall a version locally blocked after rollback      |
| `usejunction uninstall`          | Remove agent                                            |

Existing `0.1.0` installations need one updater bootstrap after the first release is promoted:

```bash
curl -fsSL <control-plane>/install.sh | sh -s -- --upgrade --url <control-plane>
```

## Project structure

```
apps/admin/     Next.js admin UI + control plane API
packages/db/    Prisma schema + client
agent/          Go local agent CLI
install.sh      One-line enroll installer
scripts/        Local dev and verification
```

Local verification: `pnpm verify` (no Postgres) or `pnpm verify:e2e` — [Testing](testing.md).

## Related

- [Database migrations](database-migrations.md)
- [Production deployment](production-deployment.md) — usejunction.dev ops
- [Testing](testing.md)
- [Controlled agent releases](agent-releases.md)
