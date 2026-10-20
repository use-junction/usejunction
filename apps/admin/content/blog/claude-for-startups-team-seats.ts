import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import type { BlogPost } from "@/content/types";

const text = (value: string, strong = false) => ({ text: value, strong });
const link = (value: string, href: string, strong = false) => ({ text: value, href, strong });

const images = {
  hero: {
    src: "/blog/claude-for-startups-team-seats/cover.webp",
    alt: "A twelve-month timeline of a free Claude Team year with checkpoints at month 3, month 6 when API credits expire, and month 11 before renewal",
    width: 1200,
    height: 630,
  },
  social: {
    src: "/blog/claude-for-startups-team-seats/social.png",
    alt: "Claude for Startups: what to track during your free Team year",
    width: 1200,
    height: 630,
  },
} as const;

export const CLAUDE_FOR_STARTUPS_TEAM_SEATS_POST: BlogPost = {
  slug: "claude-for-startups-team-seats",
  path: "/blog/claude-for-startups-team-seats",
  category: "Claude",
  title: "Got Into Claude for Startups? What to Track Before Your Free Team Year Ends",
  description:
    "The Claude for Startups program gave founders a free year of Claude Team with Premium seats. Here’s what to watch during that year so renewal is an easy call.",
  answer:
    "If your startup got a free year of Claude Team through the Claude for Startups program, track three things during the year: which of your Premium seats get real use, how often each person hits their weekly limit, and how fast you burn through the API credits before they expire at six months. Check at month 3, month 6, and month 11. By renewal you’ll know who needs Premium, who is fine on Standard, and who doesn’t need a seat at all.",
  takeaways: [
    "The October 2026 offer was a free year of Claude Team with up to five Premium seats, plus $1,000 in API credits that expire after six months.",
    "Free seats hide waste. Nobody checks a seat that costs nothing.",
    "Weekly limit hits are what decide Premium or Standard for each person, and Claude’s Team admin doesn’t show them.",
    "Check at month 3, month 6 (when the credits expire), and month 11 (before you start paying).",
  ],
  primaryKeyword: "claude for startups team plan",
  secondaryKeywords: [
    "claude for startups",
    "claude for startups program",
    "claude for startups credits",
    "claude for startups free team",
    "claude startup program premium seats",
  ],
  topics: ["Claude", "Claude Team", "Startups", "Seat utilization"],
  publishedAt: "2026-10-20",
  updatedAt: "2026-10-20",
  readingMinutes: 5,
  author: DINUDA_YAGGAHAVITA,
  heroImage: images.hero,
  socialImage: images.social,
  relatedPaths: [
    "/guides/claude-premium-vs-standard-seat",
    "/guides/claude-team-usage-limits",
    "/guides/see-plan-usage-and-waste",
  ],
  faq: [
    {
      question: "What does the Claude for Startups program include?",
      answer:
        "The October 2026 launch offered a free year of Claude Team for up to five Premium seats, for organizations new to Team, and $1,000 in Claude API credits that expire after six months. It also includes partner perks and Applied AI office hours. The current cohort is full, so check the program page for the next one.",
    },
    {
      question: "Is Claude for Startups still accepting applications?",
      answer:
        "Not right now. The program page says the current cohort is full and new applications are closed. You can sign up for the startup newsletter to hear when the next cohort opens.",
    },
    {
      question: "What happens when the free Claude Team year ends?",
      answer:
        "You start paying for the seats you keep. That’s when it pays to know who used their Premium seat, so you can move light users to Standard or remove seats nobody uses.",
    },
    {
      question: "Do the startup API credits work on AWS or Google Cloud?",
      answer: "No. They only work on the first-party Claude API through the Claude Console.",
    },
  ],
  blocks: [
    {
      type: "paragraph",
      content: [
        text("A free year of Premium seats is a great deal. It’s also the easiest way to lose track of who actually uses what. Nobody looks at a seat that costs nothing, and then the free year ends and you have to guess."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("This is the short list of what we’d track if we were in the cohort."),
      ],
    },
    { type: "heading", text: "What did the program give you?" },
    {
      type: "paragraph",
      content: [
        text("When the program reopened on October 6, 2026, the announcement covered a free year of Claude Team for up to five Premium seats, for organizations new to Team, plus $1,000 in API credits that expire six months after they’re granted. The cohort filled within days, and the "),
        link("program page", "https://claude.com/programs/startups"),
        text(" now says applications are closed."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("If you got in, you have two clocks running: six months on the credits and twelve on the seats."),
      ],
    },
    { type: "heading", text: "What should you track during the free year?" },
    {
      type: "list",
      items: [
        [text("Who uses their seat. ", true), text("Open Analytics and compare active members to assigned seats. A seat that’s been quiet for a month is a seat you won’t pay for later.")],
        [text("Who hits their weekly limit. ", true), text("This is what decides Premium or Standard. Someone who never gets past half their weekly allowance will be fine on Standard when you start paying.")],
        [text("How fast the API credits go. ", true), text("Check the Claude Console usage page. If you’ll run out before month six, plan for it. If you won’t use them, spend them on something worth testing before they expire.")],
        [text("Who uses personal accounts. ", true), text("Someone on a personal Max plan doesn’t show up in your org at all, and they might be the person who needs a Premium seat most.")],
      ],
    },
    { type: "heading", text: "When should you check?" },
    {
      type: "list",
      items: [
        [text("Month 3. ", true), text("Usage has settled down. Look for seats nobody uses and people already hitting limits.")],
        [text("Month 6. ", true), text("The API credits expire. Decide whether you’re paying for API usage from here.")],
        [text("Month 11. ", true), text("Decide each person’s seat for renewal: Premium, Standard, or none.")],
      ],
    },
    {
      type: "paragraph",
      content: [
        text("Put all three in the calendar now. They’re easy to forget, and month 11 always comes sooner than you think."),
      ],
    },
    { type: "heading", text: "How do you decide each person’s seat at renewal?" },
    {
      type: "paragraph",
      content: [
        text("Use the same rule as any Team plan. Premium if they hit the weekly limit most weeks, or if they’d spend more on extra usage than the price gap. Standard for everyone else. The "),
        link("Premium vs Standard seat guide", "/guides/claude-premium-vs-standard-seat"),
        text(" has the break-even math."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("The catch is that Claude’s Team admin doesn’t show you how close each person gets to their limit. "),
        link("Checking team usage in the Claude admin", "/blog/check-claude-team-usage"),
        text(" covers what it does show."),
      ],
    },
    { type: "heading", text: "How do you see limit usage for the whole team?" },
    {
      type: "paragraph",
      content: [
        link("UseJunction", "https://usejunction.dev", true),
        text(" does this. A small agent on each laptop reports the person’s seat type and how much of their session and weekly limits they used. The dashboard shows the whole team over the full year, so at month 11 you’re reading a chart instead of guessing."),
      ],
    },
    {
      type: "paragraph",
      content: [
        text("It’s free to self-host for small teams, and it doesn’t read prompts or code. "),
        link("Sign up", "/signup", true),
        text(" or "),
        link("run it from GitHub", "https://github.com/use-junction/usejunction"),
        text("."),
      ],
    },
  ],
};
