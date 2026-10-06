import type { ContentPage } from "@/content/types";
import { TEAM_PRICE_PER_DEV_USD } from "@/lib/saas-billing/entitlements";

export const compareWakatime: ContentPage = {
  kind: "compare",
  slug: "wakatime",
  path: "/compare/wakatime",
  title: "WakaTime Alternative for AI Coding Teams: UseJunction vs WakaTime",
  description:
    "Looking for a WakaTime alternative for AI coding teams? Compare editor time tracking with UseJunction’s cross-tool AI usage, cost, plan, and seat visibility.",
  primaryKeyword: "WakaTime alternative for AI coding teams",
  secondaryKeywords: ["UseJunction vs WakaTime", "WakaTime alternative AI coding", "open source WakaTime alternative"],
  updatedAt: "2026-08-04",
  answer:
    "WakaTime measures coding time and language activity. UseJunction measures AI coding tool usage, cost, plan and seat utilization, latency, and device health across an engineering organization. They solve different jobs; teams searching for a WakaTime alternative should choose based on whether they need editor-time metrics or AI fleet and spend visibility.",
  compareOtherName: "WakaTime",
  compareRows: [
    { feature: "Primary job", usejunction: "AI coding observability", other: "Editor time tracking" },
    { feature: "AI tool & model usage", usejunction: "Yes — org-wide", other: "Not the focus" },
    { feature: "Plan / seat utilization", usejunction: "Yes — cycle views", other: "No" },
    { feature: "Cost & latency attribution", usejunction: "Yes", other: "No" },
    { feature: "Hours by project/language", usejunction: "No", other: "Yes" },
    { feature: "Self-hosted open source", usejunction: "Community License self-host", other: "Primarily SaaS plugins" },
    { feature: "Prompt storage", usejunction: "Not by default", other: "N/A (not LLM telemetry)" },
  ],
  sections: [
    {
      heading: "Pick UseJunction when your problem is AI coding spend",
      body: [
        "You need to see Cursor, Claude Code, Codex, Copilot, and local model usage across the organization.",
        "You care about cost per developer, seat waste, quota pressure, tool overlap, and personal versus company keys.",
        "You want to self-host operational telemetry and keep richer work detail optional.",
      ],
    },
    {
      heading: "Pick WakaTime when",
      body: [
        "You need fine-grained time-in-editor metrics by project and language.",
        "AI spend and tool fleet visibility are not your primary question.",
      ],
    },
  ],
  faq: [
    {
      question: "Can UseJunction replace WakaTime?",
      answer:
        "Only if your goal shifted from time tracking to AI coding observability. For hours-based productivity metrics, keep WakaTime (or similar) and add UseJunction for AI tools.",
    },
  ],
  relatedPaths: [
    "/solutions/ai-coding-spend-management",
    "/solutions/ai-coding-seat-utilization",
    "/compare/engineering-intelligence",
    "/guides/open-source-wakatime-alternative-for-ai-coding",
    "/guides/see-team-ai-coding-usage",
    "/compare/helicone",
  ],
};

