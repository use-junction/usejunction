import { AI_CODING_OBSERVABILITY_VS_EI_POST } from "@/content/blog/ai-coding-observability-vs-engineering-intelligence";
import { CODEXBAR_FOR_TEAMS_POST } from "@/content/blog/codexbar-for-teams";
import { SEE_MY_TEAMS_AI_SPEND_POST } from "@/content/blog/see-my-teams-ai-spend";
import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import type { BlogInline, BlogPost } from "@/content/types";

const text = (value: string, strong = false): BlogInline => ({ text: value, strong });
const link = (value: string, href: string, strong = false): BlogInline => ({ text: value, href, strong });

const images = {
  hero: {
    src: "/blog/what-is-ai-coding-observability/ai-coding-observability.webp",
    alt: "UseJunction overview of AI coding observability across tools, models, cost, and reliability",
    width: 851,
    height: 315,
  },
  stack: {
    src: "/blog/what-is-ai-coding-observability/unplanned-ai-coding-stack.webp",
    alt: "An engineering team's unplanned collection of AI coding tools and subscriptions",
    width: 851,
    height: 315,
  },
  visibility: {
    src: "/blog/what-is-ai-coding-observability/cross-tool-visibility.webp",
    alt: "Cross-tool AI coding visibility across adoption, cost, models, reliability, and plans",
    width: 1024,
    height: 559,
  },
  control: {
    src: "/blog/what-is-ai-coding-observability/visibility-before-control.webp",
    alt: "Visibility before control as the foundation for AI coding governance",
    width: 1400,
    height: 942,
  },
  privacy: {
    src: "/blog/what-is-ai-coding-observability/observe-infrastructure.webp",
    alt: "Observe AI coding infrastructure without monitoring developer productivity",
    width: 1400,
    height: 678,
  },
  dashboard: {
    src: "/blog/what-is-ai-coding-observability/usejunction-dashboard.webp",
    alt: "UseJunction dashboard showing AI coding tool usage and operational signals",
    width: 1400,
    height: 842,
  },
  cover: {
    src: "/blog/what-is-ai-coding-observability/cover.webp",
    alt: "Visibility before control: five observability layers — adoption, cost, model usage, reliability, plan utilization — before any control layer",
    width: 1200,
    height: 630,
  },
  social: {
    src: "/blog/what-is-ai-coding-observability/social.png",
    alt: "What Is AI Coding Observability? Visibility Before Control",
    width: 1200,
    height: 630,
  },
} as const;

