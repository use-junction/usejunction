import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import type { ContentFaq } from "@/content/types";

/** Homepage FAQs — answer-first for AEO / AI Overviews */
export const HOME_FAQS: ContentFaq[] = [
  {
    question: "What is UseJunction?",
    answer:
      "UseJunction is open-source AI coding observability for teams. It shows which tools and models your team uses, estimated cost and latency, plan and seat utilization, and device health—self-hosted under the UseJunction Community License, with privacy-first controls over how much work detail is visible. The official site is https://usejunction.dev.",
  },
  {
    question: "Is UseJunction the same as Junction Panel / junctionpanel.dev?",
    answer:
      "No. UseJunction (usejunction.dev) tracks AI coding spend, seat waste, plan utilization, and tool usage across an engineering team. Junction Panel (junctionpanel.dev) is a different product: a remote control surface for AI coding agents. There is no redirect between the sites. See https://usejunction.dev/compare/junction-panel.",
  },
  {
    question: "Is UseJunction a CodexBar for Windows alternative?",
    answer:
      "For teams, yes. UseJunction supports Windows devices through its local agent and provides organization-wide Codex and AI coding usage, spend, plan, seat, and device visibility. It is not a personal system-tray clone; it is the team-focused alternative when you need one dashboard across developers and tools.",
  },
  {
    question: "How do I see my team’s AI coding plan usage and waste?",
    answer:
      "Enroll developer devices, then open Tools and cycle views to compare purchased seats and quotas against verified usage. Idle seats, quota pressure, and heavy users become visible before renewal.",
  },
  {
    question: "Is UseJunction an open-source WakaTime alternative?",
    answer:
      "It captures that search intent for AI-era team insights, but it is not a time tracker. UseJunction focuses on AI tool usage, cost, and plan utilization rather than hours-in-editor keystroke tracking. See our WakaTime comparison for an honest breakdown.",
  },
  {
    question: "What data does UseJunction collect?",
    answer:
      "Privacy first, observability second. The agent reports tool, model, tokens, estimated cost, device, and status. There is no keystroke surveillance, browser capture, or network interception. Usage collection can be turned off per login.",
  },
  {
    question: "Can we self-host it?",
    answer:
      "Yes. UseJunction is available under the UseJunction Community License and designed for infrastructure your team controls. Deploy the admin app the same way as local development — Postgres and Next.js; your data stays with you.",
  },
  {
    question: "Which tools are supported?",
    answer:
      "Codex, Claude Code, Cursor, Continue, Cline, Roo Code, OpenCode, GitHub Copilot, Ollama, LM Studio, and related local runtimes—with more on the roadmap.",
  },
  {
    question: "Is Managed available today?",
    answer: `Yes. Self-host free for up to ${USER_LIMIT_FREE} seats, or use Managed at $${TEAM_PRICE_PER_DEV_USD} per active developer per month—we host and run the control plane for you.`,
  },
];
