import type { ContentPage } from "@/content/types";

export const guideSeePlanUsage: ContentPage = {
  kind: "guide",
  slug: "see-plan-usage-and-waste",
  path: "/guides/see-plan-usage-and-waste",
  title: "How to See AI Coding Plan Usage and Seat Waste",
  description:
    "See Cursor, Claude Code, and Copilot plan usage across your team—compare purchased seats to real utilization and spot waste before renewal.",
  primaryKeyword: "how to see plan usage AI coding team",
  secondaryKeywords: [
    "Cursor seat utilization",
    "Claude Code plan usage",
    "wasting Cursor Pro seats",
    "subscription cycle utilization",
    "AI coding quota pressure",
  ],
  updatedAt: "2026-07-19",
  answer:
    "UseJunction shows your team’s AI coding plan usage and seat waste by combining enrolled-device coverage with subscription cycle utilization. You compare purchased seats and quotas against verified usage so engineering and finance leads can see who is near limits, who is idle, and where spend is concentrated.",
  sections: [
    {
      heading: "Who this is for",
      body: [
        "Engineering managers and platform leads who renew Cursor, Claude, Codex, or Copilot seats and cannot see org-wide utilization in one place.",
        "Finance partners who need evidence before cutting or expanding AI coding subscriptions.",
      ],
    },
    {
      heading: "What you can see",
      body: [
        "Purchased seats versus active usage for supported tools and subscription cycles.",
        "Quota pressure: who is near or over plan limits during the current cycle.",
        "Per-developer cost and model attribution so idle seats and heavy users are obvious.",
        "Device and agent coverage so “no usage” is not confused with “not enrolled.”",
      ],
    },
    {
      heading: "How it works",
      body: [
        "Developers enroll a lightweight local agent. UseJunction reports usage signals (tool, model, tokens, latency, status). Richer work detail is optional and can be turned off.",
        "The dashboard rolls usage into subscription cycles so you can judge intentionality before renewal, not only from vendor admin consoles.",
      ],
    },
    {
      heading: "Why native plan UIs are not enough",
      body: [
        "Vendor consoles show one product at a time. Teams often run Cursor, Claude Code, Copilot, and local models together.",
        "UseJunction gives a shared operating picture across tools so seat waste and quota pressure are comparable org-wide.",
      ],
    },
  ],
  faq: [
    {
      question: "Can I see Cursor plan usage for my whole team?",
      answer:
        "Yes. With devices enrolled, UseJunction attributes Cursor-related usage and helps you compare seats and cycle utilization across the org—not only in Cursor’s own admin view.",
    },
    {
      question: "Does this watch developers’ work?",
      answer:
        "Privacy first, observability second. There is no keystroke surveillance, browser capture, or network interception. Usage collection can be turned off per login.",
    },
    {
      question: "How do I spot wasted seats?",
      answer:
        "Compare purchased seats and quotas to verified usage and enrollment coverage. Idle seats with enrolled devices, or seats without coverage, both show up as actionable signals before renewal.",
    },
  ],
  relatedPaths: [
    "/guides/see-team-ai-coding-usage",
    "/compare/engineering-intelligence",
    "/blog/ai-coding-observability-vs-jellyfish-dx-linearb",
    "/for/cursor",
    "/for/claude-code",
    "/compare/wakatime",
  ],
  howTo: {
    name: "See AI coding plan usage and waste with UseJunction",
    description: "Enroll devices and review subscription cycle utilization across your team.",
    steps: [
      { name: "Create an organization", text: "Sign up for UseJunction (self-hosted or hosted) and create your org." },
      { name: "Enroll developer devices", text: "Have developers connect the local agent with an invite token." },
      { name: "Open tools and cycle views", text: "Review seats, quotas, and cycle utilization for Cursor, Claude Code, and other tools." },
      { name: "Act on waste signals", text: "Reclaim idle seats, investigate quota pressure, and align renewals with verified usage." },
    ],
  },
};

export const guideSeeTeamUsage: ContentPage = {
  kind: "guide",
  slug: "see-team-ai-coding-usage",
  path: "/guides/see-team-ai-coding-usage",
  title: "See Your Team’s AI Coding Insights and Tool Usage",
  description:
    "See which AI coding tools your engineering team actually uses—models, cost, latency, and device health—without changing developer workflows.",
  primaryKeyword: "see my team's coding insights AI",
  secondaryKeywords: [
    "team AI coding activity",
    "Cursor Claude Copilot usage dashboard",
    "AI coding observability",
    "developer AI tool adoption",
  ],
  updatedAt: "2026-07-19",
  answer:
    "UseJunction is open-source AI coding observability for teams. Enroll devices and you get org-wide insights: which tools and models developers use, estimated cost and latency, configuration health, and optional Signals work sessions—privacy first, with no keystroke surveillance.",
  sections: [
    {
      heading: "Team coding insights, for the AI era",
      body: [
        "Classic time trackers answer “how long did someone code?” Platform teams now ask “which AI tools, models, and plans are in use—and are they healthy?”",
        "UseJunction answers the second question with a shared operating picture across Cursor, Claude Code, Codex, Copilot, Ollama, and more.",
      ],
    },
    {
      heading: "What leaders see",
      body: [
        "Adoption and coverage: active developers, last seen, enrollment gaps.",
        "Spend and performance: tokens, estimated cost, latency, and failures by person, tool, and model.",
        "Configuration health: personal vs company keys, local runtimes, and quota pressure.",
        "Signals (when enabled): how AI sits in real work sessions. Detail level is configurable and can be turned off.",
      ],
    },
    {
      heading: "Privacy posture",
      body: [
        "No network interception, browser capture, or MDM enforcement. Observation via a local agent reporting to your admin.",
        "Self-host under the UseJunction Community License so data stays on infrastructure you control. Privacy first; richer work detail stays optional.",
      ],
    },
  ],
  faq: [
    {
      question: "Is this a time tracker?",
      answer:
        "No. UseJunction is AI coding observability—tools, models, cost, plan utilization, and device health—not keystroke or hours-in-editor tracking.",
    },
    {
      question: "Will developers need to change how they work?",
      answer:
        "No. They enroll a lightweight agent and keep using their existing tools. Visibility first; control-plane features are optional roadmap.",
    },
  ],
  relatedPaths: [
    "/guides/see-plan-usage-and-waste",
    "/compare/engineering-intelligence",
    "/blog/ai-coding-observability-vs-jellyfish-dx-linearb",
    "/guides/open-source-wakatime-alternative-for-ai-coding",
    "/guides/personal-vs-company-api-keys",
    "/compare/wakatime",
  ],
};

