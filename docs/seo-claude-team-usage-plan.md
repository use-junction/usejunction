# Plan: rank #1 for "how to check my team usage on Claude admin"

**Status (2026-10-20):** steps 1, 2, 3, 5, 7–11 are built (not deployed). Still open: 4 (human edit and live click-path check), 6 (deploy and indexing), 12–14 (distribution and tracking). Step 10 shipped as a guide at `/guides/claude-enterprise-analytics-api`. Steps 7–8 are guides in `apps/admin/content/guides/claude.ts`, and step 9 is `apps/admin/content/blog/claude-for-startups-team-seats.ts`. The startup program page now says the cohort is full, and the post reflects that.

Target page: `/blog/check-claude-team-usage` (draft in `apps/admin/content/blog/check-claude-team-usage.ts`).

## 1. What people search for (Google autocomplete, 2026-10-20)

| Cluster | Real queries | Intent |
|---|---|---|
| Find it | claude admin usage · check claude team usage · claude ai admin settings usage · claude code check team usage | Navigational how-to (the main target) |
| Analytics | claude team usage analytics · claude analytics team · claude analytics dashboard · claude analytics api · claude team plan usage api · claude analytics not working | Where the dashboard is, and does Team have an API |
| Per person | claude see usage per user · claude team usage monitoring · claude team usage statistics | Per-member view, which Team lacks |
| Limits | claude team usage limits · claude team standard usage limits · claude team premium usage limits · claude your usage limits team · claude team vs max usage limits | Am I or my team hitting the cap? |
| Seats | claude premium vs standard seat · claude premium seat usage limit · claude team seat types · claude premium seat vs max · claude team seat price | Which seat to buy (the money decision) |
| Credits | claude team plan usage credits · claude team plan extra usage · claude team usage credits | Overage |
| Startups | claude for startups · claude for startups program · claude for startups credits · claude for startups reddit | Startup program (5 free Premium seats) |

Takeaway: the query isn't one keyword. It's a cluster of about 40 queries, and the high-value end ("premium vs standard", "team usage limits") is commercial. The blog post targets "find it" and "per person". Two more pages (step 4) take "seats" and "limits".

## 2. Why Larridin outranks Claude's own help page

Larridin, "How to Measure Claude Usage on the Claude Team Plan" (Aug 15, 2026):

