import assert from "node:assert/strict";
import { test } from "vitest";
import { ALL_CONTENT_PAGES, AEO_CITE_PATHS, buildSitemapEntries, contentBreadcrumbs } from "../content/registry";
import { buildLlmsTxt } from "../lib/public/llms-txt";
import { buildHomeJsonLd } from "../lib/public/json-ld";
import { AEO_FACTS } from "../content/aeo/facts";
import { BLOG_POSTS } from "../content/blog";
import { buildBlogPostJsonLd } from "../lib/public/json-ld";
import { contentPageMetadata } from "../lib/public/seo-metadata";
import { buildWebAppManifest } from "../lib/public/web-app-manifest";
import { siteConfig } from "../lib/public/config";
import { HOME_FAQS } from "../lib/public/home-faqs";

test("seo registry includes priority guides and compare pages", () => {
  const paths = new Set(ALL_CONTENT_PAGES.map((page) => page.path));
  assert.ok(paths.has("/guides/see-plan-usage-and-waste"));
  assert.ok(paths.has("/guides/see-team-ai-coding-usage"));
  assert.ok(paths.has("/guides/open-source-wakatime-alternative-for-ai-coding"));
  assert.ok(paths.has("/compare/wakatime"));
  assert.ok(paths.has("/compare/codexbar"));
  assert.ok(paths.has("/compare/junction-panel"));
  assert.ok(paths.has("/compare/engineering-intelligence"));
  assert.ok(paths.has("/solutions/ai-coding-observability-for-teams"));
  assert.ok(paths.has("/solutions/ai-coding-spend-management"));
  assert.ok(paths.has("/solutions/ai-coding-seat-utilization"));
  assert.ok(paths.has("/solutions/ai-coding-plan-usage"));
  assert.ok(paths.has("/for/cursor"));
  assert.ok(paths.has("/for/claude-code"));
  assert.ok(paths.has("/privacy"));
  assert.ok(paths.has("/terms"));
  assert.ok(paths.has("/gdpr"));
  assert.ok(paths.has("/security"));
  assert.ok(paths.has("/subprocessors"));
  assert.ok(paths.has("/dpa"));
});

test("homepage keeps brand messaging while CodexBar for Windows stays in SEO surfaces", () => {
  assert.equal(siteConfig.seoTitle, "UseJunction — AI Coding Spend Management for Teams");
  assert.match(siteConfig.description, /AI coding spend management for engineering teams/i);
  assert.doesNotMatch(siteConfig.description, /CodexBar for Windows/);

  const keywords = siteConfig.homeSeoKeywords;
  assert.ok(keywords.some((keyword) => /CodexBar for Windows/.test(keyword)));

  const faq = HOME_FAQS.find((item) => /CodexBar for Windows/.test(item.question));
  assert.ok(faq);
  assert.match(faq!.answer, /supports Windows/i);
  assert.match(faq!.answer, /team-focused alternative/i);

  const graph = buildHomeJsonLd();
  const software = graph.find((node) => node["@type"] === "SoftwareApplication");
  const organization = graph.find((node) => node["@type"] === "Organization");
  assert.match(String(software?.operatingSystem), /Windows/);
  assert.ok(
    (organization?.knowsAbout as string[] | undefined)?.some((topic) =>
      /CodexBar for Windows/.test(topic),
    ),
  );

  const homeSitemapEntry = buildSitemapEntries().find((entry) => entry.path === "/");
  assert.equal(homeSitemapEntry?.lastModified, "2026-08-06");

  const appManifest = buildWebAppManifest();
  assert.equal(appManifest.start_url, "/");
  assert.doesNotMatch(String(appManifest.description), /CodexBar for Windows/);
  assert.ok(!(appManifest.shortcuts ?? []).some((shortcut) => shortcut.url === "/compare/codexbar"));
});

