import type { ContentPage } from "@/content/types";

export const guideClaudeSeatChoice: ContentPage = {
  kind: "guide",
  slug: "claude-premium-vs-standard-seat",
  path: "/guides/claude-premium-vs-standard-seat",
  title: "Claude Premium vs Standard Seat: Which One Each Person Needs",
  description:
    "How Claude Team Standard and Premium seats differ, a simple rule for who needs which, and the break-even math against buying extra usage.",
  primaryKeyword: "claude premium vs standard seat",
  secondaryKeywords: [
    "claude premium seat",
    "claude team seat types",
    "claude premium seat usage limit",
    "claude team premium usage limits",
    "claude premium seat vs max",
    "claude team seat price",
  ],
  updatedAt: "2026-10-20",
  answer:
    "A Claude Team Standard seat gives about 1.25 times the per-session usage of a Pro plan, with one weekly limit. A Premium seat gives about 6.25 times Pro per session, with a weekly limit across all models and a separate one for Sonnet. Put people on Premium if they hit their weekly limit most weeks or spend more on extra usage than the price gap between the two seats. Everyone else is fine on Standard.",
  sections: [
    {
      heading: "What’s the difference between the two seats?",
      body: [
        "Both seats are on the same Team plan and you can mix them. The difference is how much each person can use before they hit a limit.",
        "Standard gives roughly 1.25 times the usage of an individual Pro plan per session, and one weekly limit that covers all models. Premium gives roughly 6.25 times Pro per session, plus two weekly limits: one across all models and one for Sonnet only. Anthropic’s Team plan article has the current numbers and prices.",
        "Limits are per person. One heavy user hitting their cap doesn’t eat into anyone else’s.",
      ],
    },
    {
      heading: "Who needs a Premium seat?",
      body: [
        "Someone who hits their weekly limit most weeks. Waiting for a reset costs more in lost hours than the seat does.",
        "Someone whose extra usage spend each month is higher than the price gap between Premium and Standard. At that point Premium is simply the cheaper option.",
        "People who run Claude Code for most of the day, especially long agent sessions, usually end up in one of those two groups. Check their numbers before assuming it, though.",
      ],
    },
    {
      heading: "Who is fine on Standard?",
      body: [
        "Anyone who rarely gets past half their weekly allowance. That’s most people who use Claude for writing, research, and the occasional coding question.",
        "Someone who hits the 5-hour session limit a few times a week but never the weekly one. Their usage is bursty. A bigger weekly allowance won’t help much, and they can usually wait an hour or two for the session to reset.",
      ],
    },
    {
      heading: "How do I work out the break-even?",
      body: [
        "Take the monthly price of a Premium seat and subtract the Standard price. That gap is your threshold.",
        "Now look at what that person spent on extra usage in each of the last two or three months. You can find it in the spend report under Analytics > How much is Claude costing? If they’re regularly over the threshold, move them to Premium. If they’re under it, keep them on Standard and let extra usage cover the odd big week.",
        "One busy week from a launch or a migration isn’t a pattern. Look at a few weeks before you change anyone’s seat.",
      ],
    },
    {
      heading: "How do I know who keeps hitting limits?",
      body: [
        "Each person can see their own limits in Settings > Usage on claude.ai, or with /usage in Claude Code. As an admin, though, Claude’s Team admin doesn’t show you how close each member gets to their limits.",
        "UseJunction fills that gap. A small agent on each person’s machine reports their seat type and how much of their 5-hour and weekly limits they used, and the dashboard shows the whole team in one table. You can see who is actually running into the wall before you change their seat.",
      ],
    },
  ],
  faq: [
    {
      question: "Can I mix Standard and Premium seats on one Claude Team plan?",
      answer: "Yes. Anthropic lets you assign Premium to the people who need more usage and keep everyone else on Standard.",
    },
    {
      question: "Are Claude Team usage limits shared across the team?",
      answer: "No. Each member has their own limits. One person hitting theirs doesn’t affect anyone else.",
    },
    {
      question: "Is a Premium seat the same as a Max plan?",
      answer:
        "They’re close in usage, but Premium sits inside your Team organization, so you get admin controls, shared billing, and analytics. Max is an individual plan billed to one person.",
    },
    {
      question: "When do weekly limits reset?",
      answer: "At a fixed time each week assigned to the account. Each person can see their next reset in Settings > Usage.",
    },
  ],
  relatedPaths: [
    "/guides/claude-team-usage-limits",
    "/guides/claude-enterprise-analytics-api",
    "/guides/see-plan-usage-and-waste",
    "/solutions/ai-coding-seat-utilization",
  ],
  compareHeading: "Premium vs Standard at a glance",
  compareOwnName: "Premium seat",
  compareOtherName: "Standard seat",
  compareRows: [
    { feature: "Usage per session", usejunction: "About 6.25× Pro", other: "About 1.25× Pro" },
    { feature: "Weekly limits", usejunction: "All models, plus a Sonnet-only limit", other: "One limit across all models" },
    { feature: "Limits shared with team", usejunction: "No, per person", other: "No, per person" },
    { feature: "Good fit", usejunction: "Hits the weekly limit most weeks", other: "Rarely past half the weekly limit" },
  ],
  howTo: {
    name: "Decide Premium or Standard for each person",
    description: "Use a few weeks of limit and extra-usage data to pick the right seat.",
    steps: [
      { name: "Find the price gap", text: "Subtract the Standard seat price from the Premium seat price on your billing terms." },
      { name: "Export the spend report", text: "In Analytics, under How much is Claude costing?, click Export spend report for the last 90 days." },
      { name: "Check limit hits", text: "For each person, look at how often they hit their weekly and 5-hour limits over the same period." },
      { name: "Assign seats", text: "Move people who hit the weekly limit most weeks, or spend more than the gap on extra usage, to Premium." },
    ],
  },
};

