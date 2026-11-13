"use client";

import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { HeroSection } from "@/components/public/hero-section";
import { HomeFaq } from "@/components/public/home-faq";
import { HomeHowItStarts } from "@/components/public/home-how-it-starts";
import { HomePricing } from "@/components/public/home-pricing";
import { HomePaidTwiceBand, HomeWeeksChapter } from "@/components/public/home-story";
import { HomeRoles } from "@/components/public/home-roles";
import { HomeVendorCompare } from "@/components/public/home-vendor-compare";
import { HomeWork } from "@/components/public/home-work";
import { HomePrivacyFlow } from "@/components/public/home-world-class";
import { SiteFooter } from "@/components/public/site-footer";
import { ToolLogosStrip } from "@/components/public/tool-logos-strip";
import { siteConfig } from "@/lib/public/config";
import { HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";
import { buildHomeJsonLd } from "@/lib/public/json-ld";
import { USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";

export function UseJunctionHomeContent() {
  const jsonLd = buildHomeJsonLd();

  return (
    <main className="bg-white">
      {jsonLd.map((data, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
      ))}

      <HeroSection />
      <ToolLogosStrip />

      {/* Three problems for an example team, one picture each: limits, duplicate seats, where the spend landed. */}
      <HomeWeeksChapter />
      <HomePaidTwiceBand />
      <HomeWork />

      {/* Why the tools' own admin pages don't answer it, who asks, then the price and what happens after sign-up. */}
      <HomeVendorCompare />
      <HomeRoles />
      <HomePricing />
      <HomeHowItStarts />

      <HomePrivacyFlow />
      <HomeFaq />

      <section aria-labelledby="home-close-heading" className="bg-primary">
        <div className="mx-auto flex w-full max-w-[75rem] flex-col items-start gap-10 px-4 pb-[4.5rem] pt-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:pb-[7.5rem] lg:pt-28">
          <h2
            id="home-close-heading"
            className="max-w-[13em] text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.03em] !text-white [text-wrap:balance] sm:text-5xl lg:text-[3.5rem]"
          >
            Connect your own laptop first. Invite the team if it’s worth it.
          </h2>
          <div className="flex w-full shrink-0 flex-col items-stretch sm:w-auto sm:items-start">
            <Link
              href={HOME_SIGNUP_HREF}
              className="public-btn public-btn-cta rounded-none"
            >
              {HOME_SIGNUP_LABEL}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            <p className="mt-4 text-[0.9375rem] text-primary-pale">Free for {USER_LIMIT_FREE} seats. No card.</p>
            <a
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3.5 inline-flex items-center gap-2 self-start border-b !border-white/60 pb-0.5 text-[0.9375rem] font-semibold !text-white"
            >
              <Github className="size-4" aria-hidden />
              Self-host from GitHub
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
