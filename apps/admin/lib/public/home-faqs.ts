import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import type { ContentFaq } from "@/content/types";

/**
 * Homepage FAQs, answer-first for AEO / AI Overviews. The first HOME_FAQ_VISIBLE are shown on the page;
 * the rest sit under "More questions" (still in the DOM, so the FAQ schema matches the page).
 */
export const HOME_FAQ_VISIBLE = 4;

export const HOME_FAQS: ContentFaq[] = [
  {
    question: "Do developers have to change how they work?",
    answer: "No. Same tools, same editors. A small agent on each machine reads usage in the background.",
  },
  {
    question: "Is it free?",
    answer: `Yes, for up to ${USER_LIMIT_FREE} seats, hosted or self-hosted. After that the hosted version is $${TEAM_PRICE_PER_DEV_USD} per active developer a month.`,
  },
  {
    question: "Can we self-host it?",
    answer:
      "Yes, on infrastructure you control, with Postgres and Next.js, under the UseJunction Community License. Your data stays with you.",
  },
  {
    question: "How long until I see something useful?",
    answer: "Your own usage appears once your machine reports in. The rest fills in as teammates connect their machines.",
  },
  {
    question: "How does UseJunction know what a feature cost?",
    answer:
      "Connect GitHub. UseJunction matches each developer's AI coding usage to the pull requests and issues they worked on, so each one shows the AI spend behind it and whether it merged. Where the match isn't exact, the spend is marked as estimated.",
  },
  {
    question: "What data does UseJunction collect?",
    answer:
      "The agent reports tool, model, tokens, estimated cost, device, and status. There is no keystroke surveillance, browser capture, or network interception. Usage collection can be turned off per login.",
  },
  {
    question: "Which tools are supported?",
    answer:
      "Codex, Claude Code, Cursor, Continue, Cline, Roo Code, OpenCode, GitHub Copilot, Ollama, LM Studio, and related local runtimes—with more on the roadmap.",
  },
  {
    question: "How do I see my team’s AI coding plan usage and waste?",
    answer:
      "Enroll developer devices, then open Tools and cycle views to compare purchased seats and quotas against verified usage. Idle seats, quota pressure, and heavy users become visible before renewal.",
  },
  {
    question: "What is UseJunction?",
    answer:
      "UseJunction shows where a team's AI coding spend goes: what each feature cost, where the month's bill will land, who is near a plan limit, and which seats go unused, across Claude Code, Cursor, Codex, GitHub Copilot and other tools. It is open source: self-host it under the UseJunction Community License, or use the hosted version. Each developer controls what is shared. The official site is https://usejunction.dev.",
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
    question: "Is UseJunction an open-source WakaTime alternative?",
    answer:
      "It captures that search intent for AI-era team insights, but it is not a time tracker. UseJunction focuses on AI tool usage, cost, and plan utilization rather than hours-in-editor keystroke tracking. See our WakaTime comparison for an honest breakdown.",
  },
];
