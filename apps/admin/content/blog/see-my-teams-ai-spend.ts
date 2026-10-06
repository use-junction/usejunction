import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import type { BlogPost } from "@/content/types";

const text = (value: string, strong = false) => ({ text: value, strong });
const link = (value: string, href: string, strong = false) => ({ text: value, href, strong });

const images = {
  hero: {
    src: "/blog/see-my-teams-ai-spend/cover.webp",
    alt: "Bar chart of an example team's monthly AI coding spend split by tool — Cursor, Claude Code, Codex, Copilot, and idle seats — with options to view by developer, team, or model",
    width: 1200,
    height: 630,
  },
  dashboard: {
    src: "/blog/what-is-ai-coding-observability/usejunction-dashboard.webp",
    alt: "UseJunction dashboard showing AI coding spend, usage, and plan utilization for a whole team",
    width: 1400,
    height: 842,
  },
  social: {
    src: "/blog/see-my-teams-ai-spend/social.png",
    alt: "How to see your team's AI spend — by tool, developer, team, and model",
    width: 1200,
    height: 630,
  },
} as const;

export const SEE_MY_TEAMS_AI_SPEND_POST: BlogPost = {
  slug: "see-my-teams-ai-spend",
  path: "/blog/see-my-teams-ai-spend",
  category: "AI Spend",
  title: "How to See Your Team’s AI Spend: Cursor, Claude Code, Codex, and Copilot in One View",
  description:
    "AI coding costs are spread across seats, usage-based plans, and personal accounts. Here is how to see what your team spends, who it goes to, and what is being wasted.",
  answer:
    "To see your team’s AI spend, list every AI coding tool you pay for, split the cost into seats and usage-based charges, then match each against real usage per developer. Vendor dashboards each show one tool. To see all of them together, enroll developer devices with a local agent, as UseJunction does, so cost, plan utilization, and idle seats appear in one dashboard by tool, developer, team, and model.",
  takeaways: [
    "AI coding spend is spread across seats, usage-based billing, and personal accounts, so no single invoice shows the total.",
    "Start with an inventory: every tool, every plan, and whether it is billed per seat or per use.",
    "A seat count is not usage. Compare what you pay for to what each developer actually uses.",
    "Usage-based charges need attribution by developer, team, and model, or the bill is impossible to explain.",
    "Check coverage first, so a laptop that never reported is not mistaken for a developer who uses nothing.",
  ],
  primaryKeyword: "see my team's AI spend",
  secondaryKeywords: [
    "how to track AI coding spend",
    "AI coding cost per developer",
    "AI spend visibility for engineering teams",
    "Cursor and Claude Code cost for teams",
    "AI coding tool cost monitoring",
    "AI spend dashboard",
  ],
  topics: ["AI spend", "Cursor", "Claude Code", "Codex", "Copilot", "Cost visibility"],
  publishedAt: "2026-10-03",
  updatedAt: "2026-10-03",
  readingMinutes: 7,
  author: DINUDA_YAGGAHAVITA,
  heroImage: images.hero,
  socialImage: images.social,
  relatedPaths: [
    "/solutions/ai-coding-spend-management",
    "/solutions/ai-coding-seat-utilization",
    "/guides/see-plan-usage-and-waste",
    "/guides/see-team-ai-coding-usage",
    "/guides/personal-vs-company-api-keys",
    "/compare/codexbar",
  ],
  faq: [
    {
      question: "How do I see how much my team spends on AI coding tools?",
      answer:
        "Add up seats and usage-based charges for every tool you pay for, then match them to per-developer usage. Doing this by hand across Cursor, Claude Code, Codex, and Copilot is slow, so teams use a tool such as UseJunction that gathers usage from each developer’s machine into one dashboard.",
    },
    {
      question: "Why is there no single place to see AI spend?",
      answer:
        "Each vendor bills separately and shows its own dashboard. Some admin APIs are enterprise-only, and developers on personal accounts do not appear on company invoices at all.",
    },
    {
      question: "What is the difference between seat cost and usage cost?",
      answer:
        "Seat cost is a fixed price per person per month, whether or not they use the tool. Usage cost varies with tokens, requests, or agent runs. Seats waste money when idle, and usage charges surprise you when agents run heavily.",
    },
    {
      question: "Can I see AI spend per developer without reading their code?",
      answer:
        "Yes. Cost and usage signals such as tool, model, tokens, and plan state are enough. UseJunction does not read prompts or source code, and does not log keystrokes or capture screens.",
    },
    {
      question: "How do I find wasted AI coding seats?",
      answer:
        "Compare purchased seats to active usage in each billing cycle. Seats with no activity on enrolled devices, and paid seats with no enrolled device, are the two waste signals to check before renewal.",
    },
    {
      question: "Can I self-host an AI spend dashboard?",
      answer:
        "Yes. UseJunction is open source and self-hostable under the UseJunction Community License, or you can use the managed version at usejunction.dev.",
    },
  ],
  blocks: [
    {
      type: "paragraph",
      content: [
        text("Finance forwards you the invoices and asks a simple question: "),
        text("“What are we actually paying for AI coding, and who is using it?”", true),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Most engineering leads cannot answer that in under a day. The answer is spread across Cursor, Claude Code, Codex, Copilot, and whatever developers bought on their own cards. This post shows how to put it together, what to look for, and how to make it a thing you check, not a thing you rebuild before every renewal."),
      ],
    },
    { type: "heading", text: "Why is AI coding spend so hard to see?" },
    {
      type: "list",
      items: [
        [text("Every vendor bills separately. ", true), text("There is no combined invoice, and each dashboard shows only its own product.")],
        [text("Seats and usage are mixed. ", true), text("Some tools charge a flat seat price, some charge per token or request, and many do both.")],
        [text("Admin APIs are uneven. ", true), text("Team-wide usage data is often limited to higher plans.")],
        [text("Personal accounts are invisible. ", true), text("A developer on their own Claude or ChatGPT plan never shows up on a company invoice.")],
        [text("Agent workflows change the math. ", true), text("A long agent run can cost far more than autocomplete, and a seat price hides that until the bill arrives.")],
      ],
    },
    { type: "heading", text: "What should you measure?" },
    {
      type: "paragraph",
      content: [text("Four numbers answer most spend questions. Get these before you build anything else:")],
    },
    {
      type: "list",
      items: [
        [text("Total spend by tool. ", true), text("Seats plus usage charges, per month, for every product.")],
        [text("Spend by developer and team. ", true), text("Where the money concentrates, and whether that matches where the work is.")],
        [text("Seat utilization. ", true), text("Paid seats compared to seats with real activity this billing cycle.")],
        [text("Coverage. ", true), text("How many developers you can actually see. Missing data looks exactly like zero usage.")],
      ],
    },
    { type: "heading", text: "How do you see your team’s AI spend by hand?" },
    {
      type: "paragraph",
      content: [text("If you want to start today with no new tool, this works for a small team:")],
    },
    {
      type: "list",
      items: [
        [text("1. List every tool. ", true), text("Ask each developer, then check card statements for personal subscriptions expensed back.")],
        [text("2. Export each invoice. ", true), text("Split the lines into seats and usage-based charges.")],
        [text("3. Pull usage per user. ", true), text("Use each vendor’s admin view where it exists.")],
        [text("4. Put it in one sheet. ", true), text("One row per developer per tool, with cost and last activity.")],
        [text("5. Mark the gaps. ", true), text("Anyone you could not find data for goes in a separate column.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("It works, but it is a one-off. By next month it is stale, and the developers on personal accounts are still missing. See the "),
        link("plan usage and waste guide", "/guides/see-plan-usage-and-waste"),
        text(" for how to read the results."),
      ],
    },
    { type: "heading", text: "How do you see AI spend across every tool automatically?" },
    { type: "image", image: images.dashboard },
    {
      type: "paragraph",
      content: [
        link("UseJunction", "https://usejunction.dev", true),
        text(" is open-source AI coding observability for teams. A lightweight local agent on each developer’s macOS or Windows laptop reports usage signals, and an admin dashboard rolls them up."),
      ],
    },
    {
      type: "list",
      items: [
        [text("Deploy the dashboard. ", true), text("Use the managed version or self-host it.")],
        [text("Enroll devices. ", true), text("Developers run a one-line install.")],
        [text("Choose what is collected. ", true), text("Collection is opt-in per provider account.")],
        [text("See spend your way. ", true), text("By tool, developer, team, or model, with plan cycles and idle seats alongside.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("It reads usage signals only. No prompts, source code, keystrokes, screenshots, or traffic interception. Work-detail collection is optional and can be turned off per person or team."),
      ],
    },
    { type: "heading", text: "What should you do once you can see it?" },
    {
      type: "list",
      items: [
        [text("Reclaim idle seats ", true), text("before the renewal date, not after.")],
        [text("Move heavy users to the right plan. ", true), text("Developers who hit limits every week are asking for a bigger plan; those who never get close can drop one.")],
        [text("Bring personal accounts in. ", true), text("See the "), link("personal vs company keys guide", "/guides/personal-vs-company-api-keys"), text(".")],
        [text("Set a monthly review. ", true), text("Fifteen minutes on the dashboard beats a quarterly scramble.")],
        [text("Add policy last. ", true), text("Controls work better once you know what you are controlling.")],
      ],
    },
    {
      type: "quote",
      content: [
        text("You cannot cut a bill you cannot explain. Start by seeing it, per tool and per person, before you decide what to change.", true),
      ],
    },
    { type: "heading", text: "How do I get started?" },
    {
      type: "paragraph",
      content: [
        text("Pilot with one team first. "),
        link("Sign up", "/signup", true),
        text(" for the managed version or "),
        link("self-host from GitHub", "https://github.com/use-junction/usejunction"),
        text(". For the full picture of how this fits into spend management, see "),
        link("AI coding spend management", "/solutions/ai-coding-spend-management"),
        text("."),
      ],
    },
  ],
};
