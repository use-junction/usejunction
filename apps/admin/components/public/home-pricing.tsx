import Link from "next/link";
import { ArrowRight, Cloud, Github, Server, type LucideIcon } from "lucide-react";
import { siteConfig } from "@/lib/public/config";
import { HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";
import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";

type Option = {
  icon: LucideIcon;
  name: string;
  line: string;
  price: string;
  priceLine: string;
  link: { href: string; label: string; external?: boolean };
};

const OPTIONS: Option[] = [
  {
    icon: Cloud,
    name: "Hosted",
    line: "We run it.",
    price: `Free for ${USER_LIMIT_FREE} seats`,
    priceLine: `then $${TEAM_PRICE_PER_DEV_USD} each`,
    link: { href: HOME_SIGNUP_HREF, label: HOME_SIGNUP_LABEL },
  },
  {
    icon: Server,
    name: "Self-hosted",
    line: "Your server, from GitHub.",
    price: `Free for up to ${USER_LIMIT_FREE} seats`,
    priceLine: "Community License",
    link: { href: siteConfig.githubUrl, label: "Get it on GitHub", external: true },
  },
];

export function HomePricing() {
  return (
    <section id="pricing" aria-labelledby="home-pricing-heading" className="scroll-mt-20 bg-brand-yellow-pale">
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
            className="public-btn public-btn-cta mt-8 w-full rounded-none sm:w-auto"
          >
            {HOME_SIGNUP_LABEL}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>

        <div>
          <ul aria-label="Plans" className="border-t-2 !border-foreground">
            {OPTIONS.map((option) => (
              <li
                key={option.name}
                className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 border-b !border-[rgba(17,18,16,0.18)] py-5 sm:grid-cols-[30px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-x-[22px] sm:py-[26px]"
              >
                <option.icon className="size-7 text-primary" strokeWidth={1.7} aria-hidden />
                <div>
                  <p className="text-[1.3rem] font-semibold tracking-[-0.015em]">{option.name}</p>
                  <p className="text-[0.9375rem] text-[#3a3b37]">{option.line}</p>
                </div>
                <div className="col-start-2 sm:col-start-auto">
                  <p className="text-lg font-semibold">{option.price}</p>
                  <p className="text-[0.9375rem] text-[#3a3b37]">{option.priceLine}</p>
                </div>
                <Link
                  href={option.link.href}
                  {...(option.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="col-start-2 inline-flex items-center gap-2 justify-self-start border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary sm:col-start-auto"
                >
                  {option.link.external ? <Github className="size-4" aria-hidden /> : null}
                  {option.link.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[0.9375rem] text-[#3a3b37]">
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
