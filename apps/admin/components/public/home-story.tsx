import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Real screenshots of the app for the example team "Northwind Labs" (anonymised, from
 * apps/admin/blog-src/check-claude-team-usage), with notes placed by hand. Note positions are
 * percentages of the screenshot, so they stay on target as it scales.
 */

function Note({
  children,
  style,
  arrow,
}: {
  children: ReactNode;
  style: CSSProperties;
  arrow: { box: CSSProperties; viewBox: string; paths: string[] };
}) {
  return (
    <span className="home-note" style={style}>
      {children}
      <svg viewBox={arrow.viewBox} style={arrow.box} aria-hidden>
        {arrow.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/** Wide screenshots keep their size on phones and scroll sideways rather than shrinking to unreadable. */
function ShotScroll({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("-mr-4 overflow-x-auto sm:-mr-6 lg:mr-0 lg:overflow-visible", className)}>
      <div className="min-w-[820px] lg:min-w-0">{children}</div>
    </div>
  );
}

const H2 = "text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] [text-wrap:balance] sm:text-[2.6rem] lg:text-[2.9rem]";

export function HomeWeeksChapter() {
  return (
    <section id="product" aria-labelledby="home-weeks-heading" className="scroll-mt-20 overflow-x-clip bg-white pt-24 sm:pt-32 lg:pt-44">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
          <h2 id="home-weeks-heading" className={H2}>
            You’ve probably had one of these weeks.
          </h2>
          <div>
            <p className="max-w-md text-base leading-7 text-[#3a3b37] sm:text-[1.0625rem]">
              One person is about to run out of Claude. Another has barely opened it. Here is that week for an example
              team of four.
            </p>
            <Link
              href="/guides/claude-team-usage-limits"
              className="mt-5 inline-block border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
            >
              How Claude Team limits work
            </Link>
          </div>
        </div>

        <ShotScroll className="mt-12 lg:mt-[4.5rem]">
          <figure className="relative border border-border bg-white lg:-mr-[7.5rem] lg:border-r-0">
            <Image
              src="/home/claude-limits.png"
              alt="UseJunction's Claude page for an example team: what the team pays, usage at API prices, and each person's weekly and 5-hour limit use. Priya is at 97% of her weekly limit on a Standard seat; Elena is at 6%."
              width={2304}
              height={1595}
              sizes="(max-width: 1024px) 820px, 1272px"
              className="h-auto w-full"
            />
            <Note
              style={{ left: "63%", top: "39.5%", transform: "rotate(-1.5deg)" }}
              arrow={{
                viewBox: "0 0 96 108",
                box: { left: -92, top: 22, width: 96, height: 108 },
                paths: ["M92 4C66 8 30 30 16 94", "M8 73l8 23 20-13"],
              }}
            >
              On Standard, at 97% of her week
            </Note>
            <Note
              style={{ left: "65%", top: "85.5%", transform: "rotate(1deg)" }}
              arrow={{
                viewBox: "0 0 72 30",
                box: { left: -74, top: 8, width: 72, height: 30 },
                paths: ["M70 6C50 2 28 6 6 20", "M12 4L5 21l18 2"],
              }}
            >
              6% all week. A quiet seat.
            </Note>
          </figure>
        </ShotScroll>
      </div>
    </section>
  );
}

export function HomePaidTwiceBand() {
  return (
    <section aria-labelledby="home-paid-twice-heading" className="mt-24 bg-brand-yellow sm:mt-32 lg:mt-44">
      <div className="mx-auto w-full max-w-6xl px-4 pb-[4.5rem] pt-16 sm:px-6 lg:px-0 lg:pb-32 lg:pt-[7.5rem]">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-20">
          <h2
            id="home-paid-twice-heading"
            className="text-[4rem] font-bold leading-[0.95] tracking-[-0.05em] sm:text-[5rem] lg:text-[6.5rem]"
          >
            Paid twice.
          </h2>
          <div>
            <p className="max-w-md text-[1.0625rem] leading-7 text-foreground sm:text-[1.1875rem] sm:leading-8">
              A personal login on a work machine, where the company already pays for a seat. In this example team it
              happens nine times.
            </p>
            <Link
              href="/guides/personal-vs-company-api-keys"
              className="mt-5 inline-block border-b !border-current pb-px text-[0.9375rem] font-semibold"
            >
              How personal and company logins are told apart
            </Link>
          </div>
        </div>

        <ShotScroll className="mt-12 pt-8 lg:mt-[4.75rem] lg:pt-0">
          <figure className="relative border-2 !border-foreground bg-white">
            <Image
              src="/home/tool-accounts.png"
              alt="UseJunction's Tool accounts page for an example team: 16 of 26 logins on work machines are personal, 9 are paid twice, and 7 are outside company plans."
              width={2304}
              height={970}
              sizes="(max-width: 1024px) 820px, 1152px"
              className="h-auto w-full"
            />
            <Note
              style={{ left: "46%", top: -27, transform: "rotate(-1.5deg)", background: "#fff" }}
              arrow={{
                viewBox: "0 0 100 80",
                box: { left: -92, top: "100%", width: 100, height: 80 },
                paths: ["M96 4C92 40 60 62 10 66", "M28 50L8 66l21 11"],
              }}
            >
              The company already pays for a seat here
            </Note>
          </figure>
        </ShotScroll>
      </div>
    </section>
  );
}
