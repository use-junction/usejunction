# How the terminal usage numbers are measured

`usejunction`, `daily`, `weekly`, `monthly`, `today`, `week`, `month`, `session`, `blocks` and `statusline` read the usage numbers AI coding tools write to this machine. This page says what those numbers are, and how they compare with ccusage on the same logs.

## What is counted

- **Tokens** come straight from each tool's local logs. Prompt and response text is never read.
- **One response is counted once.** Claude Code can write one response over several lines, the early ones with a partial output count. Only the most complete line counts.
- **Input is uncached input.** Tools that report cached tokens inside their input count (Codex) are not counted twice.
- **Cost is an estimate at API list prices**, from the price table in `agent/internal/scan/pricing.go`. It is not your bill. A subscription costs what the plan costs, whatever the table says.
- **Days are UTC** in `daily`, `weekly` and `monthly` (and `today`, `week` and `month`), the same days the dashboard uses. `session` and `blocks` show local time.
- **Only the last 60 days are read.**

## Nothing leaves the machine

These commands make no network request, on a connected device or not. `agent/cmd/usage_offline_test.go` runs each one and fails on any request.

Cursor is the one tool whose billed usage lives on its own servers. The background service of a connected device fetches it with the local Cursor login. The terminal tables do not: they show what is on disk, which for Cursor on an unconnected machine can be less than the dashboard shows later.

## Compared with ccusage

Run both on the same days:

```bash
cd agent && go build -o /tmp/usejunction . && cd ..
scripts/compare-usage-with-ccusage.py /tmp/usejunction 20261101 20261115
```

Checked on 2026-11-16 against `ccusage@latest`, over 15 days and 8 models:

- **Token counts match exactly**, for input, output, cache write and cache read, on every model.
- **Costs differ**, because the two price lists differ. ccusage reads LiteLLM's list; we use our own table, which the dashboard shares.

Two differences in the price lists explain most of the gap:

| Difference | Effect |
| --- | --- |
| LiteLLM prices 1-hour cache writes at 2× the input price. Our table has one cache-write price per model, the 5-minute one (1.25×). | We come out lower for Claude Code, which mostly writes 1-hour cache. |
| Some rates differ: `claude-fable-5-2` (ours 10/50, LiteLLM 8/40 per million in/out), `claude-sonnet-5-5` cache read (0.2 vs 0.1), `gpt-5.6-luna` (1/6 vs 0.2/1.2), `gpt-5.6-sol` (5/30 vs 4/20). | Per model, in either direction. |

Changing the price table changes every customer's dashboard, so it is a separate decision from this page. Any change has to be made in `agent/internal/scan/pricing.go` and `apps/admin/lib/metrics/estimate-cost.ts` together.