export const AI_CODING_OBSERVABILITY_POST: BlogPost = {
  slug: "what-is-ai-coding-observability",
  category: "AI Observability",
  path: "/blog/what-is-ai-coding-observability",
  title: "What Is AI Coding Observability? Visibility Before Control",
  description:
    "AI coding observability measures adoption, cost, model usage, reliability, and plan utilization across the tools engineering teams already use—without developer surveillance.",
  answer:
    "AI coding observability is the practice of measuring how engineering teams use AI coding tools — including adoption, cost, model usage, reliability and plan utilization — without inspecting developers’ source code or work activity.",
  takeaways: [
    "AI coding observability measures adoption, cost, model usage, reliability, and plan utilization across AI coding tools.",
    "It does not mean recording prompts, reading code, or ranking developers by token count.",
    "Most teams adopted Cursor, Claude Code, Copilot, and Codex before anyone owned them as infrastructure.",
    "A gateway is not always the right first step. Visibility comes before policy and control.",
    "Start with the basic questions: what you pay for, who uses it, and what keeps failing.",
  ],
  secondaryKeywords: ["what is AI coding observability", "AI coding tool visibility", "AI coding infrastructure monitoring"],
  primaryKeyword: "AI coding observability",
  topics: ["AI coding observability", "Cursor", "Claude Code", "AI coding", "Observability"],
  publishedAt: "2026-07-22",
  updatedAt: "2026-07-22",
  readingMinutes: 8,
  author: DINUDA_YAGGAHAVITA,
  heroImage: images.cover,
  socialImage: images.social,
  relatedPaths: ["/guides/see-team-ai-coding-usage", "/guides/see-plan-usage-and-waste", "/privacy"],
  faq: [
    {
      question: "What is AI coding observability?",
      answer:
        "AI coding observability is measuring how an engineering team uses AI coding tools — adoption, cost, model usage, reliability, and plan utilization — across vendors such as Cursor, Claude Code, Codex, and Copilot, without inspecting source code or developer activity.",
    },
    {
      question: "How is AI coding observability different from LLM observability?",
      answer:
        "LLM observability tools such as Helicone or Langfuse trace model calls inside your own applications. AI coding observability looks at the coding tools developers use on their laptops: which tools, which plans, what they cost, and how reliably they work.",
    },
    {
      question: "Is AI coding observability the same as developer monitoring?",
      answer:
        "No. It measures tools and infrastructure, not people. It does not record prompts, read code, capture screens, or rank developers by token usage.",
    },
    {
      question: "Do I need a gateway or proxy to get AI coding observability?",
      answer:
        "Not to start. A local agent can report usage signals from installed tools without intercepting traffic. A gateway can come later, once you know what you want to control.",
    },
  ],
  blocks: [
    { type: "paragraph", content: [link("Github Repo", "https://github.com/use-junction/usejunction")] },
    { type: "paragraph", content: [text("AI coding observability is the practice of measuring how engineering teams use AI coding tools — including adoption, cost, model usage, reliability and plan utilization — without inspecting developers’ source code or work activity.", true)] },
    { type: "paragraph", content: [text("That last part matters.")] },
    { type: "paragraph", content: [text("When I say observability, I do not mean recording every prompt, reading code or producing a leaderboard of which developer used the most tokens. I mean answering much more basic questions:")] },
    { type: "list", items: ["What tools are we paying for?", "Are people using them?", "Which models do they depend on?", "What keeps failing?", "Are we buying capacity we do not need?", "Are local models becoming more favourable for teams"].map((item) => [text(item, true)]) },
    { type: "paragraph", content: [text("Most companies cannot answer these questions today.")] },
    { type: "paragraph", content: [text("That is strange when you consider how quickly tools like Cursor, Claude Code, GitHub Copilot and Codex have moved from experiments into the everyday development environment.")] },
    { type: "paragraph", content: [text("AI coding became infrastructure before most organizations realized they owned infrastructure.")] },
    { type: "heading", text: "Nobody planned the AI coding stack" },
    { type: "image", image: images.stack },
    { type: "paragraph", content: [text("Very few companies deliberately designed their current AI coding setup.")] },
    { type: "paragraph", content: [text("One developer started paying for Cursor. Another preferred Claude Code. A team bought Copilot seats through GitHub. Someone connected an API key to Cline or Continue. A few engineers began running open models locally.")] },
    { type: "paragraph", content: [text("Each choice was reasonable on its own.")] },
    { type: "paragraph", content: [text("Together, they created an unplanned stack of tools, models, subscriptions and accounts.")] },
    { type: "paragraph", content: [text("Finance can see the invoices, but an invoice does not tell you whether a tool is useful. Engineering managers know what their teams say they use, but that does not show how usage changes over time. Vendor dashboards provide some answers, but only from inside their own products.")] },
    { type: "paragraph", content: [text("Cursor knows about Cursor. GitHub knows about Copilot. Anthropic knows about traffic reaching Anthropic.")] },
    { type: "paragraph", content: [text("The organization is left assembling the wider picture manually.")] },
    { type: "paragraph", content: [text("This is the gap we are building "), link("UseJunction", "https://usejunction.dev", true), text(" to close: one observability layer across the AI coding tools an engineering team already uses.")] },
    { type: "image", image: images.visibility },
    { type: "heading", text: "Is AI coding observability just about seat waste?" },
    { type: "paragraph", content: [text("Unused seats are the most obvious problem because they are easy to put into a spreadsheet.")] },
    { type: "paragraph", content: [text("If a company purchased 100 seats and only 43 are active, someone can cancel the rest before renewal. Useful — but not particularly deep.")] },
    { type: "paragraph", content: [text("The more interesting question is what is happening across those 43 active users.")] },
    { type: "paragraph", content: [text("Perhaps a developer has an allocated Cursor seat but does most of their work through Claude Code. Another might regularly exhaust their included plan usage and quietly switch to an API key. A third might prefer a local model for a particular repository.")] },
    { type: "paragraph", content: [text("A vendor dashboard can make one product appear underused while the developer is actually a heavy AI user elsewhere.")] },
    { type: "paragraph", content: [text("That is why AI coding observability needs to cover more than licenses. At minimum, it should help an organization understand five things:")] },
    { type: "list", items: [
      [text("Adoption: ", true), text("which tools are genuinely part of the development workflow")],
      [text("Cost: ", true), text("subscription, API and infrastructure spending in one place")],
      [text("Model usage: ", true), text("which models are being used across different tools")],
      [text("Reliability: ", true), text("latency, errors, rate limits and failed requests")],
      [text("Plan utilization: ", true), text("whether paid allowances are exhausted, balanced or wasted")],
    ] },
    { type: "paragraph", content: [text("These measurements are related.")] },
    { type: "paragraph", content: [text("A drop in usage may be an adoption problem. It may also mean a tool became slow, a plan reached its limit or developers found a better model somewhere else. Looking at one metric — or one vendor — can give you the wrong explanation.")] },
    { type: "heading", text: "Do you need an AI gateway first?" },
    { type: "image", image: images.control },
    { type: "paragraph", content: [text("The standard enterprise response to a fragmented stack is centralization.")] },
    { type: "paragraph", content: [text("Route every request through one gateway. Decide which models are allowed. Block everything else. Put policy in front of the problem.")] },
    { type: "paragraph", content: [text("There are situations where that is necessary. If source code is being sent somewhere it should not be, the company cannot wait six months for a beautiful analytics dashboard.")] },
    { type: "paragraph", content: [text("But I do not think a gateway should be the automatic starting point.")] },
    { type: "paragraph", content: [text("A gateway changes how developers work before the organization properly understands how they work. It can introduce latency, break features that depend on a vendor’s native API and turn the platform team into the owner of another critical service.")] },
    { type: "paragraph", content: [text("Worse, a badly designed control layer can push usage out of sight. Developers do not stop wanting a useful tool because it disappeared from the approved list. They find another account, another API key or another route.")] },
    { type: "paragraph", content: [text("Before inserting control into every request, I would want to know:")] },
    { type: "paragraph", content: [text("Which workflows are important enough to protect? Which tools are redundant? Where is sensitive data actually going? What would break if we standardized too early?")] },
    { type: "paragraph", content: [text("You need evidence to answer those questions.")] },
    { type: "paragraph", content: [text("That is what I mean by visibility before control. It is not an argument against governance. It is an argument against governing an environment you have not yet mapped.")] },
    { type: "heading", text: "Does AI coding observability monitor developers?" },
    { type: "image", image: images.privacy },
    { type: "paragraph", content: [text("There is a dangerous version of this product category.")] },
    { type: "paragraph", content: [text("Take AI usage data, attach it to individuals and pretend it measures engineering productivity.")] },
    { type: "paragraph", content: [text("It does not.")] },
    { type: "quote", content: [text("One developer making 500 requests is not necessarily more productive than someone making 20. They may be asking the model to repair poor generations. They may be exploring an unfamiliar codebase. They may simply work differently.")] },
    { type: "paragraph", content: [text("The same problem already exists with commit counts and lines of code. AI gives companies even more activity data to misuse.")] },
    { type: "paragraph", content: [text("UseJunction is being designed around a simpler boundary: collect the operational information needed to understand the AI system, without turning it into surveillance.")] },
    { type: "paragraph", content: [text("That means looking at information such as the tool, model, request status, latency and plan consumption. It does not require reading the developer’s source code or capturing the contents of every conversation.")] },
    { type: "paragraph", content: [text("There will always be pressure to collect more because more data looks useful on a product roadmap. I think restraint is part of building this category correctly.")] },
    { type: "paragraph", content: [text("If developers believe observability is secretly performance monitoring, they will avoid it. And they will be right to.")] },
    { type: "heading", text: "Why I ended up working on this" },
    { type: "image", image: images.dashboard },
    { type: "paragraph", content: [text("Before "), link("UseJunction", "https://usejunction.dev"), text(", I built "), link("Tallei", "http://tallei.com"), text(" around a different version of the same fragmentation problem.")] },
    { type: "paragraph", content: [text("People were working across ChatGPT, Claude and other assistants, repeatedly moving context between them. The interesting part was not any single assistant. It was the behaviour across them: where information came from, what people repeatedly explained and how work moved between tools.")] },
    { type: "paragraph", content: [text("AI coding has the same structural problem.")] },
    { type: "paragraph", content: [text("The developer’s workflow does not belong to Cursor, Anthropic, OpenAI or GitHub. It runs across them.")] },
    { type: "paragraph", content: [text("Yet almost every dashboard is designed as if its vendor represents the whole environment.")] },
    { type: "paragraph", content: [text("That mismatch is what pulled me toward UseJunction.")] },
    { type: "paragraph", content: [text("We are starting with observability because I do not think the first version should try to become the company’s AI police, universal router and procurement system at the same time.")] },
    { type: "paragraph", content: [text("The first job is simpler: show engineering and platform teams what is actually happening.")] },
    { type: "paragraph", content: [text("UseJunction is being built as an open-source, self-hostable system because some organizations will reasonably refuse to send this data to another external SaaS product. Even operational metadata can reveal meaningful information about engineering activity. Teams should be able to decide where that data lives.")] },
    { type: "heading", text: "What should AI coding observability tell you?" },
    { type: "quote", content: [text("Imagine renewal season is approaching.", true)] },
    { type: "paragraph", content: [text("You have Cursor, Copilot and Claude subscriptions spread across several teams. Some developers also use Codex, Cline, Continue or local models. Finance wants to know what can be cancelled. Engineering does not want a cost-cutting exercise to remove tools people genuinely depend on.")] },
    { type: "paragraph", content: [text("Today, this usually turns into a combination of vendor exports, surveys and guesswork.")] },
    { type: "paragraph", content: [text("UseJunction should let you see the environment as one system:")] },
    { type: "list", items: ["Which tools are active?", "Which plans are approaching their limits?", "Where are paid seats sitting unused?", "Which teams are seeing failures?", "Are developers moving to another model when one becomes unreliable?", "Are local models becoming a meaningful part of the stack?"].map((item) => [text(item)]) },
    { type: "paragraph", content: [text("The answer may be that the company should standardize.")] },
    { type: "paragraph", content: [text("It may also be that different teams genuinely need different tools.")] },
    { type: "paragraph", content: [text("Observability should not begin with a preferred conclusion. Its job is to make the trade-offs visible.")] },
    { type: "heading", text: "Where should a team start?" },
    { type: "paragraph", content: [text("A company does not need an elaborate AI governance programme to begin.")] },
    { type: "paragraph", content: [text("Start with the questions that should already have answers:")] },
    { type: "list", items: ["How many AI coding products are we paying for?", "Who has access?", "Which ones have been active recently?", "What portion of each plan is being consumed?", "Are API costs growing outside the subscription budget?", "Which services are regularly slow or unavailable?"].map((item) => [text(item)]) },
    { type: "paragraph", content: [text("Then define what you will not collect.")] },
    { type: "paragraph", content: [text("That second step is easy to ignore, but it matters. If the system does not need source code or prompt contents to answer an operational question, do not collect them by default.")] },
    { type: "paragraph", content: [text("Once the environment is visible, decisions become less theatrical.")] },
    { type: "paragraph", content: [text("You can cancel genuinely unused seats. Increase capacity where developers repeatedly hit limits. Investigate unreliable providers. Decide whether a central gateway would solve a real problem. Introduce policies around specific risks instead of applying one broad restriction to every team.")] },
    { type: "heading", text: "The point is not another dashboard" },
    { type: "paragraph", content: [text("The world does not need a prettier collection of token charts.")] },
    { type: "paragraph", content: [text("The useful outcome is being able to make decisions about AI coding infrastructure without relying on vendor claims, employee surveys or whoever has the strongest opinion in the meeting.")] },
    { type: "paragraph", content: [text("That is the product we are trying to build with "), text("UseJunction", true), text(": an open-source observability layer for AI coding tools, models and plans.")] },
    { type: "paragraph", content: [text("The product begins with visibility. Over time, that visibility may support routing, configuration and policy controls. But those controls should be built on evidence from the real environment — not assumptions about how developers are supposed to work.")] },
    { type: "paragraph", content: [text("If your company already uses several AI coding tools, you already have an AI coding stack.")] },
    { type: "paragraph", content: [text("The only question is whether you can see it.")] },
    { type: "paragraph", content: [text("P.S. You can self host it too: "), link("Github Repo", "https://github.com/use-junction/usejunction")] },
  ],
};

export const BLOG_POSTS: BlogPost[] = [SEE_MY_TEAMS_AI_SPEND_POST, CODEXBAR_FOR_TEAMS_POST, AI_CODING_OBSERVABILITY_VS_EI_POST, AI_CODING_OBSERVABILITY_POST];

export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
