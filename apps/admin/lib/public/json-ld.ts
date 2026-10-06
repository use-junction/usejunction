import type { BlogPost, ContentFaq, ContentPage, HowToStep } from "@/content/types";
import { AEO_FACTS } from "@/content/aeo/facts";
import { HOME_FAQS } from "@/lib/public/home-faqs";
import { OBSERVABILITY_FEATURES, siteConfig, twitterUrl } from "@/lib/public/config";
import { absoluteUrl, getSiteUrl } from "@/lib/public/site-url";
import {
  USER_LIMIT_FREE,
  TEAM_PRICE_PER_DEV_USD,
} from "@/lib/saas-billing/entitlements";

const ENTITY_DESCRIPTION = `${siteConfig.description} Official brand: UseJunction at https://usejunction.dev. Not Junction Panel (junctionpanel.dev).`;

function faqEntities(faqs: ContentFaq[]) {
  return faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  }));
}

function buildBreadcrumbs(page: ContentPage) {
  const baseUrl = getSiteUrl();
  const url = absoluteUrl(page.path);
  const hubByKind: Record<ContentPage["kind"], { name: string; path: string } | null> = {
    guide: { name: "Guides", path: "/guides" },
    compare: { name: "Compare", path: "/compare" },
    for: { name: "For tools", path: "/for" },
    solution: { name: "Solutions", path: "/solutions" },
    blog: { name: "Blog", path: "/blog" },
    legal: null,
  };
  const hub = hubByKind[page.kind];
  const items = [{ "@type": "ListItem", position: 1, name: "Home", item: baseUrl }];
  if (hub) {
    items.push({ "@type": "ListItem", position: 2, name: hub.name, item: absoluteUrl(hub.path) });
    items.push({ "@type": "ListItem", position: 3, name: page.title, item: url });
  } else {
    items.push({ "@type": "ListItem", position: 2, name: page.title, item: url });
  }
  return items;
}

export function buildHomeJsonLd() {
  const baseUrl = getSiteUrl();

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteConfig.name,
      alternateName: ["usejunction", "Use Junction", "usejunction.dev"],
      url: baseUrl,
      description: ENTITY_DESCRIPTION,
      publisher: { "@id": `${baseUrl}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${baseUrl}/#organization`,
      name: siteConfig.name,
      legalName: "UseJunction",
      url: baseUrl,
      description: `${siteConfig.tagline}. ${AEO_FACTS.notJunctionPanel}`,
      logo: absoluteUrl("/icons/icon-192.png"),
      email: "hello@usejunction.dev",
      sameAs: [siteConfig.githubUrl, twitterUrl].filter(Boolean),
      knowsAbout: [
        "AI coding spend management",
        "AI coding seat utilization",
        "CodexBar for teams",
        "CodexBar for Windows teams",
        "Cursor usage tracking",
        "Claude Code plan usage",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: siteConfig.name,
      alternateName: ["usejunction", "Use Junction"],
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "AI coding observability",
      operatingSystem: "Web, Windows, macOS, Linux",
      description: ENTITY_DESCRIPTION,
      url: baseUrl,
      license: `${siteConfig.githubUrl}/blob/main/LICENSE`,
      featureList: OBSERVABILITY_FEATURES.map((feature) => feature.title),
      offers: [
        {
          "@type": "Offer",
          name: "Community",
          price: "0",
          priceCurrency: "USD",
          description: `Self-hosted under Community License, up to ${USER_LIMIT_FREE} seats free`,
        },
        {
          "@type": "Offer",
          name: "Managed",
          price: String(TEAM_PRICE_PER_DEV_USD),
          priceCurrency: "USD",
          description: "Per active developer / month — we host and run it for you",
        },
      ],
      publisher: { "@id": `${baseUrl}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqEntities(HOME_FAQS),
    },
  ];
}

/** @deprecated use buildHomeJsonLd */
export function buildJsonLd() {
  return buildHomeJsonLd();
}

export function buildContentJsonLd(page: ContentPage) {
  const url = absoluteUrl(page.path);
  const baseUrl = getSiteUrl();
  const graph: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.title,
      description: page.description,
      url,
      isPartOf: { "@type": "WebSite", name: siteConfig.name, url: baseUrl },
      dateModified: page.updatedAt,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: buildBreadcrumbs(page),
    },
  ];

  if (page.faq.length) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqEntities(page.faq),
    });
  }

  if (page.howTo) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: page.howTo.name,
      description: page.howTo.description,
      step: page.howTo.steps.map((step: HowToStep, index: number) => ({
        "@type": "HowToStep",
        position: index + 1,
        name: step.name,
        text: step.text,
      })),
    });
  }

  return graph;
}

function blogWordCount(post: BlogPost): number {
  const inline = (parts: { text: string }[]) => parts.map((part) => part.text).join(" ");
  const text = [
    post.answer,
    ...post.takeaways,
    ...post.blocks.map((block) => {
      if (block.type === "heading") return block.text;
      if (block.type === "list") return block.items.map(inline).join(" ");
      if (block.type === "image") return "";
      return inline(block.content);
    }),
    ...(post.faq ?? []).flatMap((item) => [item.question, item.answer]),
  ].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

export function buildBlogPostJsonLd(post: BlogPost) {
  const url = absoluteUrl(post.path);
  const authorUrl = absoluteUrl(post.author.path);
  const baseUrl = getSiteUrl();
  const graph: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      headline: post.title,
      description: post.description,
      abstract: post.answer,
      image: [post.socialImage, post.heroImage].map((image) => ({
        "@type": "ImageObject",
        url: absoluteUrl(image.src),
        width: image.width,
        height: image.height,
        caption: image.alt,
      })),
      thumbnailUrl: absoluteUrl(post.heroImage.src),
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      inLanguage: "en",
      articleSection: post.category,
      wordCount: blogWordCount(post),
      timeRequired: `PT${post.readingMinutes}M`,
      keywords: [post.primaryKeyword, ...(post.secondaryKeywords ?? []), ...post.topics].join(", "),
      about: { "@type": "Thing", name: post.primaryKeyword },
      mentions: post.topics.map((name) => ({ "@type": "Thing", name })),
      isPartOf: { "@type": "Blog", "@id": `${absoluteUrl("/blog")}#blog`, name: `${siteConfig.name} Blog`, url: absoluteUrl("/blog") },
      author: {
        "@type": "Person",
        name: post.author.name,
        url: authorUrl,
        sameAs: post.author.links.map((item) => item.href),
      },
      publisher: {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        name: siteConfig.name,
        url: baseUrl,
        logo: { "@type": "ImageObject", url: absoluteUrl("/icons/icon-192.png") },
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
        { "@type": "ListItem", position: 2, name: "Blog", item: absoluteUrl("/blog") },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];

  if (post.faq?.length) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqEntities(post.faq),
    });
  }

  return graph;
}

export function buildHubJsonLd(opts: { name: string; description: string; path: string; items: { name: string; path: string }[] }) {
  const url = absoluteUrl(opts.path);
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: opts.name,
      description: opts.description,
      url,
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: opts.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: absoluteUrl(item.path),
      })),
    },
  ];
}
