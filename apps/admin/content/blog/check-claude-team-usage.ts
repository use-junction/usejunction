import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import type { BlogPost } from "@/content/types";

const text = (value: string, strong = false) => ({ text: value, strong });
const link = (value: string, href: string, strong = false) => ({ text: value, href, strong });

// TODO: add real screenshots of the Claude Analytics page (menu, export button, Claude Code leaderboard).
const images = {
  hero: {
    src: "/blog/check-claude-team-usage/cover.webp",
    alt: "Claude admin path: initials, Analytics, Export spend report — next to each team member's weekly limit usage and seat type",
    width: 1200,
    height: 630,
  },
  menu: {
    src: "/blog/check-claude-team-usage/claude-account-menu.webp",
    alt: "The Claude account menu opened from the initials in the bottom-left corner, with the Analytics entry between Organization settings and Language",
    width: 1800,
    height: 1426,
    caption: "Bottom-left initials, then Analytics. On the Team plan only Owners and Primary Owners see this entry.",
  },
  overview: {
    src: "/blog/check-claude-team-usage/claude-analytics-overview.webp",
    alt: "Claude Analytics overview for a Team plan: weekly active members out of seats, PRs created in Code, an active-members chart, and a Members table with chats per person",
    width: 2800,
    height: 2238,
    caption: "The Analytics overview on a Team plan. Active members against seats, and a Members table with chats per person.",
  },
  claudeCode: {
    src: "/blog/check-claude-team-usage/claude-code-analytics.webp",
    alt: "Claude Code analytics page on a Team plan: lines of code accepted, suggestion accept rate, activity charts, and a per-member table with an Export button",
    width: 2800,
    height: 2458,
    caption: "Claude Code analytics. The table at the bottom lists every member with lines this month, and Export downloads it as a CSV.",
  },
  limits: {
    src: "/blog/check-claude-team-usage/uj-claude-limits.webp",
    alt: "UseJunction's Claude page listing each team member with their seat type (Team Standard or Team Premium) and how much of their weekly and 5-hour limits they have used",
    width: 2800,
    height: 1972,
    caption: "UseJunction’s Claude page for an example team. One person on Standard is at 97% of their weekly limit; the Premium seat has headroom; one seat is barely used.",
  },
  people: {
    src: "/blog/check-claude-team-usage/uj-people.webp",
    alt: "UseJunction People page showing four team members with average plan usage per person across Claude, Cursor, Codex, and Copilot",
    width: 2800,
    height: 1884,
    caption: "The People view: one line per person with plan usage across every tool, so a quiet seat is easy to spot.",
  },
  accounts: {
    src: "/blog/check-claude-team-usage/uj-tool-accounts.webp",
    alt: "UseJunction Tool accounts page showing personal logins used on work machines, including nine where the company also pays for a seat",
    width: 2800,
    height: 1884,
    caption: "Tool accounts: personal logins on work machines. “Paid twice” means the company also pays for a seat that person isn’t using.",
  },
  social: {
    src: "/blog/check-claude-team-usage/social.png",
    alt: "How to check your team's usage in the Claude admin",
    width: 1200,
    height: 630,
  },
} as const;

