import { BLOG_POSTS } from "@/content/blog";
import { COMPARE_PAGES } from "@/content/compare";
import { FOR_PAGES } from "@/content/for";
import { GUIDES } from "@/content/guides";
import { LEGAL_PAGES } from "@/content/legal";
import { SOLUTIONS } from "@/content/solutions";
import type { ContentPage, SitemapEntry } from "@/content/types";

export const ALL_CONTENT_PAGES: ContentPage[] = [
  ...SOLUTIONS,
  ...GUIDES,
  ...COMPARE_PAGES,
  ...FOR_PAGES,
  ...LEGAL_PAGES,
];

export function getContentByPath(path: string): ContentPage | undefined {
  return ALL_CONTENT_PAGES.find((page) => page.path === path);
}

export function getContentByKindAndSlug(
  kind: ContentPage["kind"],
  slug: string,
): ContentPage | undefined {
  return ALL_CONTENT_PAGES.find((page) => page.kind === kind && page.slug === slug);
}

export function getRelatedPages(page: ContentPage): ContentPage[] {
  return page.relatedPaths
    .map((path) => getContentByPath(path))
    .filter((item): item is ContentPage => Boolean(item));
}

const HUB_BY_KIND: Record<ContentPage["kind"], { label: string; href: string } | null> = {
  guide: { label: "Guides", href: "/guides" },
  compare: { label: "Compare", href: "/compare" },
  for: { label: "For tools", href: "/for" },
  solution: { label: "Solutions", href: "/solutions" },
  blog: { label: "Blog", href: "/blog" },
  legal: null,
};

export function contentBreadcrumbs(page: ContentPage): { label: string; href?: string }[] {
  const crumbs: { label: string; href?: string }[] = [{ label: "Home", href: "/" }];
  const hub = HUB_BY_KIND[page.kind];
  if (hub) crumbs.push(hub);
  crumbs.push({ label: page.title });
  return crumbs;
}

export function buildSitemapEntries(): SitemapEntry[] {
  const home: SitemapEntry = {
    path: "/",
    lastModified: "2026-08-06",
    changeFrequency: "weekly",
    priority: 1,
  };

  const hubs: SitemapEntry[] = [
    { path: "/guides", lastModified: "2026-07-19", changeFrequency: "weekly", priority: 0.8 },
    { path: "/compare", lastModified: "2026-08-05", changeFrequency: "weekly", priority: 0.8 },
    // /for hub omitted — all /for/* pages are noindex to keep brand signals focused on home + solutions
    { path: "/solutions", lastModified: "2026-08-04", changeFrequency: "weekly", priority: 0.9 },
    { path: "/blog", lastModified: "2026-10-03", changeFrequency: "weekly", priority: 0.7 },
    { path: "/contact", lastModified: "2026-07-19", changeFrequency: "monthly", priority: 0.5 },
    { path: "/authors/dinuda-yaggahavita", lastModified: "2026-07-22", changeFrequency: "monthly", priority: 0.5 },
  ];

  const pages = ALL_CONTENT_PAGES.filter((page) => page.indexable !== false).map((page) => ({
    path: page.path,
    lastModified: page.updatedAt,
    changeFrequency: (page.kind === "legal" ? "yearly" : "monthly") as SitemapEntry["changeFrequency"],
    priority: page.kind === "blog" ? 0.6 : 0.8,
  }));

  const blogPages = BLOG_POSTS.map((post) => ({
    path: post.path,
    lastModified: post.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [home, ...hubs, ...blogPages, ...pages];
}

/** Priority cite URLs for answer engines — keep short so brand entity stays clear. */
export const AEO_CITE_PATHS = [
  "/",
  "/compare/junction-panel",
  "/solutions/ai-coding-spend-management",
  "/solutions/ai-coding-seat-utilization",
  "/guides/see-plan-usage-and-waste",
  "/blog/what-is-ai-coding-observability",
] as const;