export const compareCodexbar: ContentPage = {
  kind: "compare",
  slug: "codexbar",
  path: "/compare/codexbar",
  title: "CodexBar for Teams: Personal Limits vs Team AI Spend Visibility",
  description:
    "Looking for CodexBar for teams? Compare a personal AI coding limit and spend monitor with UseJunction’s organization-level usage, seats, plans, and device coverage.",
  primaryKeyword: "CodexBar for teams",
  secondaryKeywords: [
    "CodexBar alternative for teams",
    "AI coding limits for teams",
    "Codex usage dashboard for teams",
    "AI coding spend visibility",
  ],
  updatedAt: "2026-08-04",
  answer:
    "CodexBar is a useful personal menu-bar and CLI monitor for AI coding limits, reset windows, credits, and spend. UseJunction solves the team problem: understand which developers use Codex, Claude Code, Cursor, Copilot, and other tools, how plans and seats are utilized, and where organization-level cost or coverage gaps exist.",
  compareOtherName: "CodexBar",
  compareRows: [
    { feature: "Primary audience", usejunction: "Engineering and platform teams", other: "Individual developers" },
    { feature: "Primary surface", usejunction: "Organization dashboard", other: "macOS menu bar and CLI" },
    { feature: "Cross-developer adoption", usejunction: "Yes — enrolled devices", other: "No — personal view" },
    { feature: "Seat and plan utilization", usejunction: "Yes — team context", other: "Personal limits and resets" },
    { feature: "Cost attribution", usejunction: "By developer, team, tool, and model", other: "Personal spend and scans" },
    { feature: "Device coverage health", usejunction: "Yes", other: "No" },
    { feature: "Privacy posture", usejunction: "Self-hostable; work detail optional", other: "Local provider-session access" },
  ],
  sections: [
    {
      heading: "Use CodexBar for personal limit awareness",
      body: [
        "CodexBar fits an individual developer who wants session or weekly usage, reset countdowns, credits, provider status, and personal spend visible without opening each provider dashboard.",
        "It is especially useful when the question is: “How much of my personal plan is left?”",
      ],
    },
    {
      heading: "Use UseJunction for team AI spend and seat decisions",
      body: [
        "UseJunction fits engineering and platform teams that need an organization-wide answer: who uses each AI tool, what it costs, which seats are idle, which devices are not covered, and where plan pressure is building.",
        "UseJunction is not a drop-in CodexBar replacement. The products overlap around usage signals but serve different buyers and operating decisions.",
      ],
    },
    {
      heading: "A complementary setup",
      body: [
        "A developer can use CodexBar for personal awareness while a platform team uses UseJunction for cross-tool adoption, cost attribution, seat utilization, and device health.",
        "Start with visibility before adding policy: no gateway or traffic interception is required to begin with the local agent and available usage signals.",
      ],
    },
  ],
  faq: [
    {
      question: "Is UseJunction the same as CodexBar?",
      answer:
        "No. CodexBar is primarily a personal menu-bar and CLI monitor for AI coding limits and spend. UseJunction is an organization-level observability product for team usage, cost, plans, seats, and device coverage.",
    },
    {
      question: "Can UseJunction show Codex usage for a team?",
      answer:
        "UseJunction is designed to attribute available Codex usage signals to enrolled developers and teams, alongside Cursor, Claude Code, Copilot, and other supported tools.",
    },
    {
      question: "Do I need to choose between CodexBar and UseJunction?",
      answer:
        "No. CodexBar can answer a developer’s personal limit question while UseJunction answers the platform team’s organization-wide spend, seat, plan, and coverage questions.",
    },
  ],
  relatedPaths: [
    "/solutions/ai-coding-spend-management",
    "/solutions/ai-coding-seat-utilization",
    "/for/codex",
    "/guides/see-plan-usage-and-waste",
  ],
};

export const compareHelicone: ContentPage = {
  kind: "compare",
  slug: "helicone",
  path: "/compare/helicone",
  title: "UseJunction vs Helicone",
  description:
    "Helicone focuses on LLM gateway observability. UseJunction focuses on AI coding tools on developer devices—usage, plans, and fleet health.",
  primaryKeyword: "UseJunction vs Helicone",
  secondaryKeywords: ["AI coding observability vs LLM gateway"],
  updatedAt: "2026-07-19",
  answer:
    "Helicone is strong for request-level LLM observability through a gateway or proxy. UseJunction is built for platform teams that need visibility into AI coding tools on laptops—adoption, plan utilization, device health, and cost attribution—often without forcing all traffic through a central gateway first.",
  compareOtherName: "Helicone",
  compareRows: [
    { feature: "Primary surface", usejunction: "Developer devices + AI coding tools", other: "LLM gateway / proxy" },
    { feature: "Cursor / IDE agents", usejunction: "First-class", other: "Indirect if proxied" },
    { feature: "Seat / plan utilization", usejunction: "Yes", other: "Not the core job" },
    { feature: "Device enrollment health", usejunction: "Yes", other: "No" },
  ],
  sections: [
    {
      heading: "Complementary stacks",
      body: [
        "Some orgs run a gateway for server-side LLM apps and UseJunction for coding-tool fleets. Visibility before control still applies.",
      ],
    },
  ],
  faq: [
    {
      question: "Do I need a gateway to use UseJunction?",
      answer:
        "No. Start with the local agent and usage signals. Gateway-style control is optional roadmap after you have context.",
    },
  ],
  relatedPaths: ["/compare/portkey", "/compare/langfuse", "/guides/see-team-ai-coding-usage"],
};

