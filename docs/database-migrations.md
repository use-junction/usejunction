# Database migrations

Postgres schema lives in [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma). SQL migrations live in [`packages/db/prisma/migrations/`](../packages/db/prisma/migrations/). Prisma Client is generated from the schema; the database is updated only when you apply a migration.

`pnpm db:push` (`prisma db push`) is for throwing away a local schema during first-time setup. Do **not** use it to ship schema changes. Commit a migration file instead.

## Apply pending migrations (local)

From the repo root, against the database your admin app actually uses:

```bash
# If DATABASE_URL is in apps/admin/.env (typical local Next.js):
export DATABASE_URL="$(python3 - <<'PY'
from pathlib import Path
for line in Path("apps/admin/.env").read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        print(line.split("=", 1)[1].strip().strip("'\""), end="")
        break
PY
)"

pnpm --filter @usejunction/db exec prisma migrate status
pnpm --filter @usejunction/db exec prisma migrate deploy
pnpm db:generate
```

If you keep a root `.env` (what `packages/db` scripts load via `dotenv -e ../../.env`):

```bash
pnpm --filter @usejunction/db migrate:deploy
pnpm db:generate
```

Restart the admin process after `generate` so it drops any stale Prisma Client (see `PRISMA_SCHEMA_REV` in [`packages/db/src/index.ts`](../packages/db/src/index.ts)).

### Which Postgres?

| Setup | Typical URL host |
|-------|------------------|
| Local / docs in [testing.md](testing.md) | `localhost:5432` |
| Hosted staging / production | pooled provider URL on Vercel |

Confirm with `prisma migrate status` before deploying SQL. The command prints the database name and host.

## Create a new migration

1. Edit `packages/db/prisma/schema.prisma`. Keep `@@map` table names, `@map` columns, and `onDelete` consistent with neighboring models.
2. Add a folder `packages/db/prisma/migrations/<YYYYMMDDHHMM>_<short_name>/migration.sql`.
   - Timestamp is UTC, 12 digits (example: `202609181200_feature_cost`).
   - Write SQL by hand. Follow existing files: `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`, no Prisma shadow-database dump.
3. Bump `PRISMA_SCHEMA_REV` in `packages/db/src/index.ts` when models or fields the running Next.js process caches would otherwise stay stale.
4. Generate the client and apply locally:

```bash
pnpm db:generate
pnpm --filter @usejunction/db exec prisma migrate deploy
```

5. Commit `schema.prisma`, the new `migration.sql` folder, and the `PRISMA_SCHEMA_REV` bump together.

Do not edit a migration that has already been applied anywhere (local teammates, staging, production). Add a new folder instead.

`pnpm db:migrate` runs `prisma migrate dev`. That is interactive and can invent a second migration if the schema drifted. Prefer the hand-written SQL folder + `migrate deploy` workflow above.

## Production

Vercel builds with `DATABASE_URL` set run `prisma migrate deploy` automatically. That covers US production (and staging, once that environment has its own URL).

EU is a separate database. Either deploy the EU project so its build migrates, or apply manually:

```bash
DATABASE_URL='postgresql://…' pnpm --filter @usejunction/db exec prisma migrate deploy
```

See [Production deployment](production-deployment.md#database-migrations).
