# SEO / AEO measurement checklist

Operational checklist after shipping the on-site SEO + AEO system. Not automated CI—run after each production deploy that changes public URLs.

## Brand collision (critical)

Search engines and LLMs often collapse **UseJunction** into **Junction Panel** because both use “Junction” and talk about Claude Code / Codex. Evidence of failure: answering `usejunction.dev` with Junction Panel Free/Core/Switchboard pricing, or claiming a redirect.

**Canonical entity facts (keep these consistent everywhere):**

- Official name: **UseJunction**
- Official URL: **https://usejunction.dev**
- Not: Junction Panel / https://junctionpanel.dev
- Disambiguation page: https://usejunction.dev/compare/junction-panel
- Machine-readable: https://usejunction.dev/llms.txt

Never brand publicly as bare “Junction.”

## One-time setup

1. Confirm canonical host is `https://usejunction.dev` (`www.usejunction.dev` redirects to the apex). The `.com` redirect only becomes active after that domain points to this deployment.
2. Set env vars in production:
  - `GOOGLE_SITE_VERIFICATION` (from GSC), `BING_SITE_VERIFICATION` (from Bing) — rendered as meta tags
  - `NEXT_PUBLIC_TWITTER_HANDLE` only when it points to a product account you control
  - `INDEXNOW_KEY` (any 8+ char string / UUID)
3. Google Search Console — property for `usejunction.dev`
  - Submit `https://usejunction.dev/sitemap.xml`
  - Request indexing for `/`, `/compare/junction-panel`, `/llms.txt`, priority solutions/guides
  - After a homepage brand/title change, inspect `/`, confirm Google's selected canonical is `https://usejunction.dev/`, and request indexing once. Repeated requests do not speed up recrawling.
4. Bing Webmaster Tools — import from GSC or submit the same sitemap
5. IndexNow — after each deploy that changes public URLs, ping:
  - `curl -X POST "https://usejunction.dev/api/indexnow?key=$INDEXNOW_KEY"`
  - Confirm `https://usejunction.dev/indexnow-key.txt` returns the key
6. Verify fetch:
  - `/` returns `200` to both a normal browser user agent and Googlebot
  - Raw homepage HTML contains exactly one `<title>`: `UseJunction — AI Coding Spend & Usage for Claude, Cursor & Codex`
  - `/` declares `https://usejunction.dev/` as canonical and does not emit a `noindex` meta tag or header
  - `/robots.txt` disallows `/dashboard`, `/api/`, auth routes
  - `/sitemap.xml` lists all public guides/compare/for/blog hubs (includes `/compare/junction-panel`)
  - `/manifest.webmanifest` returns JSON
  - `/llms.txt` and `/llms-full.txt` return plain text and include the Junction Panel disambiguation line
  - `/blog/rss.xml` returns the blog feed
7. Share a homepage URL in Slack/iMessage and confirm large OG image renders

## Citation sprint (do this once indexing is requested)

Answer engines need **external** co-occurrence of brand + URL. Ship 10–20 mentions that include the exact string `https://usejunction.dev`:

- GitHub README (already disambiguates)
- Product Hunt / Launch HN / Reddit (r/devops, r/cursor, r/ClaudeAI) with the compare link
- Short X/LinkedIn posts: “UseJunction ≠ Junction Panel”
- Changelog / release notes linking homepage + `/compare/junction-panel`

Without citations, on-site schema alone will not beat Junction Panel’s entity dominance.

## Monthly AEO probe list

Run each query in Google (AI Overview if shown), Bing Copilot, Perplexity, Gemini, and ChatGPT (with browsing if available). Record whether UseJunction is cited or linked.


| Query                                          | Target URL                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| usejunction.dev                                | `/`, `/compare/junction-panel`, `/llms.txt`                                   |
| UseJunction vs Junction Panel                  | `/compare/junction-panel`                                                     |
| is usejunction the same as junctionpanel       | `/compare/junction-panel`                                                     |
| open source wakatime alternative               | `/guides/open-source-wakatime-alternative-for-ai-coding`, `/compare/wakatime` |
| how to see Cursor plan usage for my team       | `/guides/see-plan-usage-and-waste`, `/for/cursor`, `/compare/engineering-intelligence` |
| what is AI coding observability                | `/blog/what-is-ai-coding-observability`, `/`                                  |
| are we wasting Cursor Pro seats                | `/guides/see-plan-usage-and-waste`, `/blog/ai-coding-observability-vs-jellyfish-dx-linearb` |
| see my team's AI coding insights               | `/guides/see-team-ai-coding-usage`                                            |
| AI coding observability vs Jellyfish DX LinearB | `/compare/engineering-intelligence`, `/blog/ai-coding-observability-vs-jellyfish-dx-linearb` |
| Cursor seat utilization team                   | `/for/cursor`, `/guides/see-plan-usage-and-waste`                             |
| AI coding observability open source            | `/`                                                                           |
| Cursor Claude Code usage dashboard self-hosted | `/for/cursor`, `/for/claude-code`                                             |
| personal API key detection AI coding tools     | `/guides/personal-vs-company-api-keys`                                        |
| UseJunction vs Helicone                        | `/compare/helicone`                                                           |



## Ranking / GSC watchlist

- Brand: `usejunction`, `use junction`, `usejunction.dev` (must not SERP to junctionpanel.dev)
- Disambiguation: `UseJunction vs Junction Panel`, `usejunction.dev redirect`
- Cluster A: `AI coding observability`, `open source AI coding analytics`
- Cluster B: `Cursor seat utilization`, `Claude Code plan usage`, `are we wasting Cursor Pro seats`
- Cluster C: `open source wakatime alternative`, `team coding insights AI`
- Cluster D: `AI coding observability vs Jellyfish`, `engineering intelligence comparison`

After a homepage brand/title release, record checks at 2, 7, 14, and 28 days:

- GSC URL Inspection reports a crawl after the release and selects `https://usejunction.dev/` as canonical.
- `site:usejunction.dev` shows the homepage with the configured UseJunction title instead of a tool-logo name.
- `usejunction` reaches page one, with top-three organic placement as the 28-day target.
- If the title remains wrong after a post-release crawl, inspect Google's rendered HTML and inbound anchor text. If the title is correct but ranking is weak, continue earning exact-brand citations instead of changing healthy crawl directives.



## Conversion signals

- Organic landings → `/signup`
- Organic → GitHub stars/clones from README links
- Contact form from `/contact` with enterprise intent



## Content cadence

After foundation: 2 guides **or** 1 compare + 1 `/for/`* page per month. Refresh FAQ answer blocks when product copy changes. Keep `/compare/junction-panel` and `llms.txt` disambiguation in sync when competitor messaging shifts.