export const guideWakatimeAdjacent: ContentPage = {
  kind: "guide",
  slug: "open-source-wakatime-alternative-for-ai-coding",
  path: "/guides/open-source-wakatime-alternative-for-ai-coding",
  title: "Open-Source WakaTime Alternative for AI Coding Teams",
  description:
    "Looking for an open-source WakaTime alternative for AI coding? UseJunction tracks team AI tool usage, plan utilization, and coding insights—not editor time tracking.",
  primaryKeyword: "open source wakatime alternative",
  secondaryKeywords: [
    "WakaTime alternative for AI coding tools",
    "open source developer activity dashboard AI",
    "team coding insights open source",
  ],
  updatedAt: "2026-07-19",
  answer:
    "If you searched for an open-source WakaTime alternative because you need team coding insights in the AI era, UseJunction is the better fit for AI tool observability—not a drop-in time tracker. It shows which AI coding tools your team uses, plan and seat utilization, cost and latency, and device health, self-hosted under the UseJunction Community License, with privacy-first controls over work detail.",
  sections: [
    {
      heading: "Honest positioning",
      body: [
        "WakaTime excels at time-in-editor and language activity. UseJunction does not claim feature parity with that model.",
        "Teams searching “open source WakaTime alternative” today often need AI coding visibility: Cursor/Claude/Copilot usage, seat waste, and org-wide cost—not more keystroke telemetry.",
      ],
    },
    {
      heading: "When to choose UseJunction",
      body: [
        "You want open-source, self-hosted AI coding observability for teams.",
        "You need plan usage, seat intentionality, and personal-key detection.",
        "You want privacy-first Signals-style work context with controls over how much detail is visible.",
      ],
    },
    {
      heading: "When to keep a time tracker",
      body: [
        "You specifically need hours by project, language, or IDE plugin time tracking. Pair that tool with UseJunction rather than replacing it if both jobs matter.",
      ],
    },
  ],
  faq: [
    {
      question: "Is UseJunction a WakaTime clone?",
      answer:
        "No. It is open-source AI coding observability for teams. It captures adjacent search intent for teams that outgrew time-only dashboards and need AI usage, cost, and plan insights.",
    },
    {
      question: "Can I self-host it?",
      answer:
        "Yes. UseJunction is available under the UseJunction Community License and designed to run on your infrastructure.",
    },
  ],
  relatedPaths: ["/compare/wakatime", "/guides/see-team-ai-coding-usage", "/guides/see-plan-usage-and-waste"],
};

export const guidePersonalKeys: ContentPage = {
  kind: "guide",
  slug: "personal-vs-company-api-keys",
  path: "/guides/personal-vs-company-api-keys",
  title: "Detect Personal vs Company API Keys on AI Coding Tools",
  description:
    "Find when developers use personal API keys instead of company-provisioned keys across Cursor, Claude Code, and other AI coding tools.",
  primaryKeyword: "personal API key detection AI coding tools",
  secondaryKeywords: ["company vs personal keys Cursor", "shadow IT AI coding"],
  updatedAt: "2026-07-19",
  answer:
    "UseJunction surfaces personal versus company API key usage as part of device and configuration health. Platform teams see where personal keys show up across enrolled devices so they can fix provisioning before enforcing policy.",
  sections: [
    {
      heading: "Why it matters",
      body: [
        "Personal keys create spend leakage, retention risk, and incomplete org visibility.",
        "Visibility first: detect drift, then introduce team keys and policy when you are ready.",
      ],
    },
    {
      heading: "What you get",
      body: [
        "Signals of personal key usage in the observability dashboard.",
        "Coverage context so you know which devices are enrolled and healthy.",
      ],
    },
  ],
  faq: [
    {
      question: "Does detection require a proxy?",
      answer:
        "UseJunction observes via a local agent—not by intercepting all network traffic like a mandatory corporate proxy.",
    },
  ],
  relatedPaths: ["/guides/see-team-ai-coding-usage", "/for/cursor", "/compare/helicone"],
};

export const GUIDES: ContentPage[] = [
  guideSeePlanUsage,
  guideSeeTeamUsage,
  guideWakatimeAdjacent,
  guidePersonalKeys,
];
