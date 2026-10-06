# Central Analytics Engine

UseJunction analytical reads run through one central engine. Pages, read models, tests, and the public query API should not duplicate usage, cost, source-priority, or token aggregation logic.

The runtime flow is:

```text
ingestion -> UsageDaily -> central SQL query engine -> read-model composers -> server pages
                                      ^
                                      |
                         POST /api/insights/query
```

`UsageDaily` is the canonical materialized fact table. The engine aggregates inside PostgreSQL and returns normalized query results. Dashboard org rollups read sealed `org_usage_day_snapshots` (dirty days surface as `partialData`, not live CTE overlays); drill-down pages still query `usage_daily` live. Daily reports keep their own sealed snapshots. See [Dashboard Snapshots](dashboard-snapshots.md).

## Source Of Truth

The accounting semantics live in two places:

- `docs/usage-accounting.md` defines what requests, token buckets, cost kinds, metric kinds, source priority, and model visibility mean.
- `apps/admin/lib/analytics/query/` implements those semantics for reads.

The central engine normalizes legacy source aliases, chooses activity and cost sources independently, keeps productivity separate from observed model-call KPIs, preserves repository splits for the winning source class, and keeps verified usage, estimated API cost, invoice cost, and subscription spend distinct.

Accounting highlights enforced in `apps/admin/lib/analytics/query/sql.ts`:

- Free, $0, and device-observed tools still count toward `requests` when `metric_kind = usage`
- `metric_kind = productivity` and legacy `cursor_local` / `opencode_local` rows never win `selected_activity`
- Synthetic `estimated` source is excluded from observed activity but its cost can still win `selected_cost`

## Query Contract

Authenticated clients use `POST /api/insights/query`. The endpoint accepts `UsageQueryV1`:

- `schemaVersion`: currently `"1"`.
- `window`: either `{ "preset": 7 | 30 | 90 }` or `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`.
- `timezone`: only `"UTC"`.
- `measures`: one or more allowlisted measures.
- `dimensions`: up to four allowlisted dimensions.
- `filters`: allowlisted list filters only.
- `orderBy`: up to three allowlisted fields.
- `limit`: 1 to 500 rows.

Callers never provide organization scope. Owners and admins can query organization data. Developers are forcibly scoped to their own resolved developer record.

Example:

```bash
curl -X POST http://localhost:3001/api/insights/query \
  -H "Content-Type: application/json" \
  -H "Cookie: uj_session=..." \
  -d '{
    "window": { "preset": 30 },
    "measures": ["requests", "inputTokens", "outputTokens", "costMicros"],
    "dimensions": ["day", "provider"],
    "orderBy": [{ "field": "day", "direction": "asc" }],
    "limit": 500
  }'
```

Responses use the versioned insight envelope pattern:

```json
{
  "schemaVersion": "1",
  "kind": "usage-query",
  "generatedAt": "2026-07-15T00:00:00.000Z",
  "dataThrough": "2026-07-15T00:00:00.000Z",
  "timezone": "UTC",
  "window": { "from": "2026-06-16", "to": "2026-07-15", "grain": "day" },
  "data": {
    "rows": [
      {
        "dimensions": { "day": "2026-07-15", "provider": "openai" },
        "measures": {
          "requests": 42,
          "inputTokens": "123456",
          "outputTokens": "7890",
          "costMicros": "12345"
        }
      }
    ]
  },
  "meta": {
    "cache": { "status": "bypass", "expiresAt": null }
  }
}
```

BigInt-like token, duration, and money values are serialized as decimal strings.

## Measures And Dimensions

Measures:

```text
requests, sessions, inputTokens, outputTokens, cacheReadTokens,
cacheWriteTokens, reasoningTokens, activeSeconds, suggestedLines,
acceptedLines, addedLines, deletedLines, commits, pullRequests,
costMicros, activeDevelopers
```

Dimensions:

```text
day, developer, repository, tool, provider, product, model,
source, metricKind, costKind
```

Filters:

```text
developerIds, repositoryIds, toolNames, providers, products, models,
sources, metricKinds, costKinds
```

All SQL is compiled from these allowlists and parameterized values. Do not accept caller-supplied SQL fragments.

## Freshness

Query results are always computed live in PostgreSQL. There is no `analytics_query_cache` table.

Dashboard org rollups read sealed `org_usage_day_snapshots`. Dirty days are flagged (`partialData`, `dashboardReady: false`) until rematerialization — headline KPIs do not overlay live `usage_daily` while dirty. Daily reports keep sealed `daily_report_usage_snapshots`.

Writes that affect `UsageDaily` mark dirty snapshot days and enqueue rematerialization (sync commit settles inline; cron drains backlog). They do not invalidate a query-result cache.

Do not introduce a query-result cache for:

- device health
- configuration health
- mutable subscription inventories
- authorization checks
- raw request-log pages

## Read Models

Server pages should call named read-model composers, not legacy read routes. Those read models may combine:

- central analytics query results
- operational database reads, such as developer rosters, subscriptions, devices, and configuration state
- billing facts that need freshness timestamps

The important rule is that usage aggregation belongs in the central engine. Read models should compose already-normalized results instead of scanning all `UsageDaily` rows in Node.js.

## Removed Legacy Routes

These read routes were intentionally hard-deleted:

- `/api/dashboard/config-health`
- `/api/dashboard/developers`
- `/api/dashboard/devices`
- `/api/dashboard/local-models`
- `/api/dashboard/metrics`
- `/api/dashboard/requests`
- `/api/dashboard/tools`
- `/api/dashboard/usage`
- `/api/me/overview`
- `/api/me/usage`
- `/api/billing/summary`
- `/api/org-spend`
- `GET /api/tools/[toolKey]`
- `/api/insights/overview`
- `/api/insights/plan-usage`

Do not reintroduce read routes for derived analytics. Add a new query, measure, dimension, filter, or read-model composer instead.

The nested mutation endpoint `POST /api/tools/[toolKey]/apply-detected` remains.

## Adding New Analytics

When adding a new analytical surface:

1. Add the measure, dimension, or filter to `apps/admin/lib/analytics/query/contracts.ts`.
2. Map it in `apps/admin/lib/analytics/query/sql.ts` using allowlisted `Prisma.sql` fragments.
3. Decide whether the value belongs to activity, cost, productivity, or an operational read model.
4. Add tests for normalization, authorization scope, and SQL result shape.
5. Use the query endpoint in E2E coverage for analytical assertions.

For UI data, prefer server-loaded props and `router.refresh()` after mutations. Client components should not refetch removed read routes.

## Operations

Structured query logs include:

- cache status (`bypass` for live SQL)
- query duration
- result row count
- result byte size
- organization id

Useful validation commands:

```bash
pnpm --filter @usejunction/admin test
pnpm --filter @usejunction/admin build
pnpm --filter @usejunction/db prisma validate
pnpm --filter @usejunction/db prisma generate
```