export const guideClaudeTeamLimits: ContentPage = {
  kind: "guide",
  slug: "claude-team-usage-limits",
  path: "/guides/claude-team-usage-limits",
  title: "Claude Team Usage Limits, Explained: Session, Weekly, and How to See Everyone’s",
  description:
    "How the session and weekly usage limits work on Claude Team, how each person checks their own, and how an admin can see the whole team’s limit usage.",
  primaryKeyword: "claude team usage limits",
  secondaryKeywords: [
    "claude team plan usage limit",
    "claude team standard usage limits",
    "claude your usage limits team",
    "claude code usage limits team plan",
    "claude team vs pro usage limits",
    "claude team plan extra usage",
  ],
  updatedAt: "2026-10-20",
  answer:
    "Every Claude Team member has two kinds of limit: a session limit that resets every few hours, and a weekly limit that resets at a fixed time each week. Limits are per person, not pooled. Each person can check theirs in Settings > Usage on claude.ai, or with /usage in Claude Code. Admins can buy extra usage so people keep working past their limit, but the Team admin doesn’t show how close each member is.",
  sections: [
    {
      heading: "What limits does a Claude Team seat have?",
      body: [
        "A session limit, which is the short window. When someone hits it, they wait for the session to reset, which takes a few hours at most.",
        "A weekly limit, which resets at a fixed time each week. Premium seats have two weekly limits: one across all models and a separate one for Sonnet.",
        "Standard seats get about 1.25 times the usage of a Pro plan per session. Premium seats get about 6.25 times.",
      ],
    },
    {
      heading: "Are the limits shared across the team?",
      body: [
        "No. Each person has their own. If your heaviest user runs out on a Tuesday, everyone else carries on as normal.",
        "This is why the seat type matters per person rather than per team. A team of ten might only need Premium for two people.",
      ],
    },
    {
      heading: "How does each person check their own usage?",
      body: [
        "On claude.ai, go to Settings > Usage. It shows how much of the current session and week they’ve used, and when each one resets.",
        "In Claude Code, run /usage. It shows the same limits from the terminal.",
      ],
    },
    {
      heading: "What happens when someone hits a limit?",
      body: [
        "Without extra usage, they wait for the reset. With extra usage turned on for your organization, they can keep going and the overage is billed to the team.",
        "Extra usage shows up in the spend report, so you can see who relies on it. If one person buys extra usage every month, compare that against the price of a Premium seat.",
      ],
    },
    {
      heading: "How can an admin see everyone’s limit usage?",
      body: [
        "Claude’s admin shows tokens and spend per person in the spend report, but not how close each person gets to their session or weekly limit. On the Team plan there’s also no API to pull it.",
        "UseJunction reads each person’s limit usage from their own machine, the same numbers they see in Settings > Usage, and shows the whole team in one dashboard over time. You can tell who hits the wall every week and who never gets close.",
      ],
    },
  ],
  faq: [
    {
      question: "Why did I hit my Claude Team limit so fast?",
      answer:
        "Long Claude Code sessions, large files, and the bigger models use the allowance much faster than chat. Check Settings > Usage to see which limit you hit, the session one or the weekly one.",
    },
    {
      question: "Does the Claude Team plan have more usage than Pro?",
      answer: "Yes. A Standard seat has about 1.25 times Pro’s usage per session, and a Premium seat about 6.25 times.",
    },
    {
      question: "Can an admin raise one person’s limit?",
      answer:
        "Not directly. You can move them to a Premium seat, or turn on extra usage so they can keep working past the limit.",
    },
  ],
  relatedPaths: [
    "/guides/claude-premium-vs-standard-seat",
    "/guides/claude-enterprise-analytics-api",
    "/guides/see-plan-usage-and-waste",
    "/solutions/ai-coding-seat-utilization",
  ],
};

