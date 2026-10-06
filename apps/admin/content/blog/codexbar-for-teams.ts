import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import type { BlogPost } from "@/content/types";

const text = (value: string, strong = false) => ({ text: value, strong });
const link = (value: string, href: string, strong = false) => ({ text: value, href, strong });

const images = {
  hero: {
    src: "/blog/codexbar-for-teams/cover.webp",
    alt: "CodexBar for teams: one developer's Codex and Claude Code limit gauge next to a grid of usage gauges for every developer on the team",
    width: 1200,
    height: 630,
  },
  dashboard: {
    src: "/blog/what-is-ai-coding-observability/usejunction-dashboard.webp",
    alt: "UseJunction dashboard showing AI coding usage, plan pressure, and spend for a whole team",
    width: 1400,
    height: 842,
  },
  social: {
    src: "/blog/codexbar-for-teams/social.png",
    alt: "CodexBar for teams — see Codex and Claude Code usage limits across your whole engineering team",
    width: 1200,
    height: 630,
  },
} as const;

export const CODEXBAR_FOR_TEAMS_POST: BlogPost = {
  slug: "codexbar-for-teams",
  category: "Codex Usage",
  featured: true,
  path: "/blog/codexbar-for-teams",
  title: "CodexBar for Teams: See Codex and Claude Code Limits Across Your Whole Team",
  description:
    "CodexBar shows one developer their Codex and Claude Code limits. Here is how to get the same visibility for a whole team — usage, plan resets, spend, and seats on macOS and Windows.",
  answer:
    "CodexBar is a personal menu-bar app that shows one developer their own Codex, Claude Code, and Cursor usage limits, reset windows, and spend. There is no built-in team mode. For a team, UseJunction plays the CodexBar role at the organization level: a local agent on each macOS or Windows laptop reports usage signals to one dashboard that shows who is close to their limits, which plans are underused, and what AI coding costs per developer.",
  takeaways: [
    "CodexBar is a personal macOS menu-bar app for Codex, Claude Code, and Cursor limits. It has no team or admin mode.",
    "A team needs the same signals aggregated: usage per developer, limit pressure, plan cycles, seats, and cost.",
    "UseJunction runs a local agent on each macOS or Windows laptop and rolls those signals into one dashboard.",
    "Coverage gaps are flagged, so a laptop that never reported is not mistaken for zero usage.",
    "Developers can keep CodexBar for personal checks while the team uses UseJunction for seat and spend decisions.",
  ],
  primaryKeyword: "CodexBar for teams",
  secondaryKeywords: [
    "CodexBar team",
    "CodexBar alternative for teams",
    "CodexBar for Windows",
    "Codex usage dashboard for teams",
    "Codex usage limits for my team",
    "Claude Code usage limits team",
    "team Codex rate limit monitor",
  ],
  topics: ["CodexBar", "Codex", "Claude Code", "Cursor", "AI coding observability", "Usage limits"],
  publishedAt: "2026-10-03",
  updatedAt: "2026-10-03",
  readingMinutes: 7,
  author: DINUDA_YAGGAHAVITA,
  heroImage: images.hero,
  socialImage: images.social,
  relatedPaths: [
    "/compare/codexbar",
    "/for/codex",
    "/solutions/ai-coding-plan-usage",
    "/solutions/ai-coding-seat-utilization",
    "/guides/see-team-ai-coding-usage",
    "/guides/see-plan-usage-and-waste",
  ],
  faq: [
    {
      question: "Is there a CodexBar for teams?",
      answer:
        "CodexBar itself is built for one developer on one machine. There is no team or admin mode. Teams that want the same idea — Codex and Claude Code limits, resets, and spend — across every developer use an organization-level tool such as UseJunction, which aggregates usage from a local agent on each laptop into one dashboard.",
    },
    {
      question: "Does CodexBar work on Windows?",
      answer:
        "CodexBar is a macOS menu-bar app. Community ports like Win-CodexBar exist for personal use on Windows. UseJunction’s agent runs on macOS and Windows, so a mixed-OS team gets one view.",
    },
    {
      question: "Can I see when my developers are about to hit their Codex limit?",
      answer:
        "Yes. UseJunction tracks plan cycles and quota pressure per developer and per tool, so you can see who is repeatedly hitting Codex or Claude Code limits — a signal to upgrade that seat — and who rarely uses theirs.",
    },
    {
      question: "Should developers stop using CodexBar if we roll out UseJunction?",
      answer:
        "No. They answer different questions. CodexBar tells a developer how much of their own plan is left right now. UseJunction tells the team lead and finance how plans, seats, and spend look across everyone. Running both is fine.",
    },
    {
      question: "Does UseJunction read prompts or source code?",
      answer:
        "No. The agent reports usage signals such as tool, model, tokens, cost, and plan state. There is no keystroke logging, screen capture, or traffic interception. Optional work-detail collection can be switched off per person or team.",
    },
    {
      question: "Can I self-host it?",
      answer:
        "Yes. UseJunction is self-hostable under the UseJunction Community License, or you can use the managed version at usejunction.dev.",
    },
  ],
  blocks: [
    {
      type: "paragraph",
      content: [
        text(
          "If you searched for “CodexBar for teams”, you probably already like CodexBar. It sits in the menu bar and tells you how much of your Codex or Claude Code plan is left, when it resets, and what you have spent. For one developer, that is exactly the right tool.",
        ),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The problem starts when you are responsible for "),
        text("twenty", true),
        text(" developers instead of one. CodexBar can’t answer the questions a team lead or platform engineer gets asked:"),
      ],
    },
    {
      type: "list",
      items: [
        "Who on the team keeps hitting their Codex limit by Wednesday?",
        "Which ChatGPT and Claude seats have barely been used this cycle?",
        "What does AI coding cost us per developer, across every tool?",
        "Is half the team on macOS and the other half on Windows with no visibility at all?",
      ].map((item) => [text(item, true)]),
    },
    {
      type: "paragraph",
      content: [text("This post covers what CodexBar is good at, why it stops at one person, and how to get the same view for a whole team.")],
    },
    { type: "heading", text: "What does CodexBar do?" },
    {
      type: "paragraph",
      content: [
        text(
          "CodexBar reads your local provider sessions and shows usage at a glance: session and weekly limits, reset countdowns, credits, provider status, and personal spend. It covers Codex, Claude Code, Cursor, and other providers without opening each vendor’s dashboard.",
        ),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("It answers one question very well: "),
        text("“How much of my plan do I have left?”", true),
        text(" Keep using it for that."),
      ],
    },
    { type: "heading", text: "Why doesn’t CodexBar work for a whole team?" },
    {
      type: "list",
      items: [
        [text("It is per-machine. ", true), text("Each developer sees only their own numbers. There is no place where those numbers come together.")],
        [text("It is per-OS. ", true), text("CodexBar is a macOS app. Windows and Linux developers need separate community ports, or go without.")],
        [text("It has no seat context. ", true), text("It knows your limit, not whether the company is paying for 40 seats that 25 people use.")],
        [text("It has no history for decisions. ", true), text("Renewals, upgrades, and budget questions need trends across cycles, not a live gauge.")],
        [text("“No data” is invisible. ", true), text("If someone never installed it, nobody notices. A team tool has to show coverage gaps.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Asking every developer to screenshot their menu bar before a renewal meeting is not a process. You need the same signals, collected once, in one place."),
      ],
    },
    { type: "heading", text: "What should a CodexBar for teams do?" },
    {
      type: "paragraph",
      content: [text("Take the CodexBar idea and lift it to the organization level. A team version needs to:")],
    },
    {
      type: "list",
      items: [
        [text("Aggregate usage per developer ", true), text("for Codex, Claude Code, Cursor, Copilot, and local models.")],
        [text("Track plan cycles and limit pressure ", true), text("so you can see who runs out early and who never gets close.")],
        [text("Compare seats to real usage ", true), text("so idle seats show up before renewal, not after.")],
        [text("Attribute cost ", true), text("by developer, team, tool, and model.")],
        [text("Run on every OS ", true), text("your team uses — macOS and Windows.")],
        [text("Show device coverage ", true), text("so missing data is flagged, not mistaken for zero usage.")],
        [text("Respect privacy ", true), text("— usage signals only, no prompts, code, keystrokes, or screenshots.")],
      ],
    },
    { type: "heading", text: "How do you get CodexBar-style visibility for a team?" },
    { type: "image", image: images.dashboard },
    {
      type: "paragraph",
      content: [
        link("UseJunction", "https://usejunction.dev", true),
        text(
          " is open-source AI coding observability for teams. It uses the same basic approach as CodexBar — read usage locally on the developer’s machine — but sends the signals to a shared dashboard instead of a menu bar.",
        ),
      ],
    },
    {
      type: "list",
      items: [
        [text("1. Deploy the dashboard. ", true), text("Use the managed version or self-host it under the Community License.")],
        [text("2. Enroll devices. ", true), text("Each developer runs a one-line install of the lightweight agent on macOS or Windows.")],
        [text("3. Opt in per provider. ", true), text("Collection is enabled per provider account, so personal accounts can stay out.")],
        [text("4. See the team. ", true), text("Usage, limits, plan cycles, cost, and device health for everyone, across every tool.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The questions from the top of this post now have answers: who is hitting Codex limits, which seats are idle, what AI coding costs per developer, and which laptops are not reporting. See the "),
        link("plan usage and waste guide", "/guides/see-plan-usage-and-waste"),
        text(" for a walkthrough."),
      ],
    },
    { type: "heading", text: "How does CodexBar compare to UseJunction?" },
    {
      type: "list",
      items: [
        [text("Audience: ", true), text("CodexBar — one developer. UseJunction — engineering leads, platform teams, finance.")],
        [text("Surface: ", true), text("CodexBar — menu bar and CLI. UseJunction — org dashboard.")],
        [text("Operating systems: ", true), text("CodexBar — macOS (community Windows ports). UseJunction — macOS and Windows.")],
        [text("Limits and resets: ", true), text("CodexBar — your own, live. UseJunction — everyone’s, with history.")],
        [text("Seats and cost: ", true), text("CodexBar — personal spend. UseJunction — seat utilization and cost by developer, team, tool, and model.")],
        [text("Coverage gaps: ", true), text("CodexBar — no. UseJunction — yes.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("For the full side-by-side, see "),
        link("CodexBar vs UseJunction", "/compare/codexbar", true),
        text("."),
      ],
    },
    { type: "heading", text: "Should developers keep using CodexBar?" },
    {
      type: "paragraph",
      content: [
        text(
          "This is not either/or. Developers can keep CodexBar for a quick personal check. The team uses UseJunction for adoption, plan pressure, seat waste, and spend. They read similar signals but answer different questions for different people.",
        ),
      ],
    },
    {
      type: "quote",
      content: [
        text("CodexBar tells you how much of your plan is left. A team needs to know how much of every plan is being used — and by whom.", true),
      ],
    },
    { type: "heading", text: "How do I get started?" },
    {
      type: "paragraph",
      content: [
        text("Start with one team before rolling out org-wide. "),
        link("Sign up", "/signup", true),
        text(" for the managed version, or "),
        link("self-host from GitHub", "https://github.com/use-junction/usejunction"),
        text("."),
      ],
    },
  ],
};