export const comparePortkey: ContentPage = {
  kind: "compare",
  slug: "portkey",
  path: "/compare/portkey",
  title: "UseJunction vs Portkey",
  description:
    "Portkey is an AI gateway and control plane. UseJunction starts with observability of AI coding tools across your eng org.",
  primaryKeyword: "UseJunction vs Portkey",
  secondaryKeywords: ["AI gateway vs AI coding observability"],
  updatedAt: "2026-07-19",
  answer:
    "Portkey emphasizes routing, guardrails, and gateway control for LLM traffic. UseJunction emphasizes seeing which AI coding tools your team actually uses—cost, plans, and device health—before you impose control.",
  compareOtherName: "Portkey",
  compareRows: [
    { feature: "Control vs visibility first", usejunction: "Visibility before control", other: "Gateway control plane" },
    { feature: "Coding-tool fleet", usejunction: "Native focus", other: "If traffic is gated" },
    { feature: "Open-source self-host coding ops", usejunction: "Community License product focus", other: "Different product shape" },
  ],
  sections: [
    {
      heading: "When UseJunction fits",
      body: [
        "You do not yet know tool sprawl, personal keys, or seat waste—and need evidence before routing or policy.",
      ],
    },
  ],
  faq: [],
  relatedPaths: ["/compare/helicone", "/compare/langfuse", "/"],
};

export const compareLangfuse: ContentPage = {
  kind: "compare",
  slug: "langfuse",
  path: "/compare/langfuse",
  title: "UseJunction vs Langfuse",
  description:
    "Langfuse is LLM tracing and evals for applications. UseJunction is open-source AI coding observability for teams.",
  primaryKeyword: "UseJunction vs Langfuse",
  secondaryKeywords: ["LLM tracing vs AI coding observability"],
  updatedAt: "2026-07-19",
  answer:
    "Langfuse helps product and ML teams trace and evaluate LLM applications. UseJunction helps platform and eng leaders see AI coding tool usage across developers’ machines. Different buyers, different telemetry.",
  compareOtherName: "Langfuse",
  compareRows: [
    { feature: "Buyer", usejunction: "Platform / eng leadership", other: "App / ML teams" },
    { feature: "Telemetry", usejunction: "Coding tools, seats, devices", other: "App traces, evals" },
    { feature: "Plan seat waste", usejunction: "Yes", other: "No" },
  ],
  sections: [
    {
      heading: "Can they coexist?",
      body: [
        "Yes. Trace your product’s LLM features with Langfuse; observe your eng team’s coding tools with UseJunction.",
      ],
    },
  ],
  faq: [],
  relatedPaths: ["/compare/helicone", "/guides/see-team-ai-coding-usage"],
};

