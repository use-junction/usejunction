import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Cloud, Server } from "lucide-react";
import { HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";
import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";

/** Cursor Teams seat price used for the comparison (cursor.com/docs/account/teams/pricing, Nov 2026). Re-check before changing copy. */
export const CURSOR_SEAT_USD = 30;

export function HomePricing() {
  const developers = Math.round(CURSOR_SEAT_USD / TEAM_PRICE_PER_DEV_USD);
  const cells = Array.from({ length: developers });

  return (
    <section id="pricing" aria-labelledby="home-pricing-heading" className="scroll-mt-20 mt-24 bg-brand-yellow-pale sm:mt-32 lg:mt-44">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-[4.5rem] pt-16 sm:px-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-[5.5rem] lg:px-0 lg:pb-[7.5rem] lg:pt-28">
        <div>
          <p aria-hidden className="text-[7.5rem] font-bold leading-[0.85] tracking-[-0.06em] sm:text-[11.5rem]">
            ${TEAM_PRICE_PER_DEV_USD}
          </p>
          <h2 id="home-pricing-heading" className="mt-6 text-[1.5rem] font-semibold leading-snug tracking-[-0.015em]">
            <span className="sr-only">${TEAM_PRICE_PER_DEV_USD} </span>per active developer a month. Your first{" "}
            {USER_LIMIT_FREE} seats are free.
          </h2>
          <Link
            href={HOME_SIGNUP_HREF}
            className="public-btn public-btn-teal mt-8 w-full rounded-none px-8 py-3 text-base font-semibold sm:w-auto"
          >
            {HOME_SIGNUP_LABEL}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>

        <div>
          <figure className="border-[1.5px] !border-foreground bg-white px-5 py-6 sm:px-8 sm:py-[30px]">
            <figcaption className="text-[0.9375rem] font-semibold">
              What about ${CURSOR_SEAT_USD} a month pays for
            </figcaption>
            <div className="mt-6">
              <p className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
                <Image src="/tool-logos/cursor.svg" alt="" width={20} height={20} aria-hidden />
                One idle Cursor seat
              </p>
              <div aria-hidden className="mt-2.5 h-5 bg-[var(--public-warning)]" />
            </div>
            <div className="mt-6">
              <p className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
                <Image src="/favicon.svg" alt="" width={20} height={20} aria-hidden />
                UseJunction for {developers} developers
              </p>
              <div aria-hidden className="mt-2.5 flex gap-0.5 sm:gap-1">
                {cells.map((_, index) => (
                  <span key={index} className="h-4 flex-1 bg-primary sm:h-5" />
                ))}
              </div>
            </div>
            <div
              aria-hidden
              className="mt-3.5 flex justify-between border-t border-border pt-2 text-xs tabular-nums text-muted-foreground"
            >
              {[0, 10, 20, 30].map((value) => (
                <span key={value}>${value}</span>
              ))}
            </div>
          </figure>

          <ul className="mt-8 grid gap-5 sm:grid-cols-2 sm:gap-8">
            <li className="flex items-start gap-3.5">
              <Cloud className="mt-0.5 size-[26px] shrink-0 text-primary" strokeWidth={1.7} aria-hidden />
              <div>
                <p className="text-[1.0625rem] font-semibold">Hosted by us</p>
                <p className="text-[0.9375rem] text-[#3a3b37]">
                  Free for {USER_LIMIT_FREE} seats, then ${TEAM_PRICE_PER_DEV_USD} each
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3.5">
              <Server className="mt-0.5 size-[26px] shrink-0 text-primary" strokeWidth={1.7} aria-hidden />
              <div>
                <p className="text-[1.0625rem] font-semibold">Self-hosted</p>
                <p className="text-[0.9375rem] text-[#3a3b37]">Free for up to {USER_LIMIT_FREE} seats</p>
              </div>
            </li>
          </ul>
          <p className="mt-7 text-[0.9375rem] text-[#3a3b37]">
            Need SSO or an SLA?{" "}
            <Link
              href="/contact?intent=enterprise"
              className="border-b !border-current pb-px font-semibold text-foreground transition-colors hover:text-primary"
            >
              Talk to us
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