export const CHECK_CLAUDE_TEAM_USAGE_POST: BlogPost = {
  slug: "check-claude-team-usage",
  path: "/blog/check-claude-team-usage",
  category: "Claude",
  title: "How to Check Your Team’s Usage in Claude Admin (and Pick the Right Seat for Each Person)",
  description:
    "Where Claude Team and Enterprise admins find usage analytics, how to export the per-person spend report, what the Team plan won’t show you, and how to decide between Standard and Premium seats.",
  answer:
    "To check your team’s usage in Claude, sign in as an Owner or Primary Owner, click your initials in the bottom-left corner, and choose Analytics. You’ll see active members, usage by product, and a Claude Code page at claude.ai/analytics/claude-code. For a per-person breakdown, open the Claude Code page and click Export, or, if your organization has extra usage turned on, scroll to “How much is Claude costing?” and click Export spend report. The Team plan has no per-member analytics view and no Analytics API, so it can’t tell you how close each person gets to their usage limits.",
  takeaways: [
    "Usage lives under your initials → Analytics. On Team, only Owners and Primary Owners can open it.",
    "Per-person numbers come from two exports: the Claude Code table (always there) and the spend report (only shown when extra usage is on). Both lag by about a day.",
    "Claude Code has its own dashboard at claude.ai/analytics/claude-code, with a leaderboard you can export.",
    "Team plans don’t get per-member analytics or the Analytics API. Both are Enterprise only.",
    "To choose Standard or Premium for someone, you need to know how often they hit their 5-hour and weekly limits. Claude’s admin doesn’t show that.",
  ],
  primaryKeyword: "check team usage claude admin",
  secondaryKeywords: [
    "claude team usage",
    "claude team usage analytics",
    "claude admin usage",
    "check claude team usage",
    "claude see usage per user",
    "claude team plan usage limit",
    "claude premium vs standard seat",
    "claude team standard usage limits",
    "claude for startups team plan",
  ],
  topics: ["Claude", "Claude Code", "Claude Team", "Usage analytics", "Seat utilization"],
  publishedAt: "2026-10-20",
  updatedAt: "2026-10-20",
  readingMinutes: 7,
  author: DINUDA_YAGGAHAVITA,
  heroImage: images.hero,
  socialImage: images.social,
  relatedPaths: [
    "/guides/claude-premium-vs-standard-seat",
    "/guides/claude-team-usage-limits",
    "/guides/claude-enterprise-analytics-api",
    "/guides/see-plan-usage-and-waste",
    "/solutions/ai-coding-seat-utilization",
  ],
  faq: [
    {
      question: "Where do I see team usage in Claude?",
      answer:
        "Click your initials in the bottom-left corner of claude.ai and choose Analytics. On the Team plan you need to be an Owner or Primary Owner. On Enterprise, Admins can see it too, except for spend.",
    },
    {
      question: "Can I see how much each person on my Claude Team plan uses?",
      answer:
        "Partly. The Claude Code page exports lines of code per person. If extra usage is turned on, the spend report CSV adds requests, tokens, and spend per person and per model. Neither shows how close someone gets to their 5-hour or weekly limit.",
    },
    {
      question: "Why can’t I find Member analytics on my Team plan?",
      answer:
        "Member analytics is only available to Enterprise organizations on usage-based billing. The toggle doesn’t appear on Team or seat-based Enterprise.",
    },
    {
      question: "Does the Claude Team plan have a usage API?",
      answer:
        "No. The Claude Enterprise Analytics API is Enterprise only. Teams that pay for Claude through the Claude Console (API billing) can use the separate Claude Code Analytics API with an Admin API key.",
    },
    {
      question: "How do I know if someone needs a Premium seat?",
      answer:
        "Look at how often they hit their limits. If someone runs into their weekly limit most weeks, or regularly buys extra usage, a Premium seat is likely cheaper than the friction. If they rarely use half their weekly allowance, Standard is enough.",
    },
    {
      question: "How current is the data in Claude Analytics?",
      answer:
        "Spend data refreshes once a day, so the newest numbers are from yesterday. Claude Code usage also refreshes daily.",
    },
  ],
  blocks: [
    {
      type: "paragraph",
      content: [
        text("I went looking for this myself. We had a few people on Claude Team, some of them living in Claude Code all day, and I wanted to know one thing: who actually needs a Premium seat?"),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Claude’s admin answers part of that. This post covers where everything is, what each screen tells you, and the one question it can’t answer yet."),
      ],
    },
    { type: "heading", text: "Where is team usage in the Claude admin?" },
    {
      type: "list",
      items: [
        [text("1. Sign in as an Owner or Primary Owner. ", true), text("On Team, nobody else can open Analytics. On Enterprise, Admins can too, but they don’t see spend.")],
        [text("2. Click your initials ", true), text("in the bottom-left corner.")],
        [text("3. Choose Analytics. ", true), text("The overview shows weekly active members, active members against assigned seats, and groups.")],
        [text("4. Pick a product page. ", true), text("Claude Chat, Claude Code, Claude Design, and Cowork each have their own page.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("If Analytics isn’t in the menu, check your role first. Most of the time that’s the reason."),
      ],
    },
    { type: "image", image: images.menu },
    { type: "image", image: images.overview },
    { type: "heading", text: "How do I see usage per person?" },
    {
      type: "paragraph",
      content: [
        text("On the Team plan there are two per-person exports, and you might only have one of them."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The first is always there: the Claude Code page lists every member with their lines this month, and the Export button downloads the full list as a CSV. More on that below."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The second is the spend report, which Anthropic’s "),
        link("help article", "https://support.claude.com/en/articles/12883420-view-usage-analytics-for-team-and-enterprise-plans"),
        text(" describes. It only appears when your organization has extra usage (usage credits) turned on. On the Team org we checked, which doesn’t, the whole “How much is Claude costing?” section is missing. If you have it:"),
      ],
    },
    {
      type: "list",
      items: [
        [text("1. ", true), text("Open Analytics and scroll to "), text("How much is Claude costing?", true)],
        [text("2. ", true), text("Click "), text("Export spend report", true), text(".")],
        [text("3. ", true), text("Choose month to date, last month, last 90 days, or a custom range. Custom ranges only go back 90 days.")],
        [text("4. ", true), text("Click "), text("Download", true), text(".")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Each row is one person’s use of one model over the range you picked: email, product, model, request count, prompt and completion tokens, and spend. Sort by tokens and you’ll see where the usage is within a minute. Without extra usage, you’re limited to the Claude Code export and the Members table on the overview."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Two things to keep in mind. The data is a day behind. And on seat-based Enterprise the report only counts usage above the seat allowance, so a heavy user who stays within their seat looks like they used nothing."),
      ],
    },
    { type: "heading", text: "Where is Claude Code usage?" },
    {
      type: "paragraph",
      content: [
        text("Claude Code has its own dashboard at "),
        link("claude.ai/analytics/claude-code", "https://claude.ai/analytics/claude-code"),
        text(". It shows daily active users, sessions, lines of code accepted, and suggestion accept rate. If an Owner turns on GitHub analytics under "),
        link("claude.ai/admin-settings/claude-code", "https://claude.ai/admin-settings/claude-code"),
        text(", you also get pull requests and lines shipped with Claude Code."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The leaderboard shows the top 10 people. Click "),
        text("Export all users", true),
        text(" to get everyone as a CSV. Anthropic’s "),
        link("Claude Code analytics docs", "https://code.claude.com/docs/en/analytics"),
        text(" cover the details, including how pull requests get attributed."),
      ],
    },
    { type: "image", image: images.claudeCode },
    { type: "heading", text: "What doesn’t the Team plan show?" },
    {
      type: "list",
      items: [
        [text("No per-member view. ", true), text("Member analytics is for Enterprise on usage-based billing only.")],
        [text("No API. ", true), text("The "), link("Analytics API", "/guides/claude-enterprise-analytics-api"), text(" is Enterprise only, so you can’t pull Team usage into your own dashboard.")],
        [text("No limit tracking. ", true), text("Nothing tells you how close each person gets to their 5-hour or weekly limit, or how often they hit it.")],
        [text("Only the Claude organization. ", true), text("Usage on personal Claude accounts or API keys outside your org doesn’t show up.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The third gap is the one that matters for seat decisions. Tokens tell you how much someone used. They don’t tell you whether that person kept running into a wall. There’s more on how the limits work in "),
        link("Claude Team usage limits, explained", "/guides/claude-team-usage-limits"),
        text("."),
      ],
    },
    {
      type: "table",
      caption: "What you can see about each person, by where you look",
      columns: ["", "Claude Team admin", "Claude Enterprise admin", "UseJunction"],
      rows: [
        ["Tokens and spend per person", "Spend report CSV, only with extra usage on", "Yes, CSV and API", "Estimated, per tool and model"],
        ["Claude Code activity per person", "Leaderboard export", "Leaderboard export and API", "Yes"],
        ["Seat type per person", "Members list", "Members list", "Yes, next to limit usage"],
        ["5-hour and weekly limit usage", "No", "No", "Yes, over time"],
        ["Member analytics view", "No", "Usage-based billing only", "Yes"],
        ["API or raw data access", "No", "Yes", "Yes, your own database if self-hosted"],
        ["Personal accounts outside the org", "No", "No", "Yes"],
      ],
    },
    { type: "heading", text: "Should each person get a Standard or Premium seat?" },
    {
      type: "paragraph",
      content: [
        text("A Team plan lets you mix seat types, and Premium costs several times as much as Standard. Check "),
        link("Anthropic’s Team plan page", "https://support.claude.com/en/articles/9266767-what-is-the-team-plan"),
        text(" for current prices. The goal is simple: Premium for people who keep hitting limits, Standard for everyone else. The "),
        link("Premium vs Standard seat guide", "/guides/claude-premium-vs-standard-seat"),
        text(" goes through the break-even math."),
      ],
    },
    {
      type: "paragraph",
      content: [text("Here’s the rule of thumb we use:")],
    },
    {
      type: "list",
      items: [
        [text("Hits the weekly limit most weeks: ", true), text("move them to Premium. The lost hours cost more than the seat.")],
        [text("Hits the 5-hour limit a few times a week but not the weekly one: ", true), text("keep them on Standard for now. Their usage comes in bursts, and a bigger weekly allowance won’t change much.")],
        [text("Rarely uses half the weekly allowance: ", true), text("Standard, or ask whether they need a seat at all.")],
        [text("Buys extra usage every month: ", true), text("compare what they spent on extra usage with the price difference. Often Premium is cheaper.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Look at a few weeks before deciding. One big week from a launch or a migration isn’t a pattern."),
      ],
    },
    { type: "image", image: images.people },
    { type: "heading", text: "On the Claude for Startups program?" },
    {
      type: "paragraph",
      content: [
        text("When the Claude for Startups program reopened in October 2026, the launch announcement included a free year of Claude Team with up to five Premium seats. The cohort filled within days. If you got in, that’s a good deal, but it also means nobody is checking which seats get used. When the free year ends you’ll be choosing between Standard and Premium for each person, and it helps to have a year of real limit data instead of a guess. We wrote up "),
        link("what to track during the free year", "/blog/claude-for-startups-team-seats"),
        text("."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Start tracking now. The month before renewal is too late to learn who your heavy users are."),
      ],
    },
    { type: "heading", text: "How do I see each person’s limits and seat type?" },
    { type: "image", image: images.limits },
    {
      type: "paragraph",
      content: [
        text("This is the part we built "),
        link("UseJunction", "https://usejunction.dev", true),
        text(" for. A small agent on each person’s Mac or Windows machine reads the same usage numbers Claude Code shows that person locally: their seat type (Standard or Premium), and how much of their 5-hour and weekly limits they’ve used. The dashboard puts everyone in one table."),
      ],
    },
    {
      type: "list",
      items: [
        [text("Seat type per person, ", true), text("so you can see who is on Standard and who is on Premium.")],
        [text("5-hour and weekly limit usage over time, ", true), text("so “hits the limit most weeks” is a number, not a feeling.")],
        [text("Personal accounts next to company ones, ", true), text("so usage outside your Claude org shows up too.")],
        [text("Cursor, Codex, and Copilot in the same view, ", true), text("if your team uses more than Claude.")],
      ],
    },
    { type: "image", image: images.accounts },
    {
      type: "paragraph",
      content: [
        text("It doesn’t read prompts, code, or screens. It’s open source, and you can self-host it. "),
        link("Sign up", "/signup", true),
        text(" for the managed version or "),
        link("run it from GitHub", "https://github.com/use-junction/usejunction"),
        text(". For the wider picture on idle seats, see "),
        link("how to see plan usage and seat waste", "/guides/see-plan-usage-and-waste"),
        text("."),
      ],
    },
  ],
};