export const compareEngineeringIntelligence: ContentPage = {
  kind: "compare",
  slug: "engineering-intelligence",
  path: "/compare/engineering-intelligence",
  title: "AI Coding Observability vs Jellyfish, DX, and LinearB",
  description:
    "Which tool fits your search? Seat waste and AI coding cost (UseJunction) vs delivery bottlenecks (LinearB), DevEx (DX), or eng-finance reporting (Jellyfish).",
  primaryKeyword: "AI coding observability vs Jellyfish DX LinearB",
  secondaryKeywords: [
    "Cursor seat utilization",
    "how to see Cursor plan usage for my team",
    "are we wasting Cursor Pro seats",
    "engineering intelligence platform comparison",
    "AI coding tool cost monitoring",
  ],
  updatedAt: "2026-07-25",
  answer:
    "UseJunction answers searches about AI coding tool cost, seat utilization, and multi-vendor fleet visibility on developer laptops. Jellyfish answers engineering-finance and R&D capitalization searches. DX answers developer experience and retention searches. LinearB answers delivery speed and PR bottleneck searches. Match the tool to the problem you are searching for—not the category title.",
  sections: [
    {
      heading: "Search: “Why is our Cursor bill so high?” / “Are we wasting seats?”",
      body: [
        "This is the fastest-growing eng-leadership search cluster in 2026: Cursor seat utilization, Claude Code plan usage, AI coding tool cost monitoring, and subscription cycle waste.",
        "Native vendor dashboards show one product at a time. Enterprise APIs are often plan-gated. Finance sees invoices; engineering cannot explain per-user spend or idle seats before renewal.",
        "UseJunction is built for this job: multi-tool AI coding observability—cost, plan cycles, quota pressure, enrollment health, and personal-vs-company key signals across Cursor, Claude Code, Codex, Copilot, and local models.",
      ],
    },
    {
      heading: "Search: “PRs sit for days” / “cycle time” / “DORA metrics”",
      body: [
        "When delivery is stuck—review pickup time, cycle time by stage, deployment frequency—teams search for workflow and DORA visibility, not AI seat waste.",
        "LinearB fits: PR analytics, cycle-time breakdowns, gitStream automation, and action on bottlenecks.",
        "LinearB does not reconcile Cursor + Claude spend or show org-wide AI tool sprawl.",
      ],
    },
    {
      heading: "Search: “Why are developers leaving?” / “developer experience survey”",
      body: [
        "When attrition, friction, and tool satisfaction are the fire, teams need structured DevEx measurement—not a cost ledger.",
        "DX fits: Core 4 framework, Developer Experience Index (DXI), and research-backed surveys that surface friction before it shows up in exit interviews.",
        "DX does not show per-developer AI coding cost or which paid seats sit idle.",
      ],
    },
    {
      heading: "Search: “R&D capitalization” / “where did eng investment go?”",
      body: [
        "When finance and the board need allocation, investment narratives, and audit-ready engineering spend, the search is business alignment—not laptop-level AI tool telemetry.",
        "Jellyfish fits: engineering-to-business reporting, R&D capitalization support, and allocation views for executives.",
        "Jellyfish is not a multi-vendor AI coding fleet monitor for seat waste and quota pressure.",
      ],
    },
    {
      heading: "When to stack tools",
      body: [
        "Many orgs need more than one layer: LinearB for delivery, DX for periodic DevEx pulses, UseJunction for AI coding spend before renewal.",
        "UseJunction complements Helicone and Langfuse too—those observe application LLM traffic; UseJunction observes AI coding tools on developer machines.",
      ],
    },
    {
      heading: "Quick decision guide",
      body: [
        "Board/finance wants eng allocation → Jellyfish.",
        "People are frustrated / leaving → DX.",
        "PRs stall and cycle time is the KPI → LinearB.",
        "AI tool invoices, seat waste, multi-tool sprawl → UseJunction.",
      ],
    },
  ],
  faq: [
    {
      question: "Does UseJunction replace Jellyfish, DX, or LinearB?",
      answer:
        "No. UseJunction focuses on AI coding observability—tool usage, cost, plan utilization, and device health across vendors. Jellyfish, DX, and LinearB focus on finance alignment, developer experience, and delivery workflow respectively. Many teams use complementary tools.",
    },
    {
      question: "We already have LinearB. Do we still need UseJunction?",
      answer:
        "If finance asks about Cursor or Claude spend and seat waste, yes—LinearB does not answer that search. LinearB and UseJunction solve different problems and can run together.",
    },
    {
      question: "How do I see Cursor plan usage for my whole team?",
      answer:
        "UseJunction enrolls a local agent on developer devices and rolls up Cursor-related usage, seat utilization, and subscription-cycle signals in one org-wide dashboard.",
    },
    {
      question: "Are we wasting Cursor Pro seats?",
      answer:
        "Compare purchased seats and quotas to verified usage and enrollment coverage in UseJunction. Idle seats on enrolled devices—and paid seats without enrolled devices—surface as waste signals before renewal.",
    },
    {
      question: "Is UseJunction an engineering intelligence platform?",
      answer:
        "UseJunction is AI coding observability—a narrower, deeper answer to multi-tool AI spend and seat waste. It is not a full engineering intelligence suite for DORA, DevEx surveys, or R&D capitalization.",
    },
    {
      question: "Can we self-host UseJunction?",
      answer:
        "Yes. UseJunction is open source under the UseJunction Community License and runs on infrastructure you control — Postgres and the Next.js control plane.",
    },
  ],
  relatedPaths: [
    "/blog/ai-coding-observability-vs-jellyfish-dx-linearb",
    "/guides/see-plan-usage-and-waste",
    "/guides/see-team-ai-coding-usage",
    "/guides/open-source-wakatime-alternative-for-ai-coding",
    "/guides/personal-vs-company-api-keys",
    "/compare/wakatime",
    "/compare/helicone",
    "/for/cursor",
    "/for/claude-code",
  ],
};

