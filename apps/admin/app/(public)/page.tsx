import type { Metadata } from "next";
import { HERO_VIDEO } from "@/lib/public/home-cta";
import { UseJunctionHomeContent } from "@/components/public/use-junction-home-content";
import { siteConfig } from "@/lib/public/config";
import { siteOgImage } from "@/lib/public/seo-metadata";
import { absoluteUrl } from "@/lib/public/site-url";

export const metadata: Metadata = {
  title: { absolute: siteConfig.seoTitle },
  description: siteConfig.description,
  keywords: [...siteConfig.homeSeoKeywords],
  alternates: {
    canonical: absoluteUrl("/"),
  },
  openGraph: {
    title: siteConfig.seoTitle,
    description: siteConfig.description,
    url: absoluteUrl("/"),
    siteName: siteConfig.name,
    type: "website",
    locale: "en_US",
    images: [siteOgImage],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.seoTitle,
    description: siteConfig.description,
    images: [siteOgImage.url],
  },
};

// Signed-in visitors see the homepage too; the header gives them a Dashboard button (see the public layout).
export default function HomePage() {
  return (
    <>
      <link rel="preload" href={HERO_VIDEO.poster} as="image" />
      <UseJunctionHomeContent />
    </>
  );
}