export const guideClaudeAnalyticsApi: ContentPage = {
  kind: "guide",
  slug: "claude-enterprise-analytics-api",
  path: "/guides/claude-enterprise-analytics-api",
  title: "Claude Analytics API: What It Covers, Who Gets It, and What Team Plans Can Use",
  description:
    "The Claude Enterprise Analytics API returns per-person usage and cost. Here’s how to get a key, what it includes, and the options if you’re on the Team plan.",
  primaryKeyword: "claude analytics api",
  secondaryKeywords: [
    "claude analytics api enterprise",
    "claude analytics api key",
    "claude team plan usage api",
    "claude analytics api documentation",
    "claude code analytics api",
  ],
  updatedAt: "2026-10-20",
  answer:
    "The Claude Enterprise Analytics API returns daily per-person engagement, token usage, and cost across Claude chat, Claude Code, Cowork, and Claude Design. It’s only on Enterprise. The Primary Owner turns it on and creates a key with the read:analytics scope. Team plans have no analytics API. Teams that bill through the Claude Console can use the separate Claude Code Analytics API with an Admin API key.",
  sections: [
    {
      heading: "Which Claude plans have an analytics API?",
      body: [
        "Enterprise has the Claude Enterprise Analytics API, which covers everything in your claude.ai organization.",
        "Organizations that pay for Claude Code through the Claude Console (API billing) have the Claude Code Analytics API. It uses an Admin API key and returns daily per-user Claude Code metrics.",
        "The Team plan has neither. The spend report CSV is the closest thing, and you download it by hand.",
      ],
    },
    {
      heading: "How do I get an Enterprise Analytics API key?",
      body: [
        "Only the Primary Owner can do it. Owners and Admins don’t see the page.",
        "Go to Organization settings > API, turn on the Analytics API, and create a key with the read:analytics scope.",
      ],
    },
    {
      heading: "What does the API return?",
      body: [
        "Daily rows per person: chat messages and conversations, Claude Code sessions, commits, pull requests and lines changed, Cowork sessions, and connector and skill activity.",
        "Organization summaries with daily, weekly, and monthly active users and seat adoption.",
        "A cost and usage report with token counts and spend in USD, which you can group by model, product, user, or group.",
        "Data is grouped by UTC day. Some fields only start from a certain date and come back as null before that, which isn’t the same as zero.",
      ],
    },
    {
      heading: "What if I’m on the Team plan?",
      body: [
        "Export the spend report from Analytics each month. It covers up to 90 days, per person and per model.",
        "For Claude Code, you can turn on OpenTelemetry (set CLAUDE_CODE_ENABLE_TELEMETRY=1 through managed settings) and send metrics to your own collector. That takes some setup and only covers Claude Code.",
        "Or use UseJunction, which is open source and self-hostable. A small agent on each machine reports seat type, session and weekly limit usage, and estimated cost, so you get the per-person view without an Enterprise contract.",
      ],
    },
  ],
  faq: [
    {
      question: "Does the Claude Team plan have an analytics API?",
      answer: "No. The Analytics API is Enterprise only. Team plans can export the spend report CSV from Analytics.",
    },
    {
      question: "Who can create a Claude Analytics API key?",
      answer: "Only the Primary Owner of an Enterprise organization, with the read:analytics scope.",
    },
    {
      question: "Is the Claude Code Analytics API the same thing?",
      answer:
        "No. The Claude Code Analytics API is for organizations on the Claude Console (API billing) and covers Claude Code only. It uses an Admin API key.",
    },
  ],
  relatedPaths: [
    "/guides/claude-premium-vs-standard-seat",
    "/guides/claude-team-usage-limits",
    "/guides/see-team-ai-coding-usage",
    "/solutions/ai-coding-seat-utilization",
  ],
  compareHeading: "Enterprise vs Team: usage data you can get",
  compareOwnName: "Claude Enterprise",
  compareOtherName: "Claude Team",
  compareRows: [
    { feature: "Analytics API", usejunction: "Yes, read:analytics key", other: "No" },
    { feature: "Per-person spend export", usejunction: "CSV and API", other: "CSV only, up to 90 days" },
    { feature: "Member analytics view", usejunction: "Usage-based billing only", other: "No" },
    { feature: "Limit usage per person", usejunction: "No", other: "No" },
  ],
};

export const CLAUDE_GUIDES: ContentPage[] = [guideClaudeSeatChoice, guideClaudeTeamLimits, guideClaudeAnalyticsApi];