export const compareJunctionPanel: ContentPage = {
  kind: "compare",
  slug: "junction-panel",
  path: "/compare/junction-panel",
  title: "UseJunction vs Junction Panel: Spend Analytics vs Agent Remote Control",
  description:
    "UseJunction (usejunction.dev) is AI coding spend and seat analytics for teams. Junction Panel (junctionpanel.dev) is a different product for remote-controlling AI coding agents. No redirect—unrelated brands that share a word.",
  primaryKeyword: "UseJunction vs Junction Panel",
  secondaryKeywords: [
    "usejunction.dev",
    "Junction Panel",
    "junctionpanel.dev",
    "AI coding spend management",
    "AI coding agent control plane",
  ],
  updatedAt: "2026-09-04",
  answer:
    "UseJunction and Junction Panel are unrelated products. UseJunction at https://usejunction.dev is open-source AI coding observability for teams—usage, cost, plan and seat utilization, and device health across Cursor, Claude Code, Codex, Copilot, and more. Junction Panel at https://junctionpanel.dev is a browser/phone control surface for supervising local AI coding agents. usejunction.dev does not redirect to junctionpanel.dev.",
  compareOtherName: "Junction Panel",
  compareRows: [
    { feature: "Official site", usejunction: "https://usejunction.dev", other: "https://junctionpanel.dev" },
    { feature: "Primary job", usejunction: "AI coding spend & usage analytics", other: "Remote control of AI coding agents" },
    { feature: "Buyer", usejunction: "Engineering / platform / finance teams", other: "Individual developers supervising agents" },
    { feature: "Seat / plan waste", usejunction: "Yes — core product", other: "Not the focus" },
    { feature: "Tool overlap & idle seats", usejunction: "Yes", other: "No" },
    { feature: "Live agent session control", usejunction: "No", other: "Yes — approvals, diffs, mobile supervision" },
    { feature: "Self-hostable observability", usejunction: "Yes — Community License", other: "Local-first daemon + cloud control surface" },
    { feature: "Pricing model", usejunction: `Self-host free (≤5 seats) or Managed $${TEAM_PRICE_PER_DEV_USD}/dev/mo`, other: "Free / Core / Switchboard tiers" },
  ],
  sections: [
    {
      heading: "Why search and AI assistants mix them up",
      body: [
        "Both brands include the word “Junction” and both talk about Claude Code, Codex, and developer machines. Answer engines often collapse that into one entity and invent a redirect. The sites are separate; the products solve different jobs.",
        "If you typed usejunction.dev and landed on agent remote-control pricing (Free / Core / Switchboard), you were looking at Junction Panel—not UseJunction.",
      ],
    },
    {
      heading: "Pick UseJunction when",
      body: [
        "You need org-wide visibility into which AI coding tools developers use and what they cost.",
        "You care about idle seats, plan-limit pressure, tool overlap, and renewal decisions.",
        "You want self-hosted AI coding observability without keystroke or browser surveillance.",
      ],
    },
    {
      heading: "Pick Junction Panel when",
      body: [
        "You want to watch and approve AI coding agent runs from a browser or phone.",
        "Your problem is supervising Claude Code / Codex / OpenCode sessions—not measuring subscription waste.",
      ],
    },
  ],
  faq: [
    {
      question: "Does usejunction.dev redirect to junctionpanel.dev?",
      answer:
        "No. https://usejunction.dev serves UseJunction. https://junctionpanel.dev serves Junction Panel. Only www.usejunction.dev redirects to the usejunction.dev apex.",
    },
    {
      question: "Is UseJunction related to Junction Panel?",
      answer:
        "No. They are unrelated products from different teams. The shared “Junction” substring causes brand confusion in search and LLM answers.",
    },
    {
      question: "What is UseJunction’s pricing?",
      answer:
        `Self-host under the UseJunction Community License for up to 5 seats free, or Managed at $${TEAM_PRICE_PER_DEV_USD} per active developer per month. That is not Junction Panel’s Free / Core / Switchboard pricing.`,
    },
  ],
  relatedPaths: [
    "/",
    "/solutions/ai-coding-spend-management",
    "/solutions/ai-coding-seat-utilization",
    "/compare/wakatime",
    "/compare/codexbar",
    "/blog/what-is-ai-coding-observability",
  ],
};

export const COMPARE_PAGES: ContentPage[] = [
  compareEngineeringIntelligence,
  compareJunctionPanel,
  compareWakatime,
  compareCodexbar,
  compareHelicone,
  comparePortkey,
  compareLangfuse,
];
