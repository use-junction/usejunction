import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import type { BlogPost } from "@/content/types";

const text = (value: string, strong = false) => ({ text: value, strong });
const link = (value: string, href: string, strong = false) => ({ text: value, href, strong });

const images = {
  hero: {
    src: "/blog/ai-coding-observability-vs-jellyfish-dx-linearb/cover.webp",
    alt: "Four searches mapped to four tools: PR delays to LinearB, developer attrition to DX, R&D allocation to Jellyfish, and AI coding spend to UseJunction",
    width: 1200,
    height: 630,
  },
  visibility: {
    src: "/blog/what-is-ai-coding-observability/cross-tool-visibility.webp",
    alt: "Cross-tool AI coding visibility for seat utilization, cost, and plan usage across Cursor, Claude Code, and Copilot",
    width: 1024,
    height: 559,
  },
  social: {
    src: "/blog/ai-coding-observability-vs-jellyfish-dx-linearb/social.png",
    alt: "Cursor seat waste and AI coding observability — UseJunction vs Jellyfish, DX, and LinearB",
    width: 1200,
    height: 630,
  },
} as const;

export const AI_CODING_OBSERVABILITY_VS_EI_POST: BlogPost = {
  slug: "ai-coding-observability-vs-jellyfish-dx-linearb",
  category: "AI Spend",
  path: "/blog/ai-coding-observability-vs-jellyfish-dx-linearb",
  title: "Cursor Seat Waste & AI Coding Observability: UseJunction vs Jellyfish, DX, and LinearB",
  description:
    "See Cursor, Claude, and Copilot plan usage across your team. Learn which tool answers your search — seat waste, delivery bottlenecks, DevEx, or eng-finance reporting.",
  answer:
    "If you need org-wide visibility into Cursor, Claude Code, Copilot, and other AI coding tools — cost, seat utilization, quota pressure, and device health in one place — UseJunction is built for that job. Jellyfish, DX, and LinearB solve different problems: finance reporting, developer experience, and delivery bottlenecks. They will not answer “are we wasting Cursor Pro seats?” or “what is our AI coding stack costing per developer?”",
  takeaways: [
    "Jellyfish, DX, LinearB, and UseJunction answer different searches. Pick the one that matches the pain.",
    "LinearB is for delivery bottlenecks, DX is for developer experience, and Jellyfish is for engineering-finance alignment.",
    "None of those three reconciles Cursor, Claude Code, and Copilot seats against real usage.",
    "UseJunction compares purchased seats and plan cycles to verified usage on enrolled devices, across vendors.",
    "Run the check before renewal: list every tool, compare seats to usage, and confirm enrollment coverage.",
  ],
  primaryKeyword: "Cursor seat utilization",
  secondaryKeywords: [
    "how to see Cursor plan usage for my team",
    "are we wasting Cursor Pro seats",
    "AI coding observability",
    "AI coding tool cost monitoring",
    "see my team's coding insights AI",
  ],
  topics: ["AI coding observability", "Cursor", "Claude Code", "Copilot", "Jellyfish", "DX", "LinearB"],
  publishedAt: "2026-07-25",
  updatedAt: "2026-07-25",
  readingMinutes: 12,
  author: DINUDA_YAGGAHAVITA,
  heroImage: images.hero,
  socialImage: images.social,
  relatedPaths: [
    "/compare/engineering-intelligence",
    "/guides/see-plan-usage-and-waste",
    "/guides/see-team-ai-coding-usage",
    "/guides/open-source-wakatime-alternative-for-ai-coding",
    "/for/cursor",
    "/for/claude-code",
  ],
  faq: [
    {
      question: "How do I see Cursor plan usage for my whole team?",
      answer:
        "Enroll devices with UseJunction’s local agent. The dashboard attributes Cursor-related usage and compares purchased seats and subscription-cycle utilization across the org — not only in Cursor’s own admin view. See the plan usage guide at usejunction.dev/guides/see-plan-usage-and-waste.",
    },
    {
      question: "Are we wasting Cursor Pro seats?",
      answer:
        "Compare purchased seats and quotas to verified usage and enrollment coverage. Idle seats on enrolled devices — and paid seats with no enrolled device — both surface as waste signals before renewal.",
    },
    {
      question: "What is AI coding observability?",
      answer:
        "The practice of monitoring which AI-assisted coding tools a team uses, what they cost, how plan quotas are consumed, and whether devices are healthy — across vendors, in one view. UseJunction is open-source AI coding observability for teams.",
    },
    {
      question: "How is UseJunction different from Jellyfish, DX, or LinearB?",
      answer:
        "Jellyfish focuses on engineering-finance alignment and R&D capitalization. DX focuses on developer experience and retention surveys. LinearB focuses on delivery speed and PR workflow automation. UseJunction focuses on AI coding tool cost, seat utilization, and multi-vendor fleet visibility on developer laptops.",
    },
    {
      question: "Is UseJunction a WakaTime alternative?",
      answer:
        "Only if you need AI tool usage and plan insights, not editor time tracking. UseJunction is not a drop-in WakaTime replacement for hours-by-project metrics.",
    },
    {
      question: "Does UseJunction spy on developers?",
      answer:
        "No keystroke logging, screenshots, browser capture, or full network interception. A local agent reports usage signals. Work-detail collection is optional and configurable per person or team.",
    },
    {
      question: "Can I self-host UseJunction?",
      answer:
        "Yes. UseJunction runs under the UseJunction Community License. Data stays on infrastructure you control.",
    },
    {
      question: "How is UseJunction different from Helicone or Langfuse?",
      answer:
        "Helicone and Langfuse observe application LLM traffic through gateways and traces. UseJunction observes AI coding tools on developer machines — Cursor, Claude Code, Copilot, local models. They complement each other.",
    },
  ],
  blocks: [
    {
      type: "paragraph",
      content: [
        text("Nobody wakes up searching for “engineering intelligence platform.” They wake up searching because something hurts: "),
        text("“Why is our Cursor bill $40k?”", true),
        text(" “Are we wasting seats?” “Who’s on personal Claude keys?” “What AI tools is my team actually using?”"),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("That last cluster — "),
        text("AI coding observability", true),
        text(" — is the fastest-growing search in eng leadership in 2026. It is also the one "),
        link("Jellyfish", "https://jellyfish.co"),
        text(", "),
        link("DX", "https://getdx.com"),
        text(", and "),
        link("LinearB", "https://linearb.io"),
        text(" were not built to own."),
      ],
    },
    { type: "heading", text: "Why is AI coding spend so hard to see?" },
    {
      type: "paragraph",
      content: [
        text("You rolled out AI coding tools fast. Cursor for some teams. Claude Code for others. Copilot because GitHub was already there. A few engineers on personal Max plans. Someone running Ollama locally."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Finance got the first real invoice and asked a simple question: "),
        text("“What are we actually paying for — and who’s using it?”", true),
        text(" Nobody had a good answer."),
      ],
    },
    {
      type: "list",
      items: [
        [text("Seat count ≠ usage. ", true), text("You bought 80 Cursor seats. Twelve people haven’t opened it in 30 days.")],
        [text("One dashboard per vendor. ", true), text("Cursor admin here. Copilot billing there. Claude on a personal plan.")],
        [text("Usage is variable. ", true), text("Agent workflows cost 10× autocomplete. Seat pricing hid that until the invoice.")],
        [text("Enterprise APIs aren’t for everyone. ", true), text("Cursor’s Admin API is powerful — often enterprise-only.")],
        [text("“No usage” might mean “not enrolled.” ", true), text("Admin consoles don’t see laptops that never connected.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("This is what people search when they find "),
        link("UseJunction", "https://usejunction.dev", true),
        text(": "),
        text("how to see Cursor plan usage for my team", true),
        text(", "),
        text("Cursor seat utilization", true),
        text(", "),
        text("are we wasting Cursor Pro seats", true),
        text(", "),
        text("AI coding tool cost monitoring", true),
        text("."),
      ],
    },
    { type: "heading", text: "What does UseJunction solve?" },
    { type: "image", image: images.visibility },
    {
      type: "list",
      items: [
        [
          text("Seat waste: ", true),
          text("purchased seats vs active usage per tool and billing cycle — "),
          link("see plan usage guide", "/guides/see-plan-usage-and-waste"),
        ],
        [
          text("Per-developer AI spend: ", true),
          text("cost, tokens, model mix; verified vendor usage vs estimated local signals"),
        ],
        [
          text("Multi-tool sprawl: ", true),
          text("Cursor, Claude Code, Codex, Copilot, Continue, Ollama, and more in one dashboard"),
        ],
        [
          text("Personal vs company keys: ", true),
          text("shadow API key detection — "),
          link("personal keys guide", "/guides/personal-vs-company-api-keys"),
        ],
        [
          text("WakaTime-adjacent intent: ", true),
          text("teams searching “open source wakatime alternative” usually need AI insights, not hours — "),
          link("honest positioning", "/guides/open-source-wakatime-alternative-for-ai-coding"),
        ],
      ],
    },
    { type: "heading", text: "Where do Jellyfish, DX, and LinearB fit?" },
    {
      type: "paragraph",
      content: [
        text("Buyers lump “engineering visibility” into one bucket. "),
        text("Your Google search tells you which bucket you’re in.", true),
      ],
    },
    {
      type: "list",
      items: [
        [
          text("“PRs sit for 3 days” ", true),
          text("→ "),
          text("cycle time", true),
          text(", "),
          text("PR review bottleneck", true),
          text(" → "),
          text("LinearB", true),
        ],
        [
          text("“Developers are frustrated and leaving” ", true),
          text("→ "),
          text("developer experience survey", true),
          text(", "),
          text("DevEx metrics", true),
          text(" → "),
          text("DX", true),
        ],
        [
          text("“The board wants eng investment and R&D capitalization” ", true),
          text("→ "),
          text("engineering allocation", true),
          text(", "),
          text("R&D tax credit", true),
          text(" → "),
          text("Jellyfish", true),
        ],
        [
          text("“Our Cursor + Claude bills are insane” ", true),
          text("→ "),
          text("Cursor seat utilization", true),
          text(", "),
          text("AI coding observability", true),
          text(" → "),
          text("UseJunction", true),
        ],
      ],
    },
    {
      type: "paragraph",
      content: [
        link("Full problem-by-problem comparison", "/compare/engineering-intelligence", true),
        text(" — including when to stack tools."),
      ],
    },
    { type: "heading", text: "When should you use LinearB?" },
    {
      type: "paragraph",
      content: [
        text("LinearB is strong when "),
        text("shipping is stuck", true),
        text(": cycle time by stage, DORA metrics, gitStream automation. It does not reconcile Cursor seat waste or Claude Max quotas across your org."),
      ],
    },
    { type: "heading", text: "When should you use DX?" },
    {
      type: "paragraph",
      content: [
        text("DX is strong when "),
        text("people are the problem", true),
        text(": structured surveys, DXI, friction before attrition. It does not give finance a per-developer AI coding cost ledger."),
      ],
    },
    { type: "heading", text: "When should you use Jellyfish?" },
    {
      type: "paragraph",
      content: [
        text("Jellyfish is strong when "),
        text("finance and the board", true),
        text(" need allocation, investment narratives, and R&D capitalization. It is not a multi-vendor AI coding fleet monitor."),
      ],
    },
    { type: "heading", text: "When should you use UseJunction?" },
    {
      type: "paragraph",
      content: [
        text("UseJunction is strong when "),
        text("AI tool sprawl and spend", true),
        text(" are the fire. A local agent on each laptop reports usage signals. An admin control plane rolls up cost, plan cycles, seat waste, and device health. Self-host under the Community License."),
      ],
    },
    { type: "heading", text: "How does UseJunction compare to vendor dashboards?" },
    {
      type: "list",
      items: [
        [text("Cursor plan usage for whole team: ", true), text("yes in both — UseJunction also covers Claude, Copilot, and local models")],
        [text("Seat waste before renewal: ", true), text("partial in vendor UIs; yes in UseJunction with cycle + enrollment context")],
        [text("Personal vs company keys: ", true), text("no in vendor UIs; yes in UseJunction")],
        [text("Self-hosted / open source: ", true), text("no in vendor UIs; yes in UseJunction")],
        [text("Keystroke / hours tracking: ", true), text("no — by design in UseJunction")],
      ],
    },
    { type: "heading", text: "How does UseJunction work?" },
    {
      type: "list",
      items: [
        [text("Deploy ", true), text("the admin control plane (hosted or self-hosted).")],
        [text("Enroll ", true), text("developer devices with a lightweight local agent.")],
        [text("See ", true), text("org-wide usage: tools, models, cost, plan cycles, device health.")],
        [text("Act ", true), text("before renewal: reclaim idle seats, fix key provisioning, investigate quota spikes.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Privacy first: no keystroke surveillance, browser capture, or network interception. Optional work-detail signals can be turned off per person or team."),
      ],
    },
    { type: "heading", text: "What should you do before your next renewal?" },
    {
      type: "list",
      items: [
        [text("List every AI coding tool ", true), text("you pay for (seats + usage-based).")],
        [text("Ask finance ", true), text("what changed month-over-month — and whether anyone can explain it per user.")],
        [text("Check enrollment ", true), text("— is “no usage” missing data or missing adoption?")],
        [text("Pilot UseJunction ", true), text("on one team before org-wide rollout.")],
      ],
    },
    {
      type: "quote",
      content: [
        text("The teams that win this cycle aren’t the ones with the most AI seats. They’re the ones who can see seat waste, quota pressure, and spend concentration before the invoice lands.", true),
      ],
    },
    { type: "heading", text: "Bottom line" },
    {
      type: "paragraph",
      content: [
        text("Jellyfish, DX, and LinearB are excellent — for "),
        text("different searches", true),
        text(". If your search sounds like Cursor seat waste, multi-tool AI spend, or plan utilization, start with "),
        link("UseJunction", "https://usejunction.dev", true),
        text("."),
      ],
    },
  ],
};
