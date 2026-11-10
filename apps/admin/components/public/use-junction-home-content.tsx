"use client";

import { ArrowRight, Check, Plus } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HeroSection } from "@/components/public/hero-section";
import { HomeWorldClass } from "@/components/public/home-world-class";
import { ToolLogosStrip } from "@/components/public/tool-logos-strip";
import { CalendlyTalkButton } from "@/components/public/calendly-talk-button";
import { SiteFooter } from "@/components/public/site-footer";
import { PRICING_PLANS } from "@/lib/public/config";
import { HOME_PRICE_LINE, HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";
import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import { buildHomeJsonLd } from "@/lib/public/json-ld";
import { HOME_FAQS } from "@/lib/public/home-faqs";
import { cn } from "@/lib/utils";

export function UseJunctionHomeContent() {
  const jsonLd = buildHomeJsonLd();

  return (
    <main>
      {jsonLd.map((data, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
      ))}

      <HeroSection />

      <ToolLogosStrip />

      <HomeWorldClass />

      <section id="pricing" className="scroll-mt-20 bg-white py-16 sm:py-20 lg:py-24">
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 xl:px-12">
          <div className="mx-auto max-w-6xl">
            <h2 className="max-w-2xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl lg:text-[2.5rem]">
              ${TEAM_PRICE_PER_DEV_USD} per active developer. Free for your first {USER_LIMIT_FREE} seats.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              One idle Cursor seat costs as much as UseJunction for 30 developers.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:mt-16 lg:grid-cols-3 lg:items-center lg:gap-5">
            {PRICING_PLANS.map((plan) => {
              const isCommunity = plan.id === "community";
              const featured = plan.featured;
              return (
                <article
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col bg-white p-6 sm:p-8",
                    featured
                      ? "pricing-card-managed border-2 border-[#9fd4df]"
                      : cn(
                          "pricing-card-side",
                          isCommunity ? "border border-[#08a8c4]/40" : "border order",
                        ),
                  )}
                >
                  {"badge" in plan && plan.badge ? (
                    <span className="absolute right-5 top-5 text-xs font-semibold text-[#08758a]">
                      {plan.badge}
                    </span>
                  ) : null}

                  <div className="flex items-baseline gap-2">
                    <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                    {isCommunity ? (
                      <span className="text-xs font-medium text-[#08a8c4]">{plan.description}</span>
                    ) : null}
                  </div>

                  <div className="mt-6">
                    <p className="text-4xl font-semibold tracking-[-0.03em]">{plan.price}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.period}</p>
                  </div>

                  {"calendly" in plan.cta && plan.cta.calendly ? (
                    <CalendlyTalkButton
                      label={plan.cta.label}
                      className="mt-6 public-btn-outline hover:border-[#08a8c4] hover:text-[#08a8c4]"
                    />
                  ) : (
                    <a
                      href={plan.cta.href}
                      className={cn(
                        "public-btn mt-6 w-full rounded-none font-semibold",
                        featured
                          ? "public-btn-yellow"
                          : "public-btn-outline hover:border-[#08a8c4] hover:text-[#08a8c4]",
                      )}
                    >
                      {plan.cta.label}
                      {featured ? <ArrowRight className="h-4 w-4" /> : null}
                    </a>
                  )}

                  <ul className="mt-8 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-6 text-[#5c5e56]">
                        <Check className="mt-0.5 size-4 shrink-0 text-[#08a8c4]" strokeWidth={2.25} />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {plan.premiumFeatures.length > 0 ? (
                    <>
                      <div className="my-6 flex items-center gap-3" aria-hidden>
                        <div className="h-px flex-1 bg-border" />
                        <Plus className="size-3.5 text-[#08a8c4]" strokeWidth={2.5} />
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <ul className="space-y-3">
                        {plan.premiumFeatures.map((feature) => (
                          <li key={feature} className="flex gap-3 text-sm leading-6">
                            <Check className="mt-0.5 size-4 shrink-0 text-[#08a8c4]" strokeWidth={2.25} />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 bg-white py-16 sm:py-20 lg:py-24">
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 xl:px-12">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
            <div>
              <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.5rem]">
                Clear answers before you start.
              </h2>
            </div>
            <Accordion type="single" collapsible className="border-t order">
              {HOME_FAQS.map((faq, index) => (
                <AccordionItem key={faq.question} value={`faq-${index}`}>
                  <AccordionTrigger className="py-6 text-left text-base font-semibold md:text-lg">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="max-w-2xl pb-6 text-sm leading-7 text-muted-foreground md:text-base">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      <section aria-labelledby="home-close-heading" className="border-y border-border bg-[var(--public-bg)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-0 lg:py-20">
          <h2
            id="home-close-heading"
            className="max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl lg:text-[2.6rem]"
          >
            Find the seats you’re paying for and not using.
          </h2>
          <div className="flex w-full shrink-0 flex-col items-stretch sm:w-auto sm:items-start">
            <a href={HOME_SIGNUP_HREF} className="public-btn public-btn-teal rounded-none px-8 py-3 text-base font-semibold">
              {HOME_SIGNUP_LABEL}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </a>
            <p className="mt-4 text-sm text-[#5c5e56]">{HOME_PRICE_LINE}</p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
