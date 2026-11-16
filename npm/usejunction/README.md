# usejunction

See what your AI coding tools cost, from the logs already on your machine.

```bash
npx usejunction
```

No account. Nothing is uploaded, and the usage commands make no network request once the program itself is downloaded.

```
 AI coding usage · last 30 days · this machine

 Date        Tool         Models               Input  Output  Cache    Cost
 2026-11-13  Claude Code  opus-4-5               900     240      0  $29.10
 2026-11-14  Claude Code  opus-4-5, sonnet-4-5  1.5K    2.5K    45K  $38.20
             Codex        gpt-5                   4K     900     6K   $9.75
 Total                                          6.4K    3.6K    51K  $77.05
```

## Commands

| Command | Shows |
| --- | --- |
| `npx usejunction` | Usage and estimated cost per day, last 30 days, every tool found |
| `npx usejunction monthly` | The same by month |
| `npx usejunction session` | Claude Code cost per session |
| `npx usejunction blocks` | Claude Code in 5-hour blocks, with the pace of the active one |
| `npx usejunction statusline` | One line for Claude Code's status line |

`--since`, `--until`, `--breakdown`, `--json` and `--order` are there, with dates as `YYYYMMDD` or `YYYY-MM-DD`. Add `--help` to any command for the rest.

Costs are estimates at API list prices, not your bill.

## What this package does

It downloads the UseJunction agent for your platform from the project's GitHub release, checks it against the release's SHA-256 checksums, keeps it in your cache folder, and runs it. It installs nothing else: no background service and no changes to your tools' settings.

## Seeing more

The terminal shows one machine. To see charts, cost by repo and a whole team together, install the agent and sign in:

```bash
curl -fsSL https://usejunction.dev/install.sh | bash
```

Source and docs: https://github.com/use-junction/usejunction