test("all SUPPORTED_TOOLS-adjacent /for pages are published", () => {
  const paths = new Set(ALL_CONTENT_PAGES.map((page) => page.path));
  for (const slug of ["cursor", "antigravity", "claude-code", "codex", "github-copilot", "ollama", "continue", "cline", "roo-code", "opencode", "lm-studio"]) {
    assert.ok(paths.has(`/for/${slug}`), `missing /for/${slug}`);
  }
});

test("content breadcrumbs place hub between home and page", () => {
  const guide = ALL_CONTENT_PAGES.find((page) => page.path === "/guides/see-plan-usage-and-waste");
  assert.ok(guide);
  const crumbs = contentBreadcrumbs(guide!);
  assert.equal(crumbs[0]?.label, "Home");
  assert.equal(crumbs[1]?.href, "/guides");
  assert.equal(crumbs[crumbs.length - 1]?.label, guide!.title);
});

test("sitemap includes home and content hubs", () => {
  const entries = buildSitemapEntries();
  const paths = entries.map((entry) => entry.path);
  assert.ok(paths.includes("/"));
  assert.ok(paths.includes("/guides"));
  assert.ok(paths.includes("/blog/what-is-ai-coding-observability"));
  assert.ok(paths.includes("/blog/ai-coding-observability-vs-jellyfish-dx-linearb"));
  assert.ok(paths.includes("/compare/engineering-intelligence"));
  assert.ok(paths.includes("/compare/junction-panel"));
  assert.ok(paths.includes("/solutions/ai-coding-observability-for-teams"));
  assert.ok(paths.includes("/solutions/ai-coding-spend-management"));
  assert.ok(paths.includes("/compare/codexbar"));
  assert.ok(paths.includes("/authors/dinuda-yaggahavita"));
  assert.ok(!paths.includes("/blog/visibility-before-control"));
  assert.ok(!paths.includes("/blog/stop-wasting-ai-coding-seats"));
  assert.ok(!paths.includes("/privacy"));
  assert.ok(!paths.includes("/terms"));
  assert.ok(!paths.includes("/for/antigravity"));
  assert.ok(!paths.includes("/for/cursor"));
  assert.ok(!paths.includes("/for/claude-code"));
  assert.equal(entries[0]?.priority, 1);
});

test("indexability metadata keeps legal and thin tool pages out of search", () => {
  const privacy = ALL_CONTENT_PAGES.find((page) => page.path === "/privacy");
  const cursor = ALL_CONTENT_PAGES.find((page) => page.path === "/for/cursor");
  const antigravity = ALL_CONTENT_PAGES.find((page) => page.path === "/for/antigravity");
  assert.ok(privacy && cursor && antigravity);
  assert.deepEqual(contentPageMetadata(privacy!).robots, { index: false, follow: true });
  assert.deepEqual(contentPageMetadata(cursor!).robots, { index: false, follow: true });
  assert.deepEqual(contentPageMetadata(antigravity!).robots, { index: false, follow: true });
});

