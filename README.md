# UseJunction

**Cut AI coding spend. See which seats, plans, and tools your team actually uses — and stop paying for the rest.**

## Install

Sign in at [usejunction.dev](https://usejunction.dev), copy your enroll token, then:

```bash
curl -fsSL https://usejunction.dev/install.sh | sh -s -- --token YOUR_TOKEN
```

Works with **Claude Code**, **Codex**, and **Cursor** — plus OpenCode, Gemini, Antigravity, and Copilot.

<p>
  <a href="https://github.com/Dinuda/usejunction/actions/workflows/admin-tests.yml"><img src="https://github.com/Dinuda/usejunction/actions/workflows/admin-tests.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Community-0F172A" alt="License"></a>
  <img src="https://img.shields.io/badge/Claude_Code-verified-059669" alt="Claude Code verified">
  <img src="https://img.shields.io/badge/Codex-verified-059669" alt="Codex verified">
  <img src="https://img.shields.io/badge/Cursor-verified-059669" alt="Cursor verified">
  <img src="https://img.shields.io/badge/macOS_%7C_Windows-verified-059669" alt="macOS and Windows verified">
</p>

The agent reads local usage signals only. No keystroke logging, screenshots, or network interception.

## Self-host

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDinuda%2Fusejunction&project-name=usejunction&repository-name=usejunction&root-directory=apps%2Fadmin&framework=nextjs&env=AUTH_SECRET%2CINGEST_SECRET%2CCRON_SECRET%2CAGENT_RELEASE_OPERATIONS_TOKEN%2CABLY_API_KEY%2CINTEGRATION_ENCRYPTION_KEY%2CAUTH_TRUST_HOST&envDescription=AUTH_TRUST_HOST%3Dtrue.+Generate+other+secrets+with+openssl+rand+-base64+48+%28use+-base64+32+for+AGENT_RELEASE_OPERATIONS_TOKEN+and+INTEGRATION_ENCRYPTION_KEY%29.&envLink=https%3A%2F%2Fgithub.com%2FDinuda%2Fusejunction%2Fblob%2Fmain%2Fdocs%2Fhosting.md&demo-url=https%3A%2F%2Fusejunction.dev&demo-title=UseJunction&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>

Creates a Postgres database on Vercel. Then follow the [hosting guide](docs/hosting.md).

<p align="center">
  <img src="docs/images/readme-image.png" alt="UseJunction dashboard" width="920">
</p>

## What you get

- Which AI coding tools and models developers actually use
- Estimated cost by person, team, tool, and model
- Idle seats, unused plans, and devices missing coverage
- Personal keys vs company-provisioned accounts

[AI coding spend](https://usejunction.dev/solutions/ai-coding-spend-management) · [Seat utilization](https://usejunction.dev/solutions/ai-coding-seat-utilization) · [Plan usage](https://usejunction.dev/guides/see-plan-usage-and-waste)

## Docs

- [Hosting](docs/hosting.md) — local run, Vercel, agent
- [Privacy](https://usejunction.dev/privacy)
- [License](LICENSE)
