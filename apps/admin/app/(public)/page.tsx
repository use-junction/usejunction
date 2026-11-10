import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
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

export default async function HomePage() {
  if ((await auth())?.user?.id) {
    redirect("/auth/continue?from=%2Fdashboard");
  }

  return (
    <>
      <link rel="preload" href={HERO_VIDEO.poster} as="image" />
      <UseJunctionHomeContent />
    </>
  );
}