test("llms.txt includes cite paths and non-claims", () => {
  const text = buildLlmsTxt(false);
  assert.match(text, /UseJunction/);
  assert.match(text, /not a WakaTime-style/i);
  assert.match(text, /not Junction Panel/i);
  assert.match(text, /junctionpanel\.dev/);
  assert.match(text, /compare\/junction-panel/);
  assert.match(text, /CodexBar for Windows/);
  assert.match(text, /canonical page.*https:\/\/usejunction\.dev\//i);
  for (const path of AEO_CITE_PATHS) {
    assert.match(text, new RegExp(path.replace(/\//g, "\\/")));
  }
  assert.match(text, /llms-full\.txt/);
});

test("llms-full.txt includes page summaries", () => {
  const text = buildLlmsTxt(true);
  assert.match(text, /How to See AI Coding Plan Usage/);
  assert.match(text, /What Is AI Coding Observability/);
  assert.match(text, /AI Coding Observability vs Jellyfish/);
  assert.ok(text.length > buildLlmsTxt(false).length);
});

test("native blog exposes canonical founder-authored posts", () => {
  assert.equal(BLOG_POSTS.length, 4);
  const flagship = BLOG_POSTS.find((post) => post.path === "/blog/ai-coding-observability-vs-jellyfish-dx-linearb");
  assert.ok(flagship);
  assert.equal(flagship!.author.name, "Dinuda Yaggahavita");
  assert.notEqual(flagship!.publishedAt, "");
  assert.equal(flagship!.socialImage.width, 1200);
  assert.equal(flagship!.socialImage.height, 630);
  assert.ok(flagship!.faq?.length);
  const graph = buildBlogPostJsonLd(flagship!);
  const article = graph.find((node) => node["@type"] === "BlogPosting");
  assert.ok(article);
  assert.equal((article!.author as { name: string }).name, "Dinuda Yaggahavita");
  assert.equal(article!.datePublished, "2026-07-25");
  assert.ok(graph.some((node) => node["@type"] === "FAQPage"));

  const original = BLOG_POSTS.find((post) => post.path === "/blog/what-is-ai-coding-observability");
  assert.ok(original);

  const codexbar = BLOG_POSTS.find((post) => post.path === "/blog/codexbar-for-teams");
  assert.ok(codexbar);
  assert.equal(codexbar!.primaryKeyword, "CodexBar for teams");
  assert.ok(buildSitemapEntries().some((entry) => entry.path === "/blog/codexbar-for-teams"));
});

test("every blog post ships answer-engine essentials", () => {
  for (const post of BLOG_POSTS) {
    assert.ok(post.category, `${post.slug} needs a category`);
    assert.ok(post.takeaways.length >= 3, `${post.slug} needs at least 3 takeaways`);
    assert.ok(post.faq && post.faq.length >= 3, `${post.slug} needs at least 3 FAQs`);
    assert.equal(post.socialImage.width, 1200, `${post.slug} social image must be 1200x630`);
    assert.equal(post.socialImage.height, 630, `${post.slug} social image must be 1200x630`);
    assert.ok(post.heroImage.alt.length > 40, `${post.slug} cover needs descriptive alt text`);
    const article = buildBlogPostJsonLd(post).find((node) => node["@type"] === "BlogPosting");
    assert.equal(article?.articleSection, post.category);
    assert.ok(Number(article?.wordCount) > 300);
  }
});

test("home JSON-LD includes FAQPage and unambiguous brand identity", () => {
  const graph = buildHomeJsonLd();
  const types = graph.map((node) => node["@type"]);
  const website = graph.find((node) => node["@type"] === "WebSite");
  const organization = graph.find((node) => node["@type"] === "Organization");
  const software = graph.find((node) => node["@type"] === "SoftwareApplication");
  const faq = graph.find((node) => node["@type"] === "FAQPage");
  assert.ok(types.includes("FAQPage"));
  assert.ok(types.includes("Organization"));
  assert.ok(types.includes("SoftwareApplication"));
  assert.deepEqual(website?.alternateName, ["usejunction", "Use Junction", "usejunction.dev"]);
  assert.deepEqual(organization?.sameAs, ["https://github.com/use-junction/usejunction"]);
  assert.match(String(website?.description), /Not Junction Panel/i);
  assert.match(String(software?.description), /usejunction\.dev/);
  assert.match(String(organization?.description), /not Junction Panel/i);
  const faqJson = JSON.stringify(faq);
  assert.match(faqJson, /Junction Panel/);
  assert.match(faqJson, /usejunction\.dev/);
  assert.equal(AEO_FACTS.privacyFirst, true);
  assert.equal(AEO_FACTS.workDetailOptional, true);
  assert.match(AEO_FACTS.notJunctionPanel, /usejunction\.dev/);
});

test("llms.txt cites a short brand-first path list", () => {
  assert.deepEqual([...AEO_CITE_PATHS], [
    "/",
    "/compare/junction-panel",
    "/solutions/ai-coding-spend-management",
    "/solutions/ai-coding-seat-utilization",
    "/guides/see-plan-usage-and-waste",
    "/blog/what-is-ai-coding-observability",
  ]);
});