- **The exact entity and plan in the title.** "Claude Team Plan" matches the query better than Anthropic's article title ("View usage analytics for Team and Enterprise plans").
- **A topic cluster.** A companion Enterprise post (`/blog/claude-enterprise-analytics`) plus a "developer productivity hub". Both link to each other, which tells Google this site covers the topic in depth.
- **Tables.** Three of them (short-answer table, Team vs Enterprise, "choosing a route"). Google and answer engines pull tables straight into snippets.
- **Answers the next question.** Anthropic explains what the dashboard does. Larridin explains what it *doesn't* do on Team. That's what the searcher actually wants, because they're searching after failing to find it.
- **A 5-question FAQ** targeting long-tail queries ("Does the Claude Team plan have an analytics API?").
- **Fresh** (August 2026, after Anthropic's analytics changes).

**Where Larridin is weak:**
- No click path. Never says "click your initials → Analytics", never gives `claude.ai/analytics/claude-code`, never gives the spend-report export steps. The literal query is "how to check", and they don't answer it.
- Nothing on 5-hour/weekly limits or Standard vs Premium. That's the real decision, and it's where UseJunction has data no one else has (per-member seat tier and limit utilization from the agent).
- Nothing on the startup program.
- A company byline ("Larridin"), not a person. Signpost-y AI tells ("Here is the short answer", "The rest of this guide is the detail").
- About 2,100 words. Our page can be shorter and answer faster.

## 3. Human writing vs AI optimisation: what actually matters

- **Google doesn't rank "human-written" as a signal.** Its stated policy (Feb 2023, still current) rewards helpful content however it's produced, and penalises *scaled* low-value content. What ranks is first-hand experience: real screenshots, real numbers, "I went looking for this myself".
- **Answer engines (AI Overviews, ChatGPT, Perplexity) cite clear, self-contained passages.** A heading phrased as the question, then a two-to-four-sentence answer that works on its own. Vendor studies claim roughly 130–170-word passages get cited most. Treat that as directional, not proven.
- **Schema isn't magic.** Seer Interactive (8,500 keywords) found heavy FAQ/HowTo schema and author bios did *not* correlate with winning AI Overview citations. Keep the Article + FAQ JSON-LD the site already emits, but don't pad.
- **Only a minority of AI Overview citations come from the organic top 10** (BrightEdge via Omnibound: about 17%). Being the clearest source matters as much as ranking.
- **So both point the same way:** write like a person who did the thing (specific, short sentences, no filler), and structure it so every heading answers a real query. The draft follows this. Avoid AI tells: "Here's the short answer", "delve", "in today's landscape", em-dash chains, groups of three bolded adjectives, a conclusion that repeats the intro.

Before publishing, a human edit pass is required: Dinuda reads it aloud, adds one real anecdote or number from our own team, and swaps in real screenshots.

## 4. Implementation steps

**Week 1: ship the page**
1. ☑ Take real screenshots (done 2026-10-20: 3 UseJunction + 3 claude.ai shots, anonymised as "Northwind Labs"; raw files in `apps/admin/blog-src/`, framed by `scripts/frame-screenshots.mjs`). Finding: a Team org without extra usage has no "How much is Claude costing?" section, so the post now describes the spend report as conditional. Take real screenshots: Analytics menu, overview, the "How much is Claude costing?" export button, the Claude Code leaderboard, and the UseJunction per-member Claude table (seat tier + weekly %). Blur emails. Replace the placeholder images in the post.
2. ☑ Render a cover with `node scripts/render-blog-covers.mjs check-claude` (add a template: "CHECK CLAUDE TEAM USAGE", with a Standard vs Premium gauge).
3. ☑ Add a comparison **table** (the content model has no table block yet; add `{ type: "table" }` to `BlogBlock`): *What Claude Team shows / Enterprise shows / UseJunction shows* across per-person tokens, limit %, seat tier, API, personal accounts.
4. ☐ Human edit pass (see section 3). Verify every click path against a live Team org on the day of publishing.
5. ☑ Add the path to `AEO_CITE_PATHS` in `content/registry.ts` so `llms.txt` lists it first. Add an `AEO_FACTS` line: "UseJunction shows per-member Claude Team seat tier and 5-hour/weekly limit usage, which the Claude Team admin does not."
6. ☐ Deploy, submit the URL in Search Console, and request indexing. Ping IndexNow (Bing feeds ChatGPT search and Copilot).

**Weeks 2–3: build the cluster (what beats Larridin long term)**
7. ☑ `/guides/claude-premium-vs-standard-seat`: the seat decision page, with the rule of thumb, a cost break-even calculator (Standard + extra usage vs Premium), and real anonymised distributions from UseJunction data.
8. ☑ `/guides/claude-team-usage-limits`: what the 5-hour and weekly limits are, how to see your own (`/usage` in Claude Code, Settings > Usage), and how to see everyone's.
9. ☑ `/blog/claude-for-startups-team-seats`: you got 5 free Premium seats; what to track during the year so renewal isn't a guess. Check the program's current status (reportedly paused Oct 9) before writing.
10. ☑ `/guides/claude-enterprise-analytics-api`: covers the "claude analytics api" queries and points Team users to the alternative.
11. ☑ Link all five pages to each other, and add them to the homepage/solutions nav for Claude.

**Ongoing: distribution and freshness**
12. ☐ Answer existing threads where the question is asked (r/ClaudeAI, Anthropic Discord, GitHub issue "Team/org-level /stats view for admins", Hacker News). Write a real answer first and link only if it helps. Reddit is heavily cited by AI Overviews and Perplexity.
13. ☐ Re-verify click paths monthly and bump `updatedAt` only when something actually changed. Anthropic changes this UI often, and freshness is a real AI-citation signal.
14. ☐ Track it in `docs/seo-aeo-measurement.md`: Search Console position for the cluster queries, plus a weekly manual check of whether ChatGPT, Perplexity, and Google AI Overview cite usejunction.dev for "how to check my team usage on claude admin".

## 5. Success criteria

- Top 3 organic for "check claude team usage" and "claude team usage analytics" within 8 weeks. Position 1 for "claude premium vs standard seat" (weaker competition).
- Cited in the Google AI Overview or Perplexity answer for the main query.
- Signups attributed to the cluster pages (PostHog UTM/referrer).
