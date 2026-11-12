import type { Metadata } from "next";
import type { BlogPost, ContentPage } from "@/content/types";
import { absoluteUrl, getSiteUrl } from "@/lib/public/site-url";
import { siteConfig } from "@/lib/public/config";

/**
 * Screenshot of the homepage hero, used for link previews in chat/social apps.
 * Regenerate with `node scripts/capture-og-image.mjs` whenever the hero changes; give the file a
 * new name when you do, since WhatsApp, Slack and others cache previews by image URL.
 */
export const siteOgImage = {
  url: "/og-home-v2.png",
  width: 1200,
  height: 630,
  alt: `${siteConfig.name} homepage: see where your AI coding spend goes`,
} as const;

export function contentPageMetadata(page: ContentPage): Metadata {
  const url = absoluteUrl(page.path);
  return {
    title: page.title,
    description: page.description,
    keywords: [page.primaryKeyword, ...page.secondaryKeywords],
    alternates: { canonical: url },
    openGraph: {
      title: page.title,
      description: page.description,
      url,
      siteName: siteConfig.name,
      type: page.kind === "blog" ? "article" : "website",
      locale: "en_US",
      images: [siteOgImage],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [siteOgImage.url],
    },
    robots: { index: page.indexable !== false, follow: true },
  };
}

export function hubMetadata(opts: {
  title: string;
  description: string;
  path: string;
  indexable?: boolean;
}): Metadata {
  const url = absoluteUrl(opts.path);
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      siteName: siteConfig.name,
      type: "website",
      images: [siteOgImage],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [siteOgImage.url],
    },
    robots: { index: opts.indexable !== false, follow: true },
  };
}

export function blogPostMetadata(post: BlogPost): Metadata {
  const url = absoluteUrl(post.path);
  const image = {
    url: post.socialImage.src,
    width: post.socialImage.width,
    height: post.socialImage.height,
    alt: post.socialImage.alt,
  };
  return {
    title: post.title,
    description: post.description,
    keywords: [post.primaryKeyword, ...(post.secondaryKeywords ?? []), ...post.topics],
    authors: [{ name: post.author.name, url: absoluteUrl(post.author.path) }],
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      locale: "en_US",
      url,
      siteName: siteConfig.name,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [absoluteUrl(post.author.path)],
      tags: post.topics,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [post.socialImage.src],
    },
    robots: { index: true, follow: true },
  };
}

export { absoluteUrl, getSiteUrl };
