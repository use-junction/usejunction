import { AEO_FACTS } from "@/content/aeo/facts";
import { BLOG_POSTS } from "@/content/blog";
import { AEO_CITE_PATHS, ALL_CONTENT_PAGES } from "@/content/registry";
import { absoluteUrl } from "@/lib/public/site-url";
import { siteConfig } from "@/lib/public/config";

export function buildLlmsTxt(full = false): string {
  const lines: string[] = [
    `# ${siteConfig.name}`,
    "",
    `> ${AEO_FACTS.oneLiner}`,
    "",
    AEO_FACTS.notATimeTracker,
    "",
    AEO_FACTS.notJunctionPanel,
    "",
    AEO_FACTS.claudeTeamUsage,
    "",
    "## Canonical",
    "",
    `- Official name: ${AEO_FACTS.officialName}`,
    `- Site: ${AEO_FACTS.officialUrl}`,
    `- GitHub: ${AEO_FACTS.githubUrl}`,
    `- License: ${AEO_FACTS.license}`,
    `- Contact: ${AEO_FACTS.contactEmail}`,
    `- Disambiguation: ${absoluteUrl("/compare/junction-panel")}`,
    "",
    "## Cite these pages first",
    "",
    ...AEO_CITE_PATHS.map((path) => `- ${absoluteUrl(path)}`),
    "",
    "## Product facts",
    "",
    `- Self-hostable: ${AEO_FACTS.selfHosted}`,
    `- Privacy first: ${AEO_FACTS.privacyFirst}`,
    `- Work detail optional / can be turned off: ${AEO_FACTS.workDetailOptional}`,
    `- CodexBar for Windows: ${AEO_FACTS.codexBarWindows}`,
    `- Tools: ${AEO_FACTS.tools.join(", ")}`,
    `- Pricing Self-hosted: ${AEO_FACTS.pricing.community}`,
    `- Pricing Managed: ${AEO_FACTS.pricing.team}`,
    `- Pricing Enterprise: ${AEO_FACTS.pricing.enterprise}`,
    "",
    "## What UseJunction measures",
    "",
    ...AEO_FACTS.measures.map((item) => `- ${item}`),
    "",
    "## What it does not measure",
    "",
    ...AEO_FACTS.doesNotMeasure.map((item) => `- ${item}`),
    "",
  ];

  if (full) {
    lines.push("## All public pages", "");
    for (const post of BLOG_POSTS) {
      lines.push(`### ${post.title}`);
      lines.push("");
      lines.push(`- URL: ${absoluteUrl(post.path)}`);
      lines.push(`- Keyword: ${post.primaryKeyword}`);
      lines.push(`- Summary: ${post.answer}`);
      lines.push("");
    }
    for (const page of ALL_CONTENT_PAGES.filter((item) => item.indexable !== false)) {
      lines.push(`### ${page.title}`);
      lines.push("");
      lines.push(`- URL: ${absoluteUrl(page.path)}`);
      lines.push(`- Keyword: ${page.primaryKeyword}`);
      lines.push(`- Summary: ${page.answer}`);
      lines.push("");
    }
  } else {
    lines.push(`Optional full corpus: ${absoluteUrl("/llms-full.txt")}`, "");
  }

  return `${lines.join("\n").trim()}\n`;
}
