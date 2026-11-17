import type { Metadata } from "next";
import { Suspense } from "react";
import { DM_Sans, Figtree, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { WebAnalytics } from "@/components/web-analytics";
import { siteConfig } from "@/lib/public/config";
import { siteOgImage } from "@/lib/public/seo-metadata";
import { siteIcons } from "@/lib/public/site-icons";
import { getSiteUrl } from "@/lib/public/site-url";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: siteConfig.seoTitle,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [
    "UseJunction",
    "usejunction.dev",
    "AI coding spend management",
    "AI coding seat waste",
    "Cursor Claude Code usage for teams",
    "self-hosted AI coding analytics",
  ],
  authors: [{ name: siteConfig.name, url: getSiteUrl() }],
  creator: siteConfig.name,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: getSiteUrl(),
    siteName: siteConfig.name,
    title: siteConfig.seoTitle,
    description: siteConfig.description,
    images: [siteOgImage],
  },
  twitter: {
    card: "summary_large_image",
    ...(siteConfig.twitterHandle
      ? { site: siteConfig.twitterHandle, creator: siteConfig.twitterHandle }
      : {}),
    title: siteConfig.seoTitle,
    description: siteConfig.description,
    images: [siteOgImage.url],
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : {},
  },
  icons: siteIcons,
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${figtree.variable} ${jetbrainsMono.variable}`}>
        <AppProviders><Suspense fallback={null}>{children}</Suspense></AppProviders>
        {/* Loads only on the hosted site; the component checks the domain in the browser. */}
        <WebAnalytics />
      </body>
    </html>
  );
}
