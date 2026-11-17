<div align="center">
    <img src="https://cdn.jsdelivr.net/gh/use-junction/usejunction@main/apps/admin/public/favicon.svg" alt="UseJunction logo" width="128" height="128">
    <h1>usejunction</h1>
</div>

<p align="center">
    <a href="https://npmjs.com/package/usejunction"><img src="https://img.shields.io/npm/v/usejunction?color=yellow" alt="npm version" /></a>
    <a href="https://npmjs.com/package/usejunction"><img src="https://img.shields.io/npm/dt/usejunction" alt="npm downloads" /></a>
    <a href="https://github.com/use-junction/usejunction"><img src="https://img.shields.io/github/stars/use-junction/usejunction?style=flat" alt="GitHub stars" /></a>
</p>

<div align="center">
    <img src="https://cdn.jsdelivr.net/gh/use-junction/usejunction@main/npm/usejunction/docs/screenshot.png" alt="usejunction terminal report: usage and estimated cost per day for Claude Code, Codex and Cursor" width="760">
</div>

> See what Claude Code, Codex, Cursor and your other AI coding tools cost, from the logs already on your machine. No account. Nothing uploaded.

## Quick Start

```bash
npx usejunction@latest
```

## Supported Sources

usejunction reads the usage that AI coding tools already write to your machine and turns it into daily, weekly, monthly, session and 5-hour reports.

| Source              | Focused command example                |
| ------------------- | -------------------------------------- |
| Claude Code         | `usejunction daily --tool claude`      |
| Codex               | `usejunction daily --tool codex`       |
| Cursor              | `usejunction daily --tool cursor`      |
| GitHub Copilot Chat | `usejunction daily --tool copilot`     |
| OpenCode            | `usejunction daily --tool opencode`    |
| Antigravity         | `usejunction daily --tool antigravity` |
| Cline               | `usejunction daily --tool cline`       |
| Roo Code            | `usejunction daily --tool roo`         |
| Continue            | `usejunction daily --tool continue`    |

Use `usejunction daily`, `usejunction weekly` or `usejunction monthly` to include every detected source in one report.

## Installation

### Package Runners

Run it without installing anything:

```bash
# npm
npx usejunction@latest

# Alternative package runners
pnpm dlx usejunction
bunx usejunction
```

The first run downloads the binary for your platform. Later runs use the copy in your cache folder and start right away.

### Install the agent

To keep usejunction on your `PATH`, and to see charts and your whole team in the dashboard:

```bash
# macOS and Linux
curl -fsSL https://usejunction.dev/install.sh | bash

# Windows (PowerShell)
irm https://usejunction.dev/install.ps1 | iex
```

## Usage

```bash
# Basic usage
npx usejunction             # Every detected source by day, last 30 days (default)
npx usejunction today       # Today
npx usejunction week        # This week, Monday to today
npx usejunction month       # This month
npx usejunction daily       # By day
npx usejunction weekly      # By week
npx usejunction monthly     # By month
npx usejunction session     # Claude Code by session
npx usejunction blocks      # Claude Code 5-hour windows, with the pace of the active one
npx usejunction statusline  # One line for Claude Code's status line

# One source
npx usejunction daily --tool claude
npx usejunction weekly --tool codex
npx usejunction month --tool cursor

# Filters and options
npx usejunction daily --since 2026-11-01 --until 2026-11-16
npx usejunction daily --last 7       # The last 7 days
npx usejunction weekly --last 4      # The last 4 weeks
npx usejunction monthly --breakdown  # A line per model under each row
npx usejunction daily --order desc   # Newest first
npx usejunction daily --json         # JSON output
npx usejunction blocks --active      # Only the block in progress
```

Dates are `YYYYMMDD` or `YYYY-MM-DD`. Add `--help` to any command for the rest.

## Features

- 📊 **Daily, Weekly and Monthly Reports**: Token usage and estimated cost by day, by week (Monday to Sunday) or by month
- ⚡ **Today, Week and Month**: One word for the period you are in: `today`, `week`, `month`
- ⏱️ **Recent Periods**: `--last N` on any daily, weekly or monthly report
- 💰 **Cost by Tool and by Model**: Every report ends with where the money went, with each tool's and each model's share, without any extra flag
- ➕ **Totals per Period**: A day, week or month that used more than one tool gets its own total line
- 🔍 **Says What It Found**: Names the tools it read, and the ones with no usage in the period shown
- 💬 **Session Report**: Claude Code cost per session, with the project it ran in
- ⏰ **5-Hour Blocks Report**: Track Claude's 5-hour usage windows, with the time left, the spend per hour and where the active block is heading
- 🚀 **Statusline Integration**: Session, today and block cost on one line in Claude Code's status bar
- 🧰 **9 Sources, Cursor Included**: Claude Code, Codex, Cursor, GitHub Copilot Chat, OpenCode, Antigravity, Cline, Roo Code and Continue in one table
- 🤖 **Model Tracking**: See which models each tool used, most expensive first
- 📋 **Model Breakdown**: A line per model with `--breakdown`
- 📅 **Date Filtering**: `--since` and `--until`
- 🔎 **One Source at a Time**: `--tool claude`, `--tool cursor`, and so on
- 📄 **JSON Output**: Structured output with `--json`, for scripts
- 🔄 **Cache Tokens Counted Once**: Uncached input, output and cache tokens are kept apart, so nothing is counted twice
- 🎨 **Easy-to-Read Tables**: Bordered tables that fit your terminal: the Models column narrows first, and drops out on a narrow window
- ⚠️ **Honest About Prices**: Models missing from the price table are named, not quietly guessed
- 🔒 **Offline by Design**: The usage commands make no network requests and upload nothing. Prompt text is never read
- 👥 **Team Dashboard When You Want It**: Install the agent and sign in to see charts, cost by repository and your whole team

## Claude Code Status Line

Point Claude Code's status line at usejunction in `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "npx -y usejunction statusline" }
}
```

It prints one line like `Opus 4.5 · $4.00 session · $12.40 today · $4.00 block, 4h 00m left · $6.00/hr`.

## How Costs Are Worked Out

Costs are estimates at each model's API list price, worked out from the token counts in your local logs. They are not your bill: on a subscription plan you pay the plan's price, and the estimate shows what the same work would cost through the API.

## How This Package Works

This package downloads the usejunction agent for your platform from the project's GitHub release, checks it against the release's SHA-256 checksums, keeps it in your cache folder and runs it. It installs nothing else: no background service and no changes to your tools' settings.

## Documentation

Website: **[usejunction.dev](https://usejunction.dev)** · Source: **[github.com/use-junction/usejunction](https://github.com/use-junction/usejunction)**

## License

[UseJunction Community License](https://github.com/use-junction/usejunction/blob/main/LICENSE)
