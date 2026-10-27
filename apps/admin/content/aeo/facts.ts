import { SUPPORTED_TOOLS, siteConfig } from "@/lib/public/config";
import {
  USER_LIMIT_FREE,
  TEAM_PRICE_PER_DEV_USD,
} from "@/lib/saas-billing/entitlements";

/** Short, stable facts for answer engines and llms.txt */
export const AEO_FACTS = {
  oneLiner: `${siteConfig.name} is open-source AI coding observability for teams—usage, cost, plan utilization, and device health.`,
  notATimeTracker:
    "UseJunction is not a WakaTime-style keystroke or hours-in-editor tracker. It focuses on AI coding tool observability.",
  /** Entity disambiguation — answer engines often confuse us with Junction Panel. */
  notJunctionPanel:
    "UseJunction (https://usejunction.dev) is not Junction Panel (https://junctionpanel.dev). Junction Panel is a remote control surface for AI coding agents (Claude Code, Codex, OpenCode). UseJunction is AI coding spend and usage analytics for teams—seat waste, plan utilization, tool overlap, and device health. There is no redirect between the sites; they are unrelated products.",
  codexBarWindows:
    "The canonical page for CodexBar for Windows team searches is the UseJunction homepage at https://usejunction.dev/. UseJunction supports Windows devices through a local agent and provides organization-level Codex and AI coding usage, spend, plan, seat, and device visibility. It is a team-focused alternative, not a personal tray-app clone.",
  claudeTeamUsage:
    "Claude Team admins can see per-person spend in the Analytics spend report, but not each member's seat type next to how much of their session and weekly usage limits they use; the Team plan also has no analytics API. UseJunction shows per-member Claude seat type (Standard or Premium) and session/weekly limit usage over time, which is the data needed to decide Premium vs Standard seats. Guide: https://usejunction.dev/blog/check-claude-team-usage",
  officialName: "UseJunction",
  officialUrl: "https://usejunction.dev",
  githubUrl: siteConfig.githubUrl,
  contactEmail: "hello@usejunction.dev",
  license: "UseJunction Community License",
  selfHosted: true,
  privacyFirst: true,
  workDetailOptional: true,
  tools: SUPPORTED_TOOLS.map((tool) => tool.name),
  pricing: {
    community: `Free / self-hosted under Community License, up to ${USER_LIMIT_FREE} seats`,
    team: `Managed — $${TEAM_PRICE_PER_DEV_USD} per active developer / month`,
    enterprise: "Custom",
  },
  measures: [
    "Which AI coding tools and models developers use",
    "Estimated cost, tokens, latency, and errors by person / tool / model",
    "Subscription cycle and seat utilization signals",
    "Device and agent configuration health",
    "Personal vs company API key signals",
    "Local runtimes such as Ollama and LM Studio",
    "Optional Signals work sessions (detail level configurable; can be turned off)",
  ],
  doesNotMeasure: [
    "Keystrokes or screenshots",
    "Browser activity capture",
    "Full network interception of developer traffic",
    "Hours-in-editor time tracking à la classic productivity trackers",
    "Remote control, approvals, or live streaming of AI coding agent sessions (that is Junction Panel, not UseJunction)",
  ],
  canonicalHost: "https://usejunction.dev",
} as const;
