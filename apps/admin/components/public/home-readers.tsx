import type { ReactNode } from "react";
import { HOME_H2, HOME_SECTION, Meter, Muted, SeatSplit } from "@/components/public/home-bits";
import { DINUDA_YAGGAHAVITA } from "@/content/authors";
import { cn } from "@/lib/utils";

function Reader({ art, who, title, text }: { art: ReactNode; who: string; title: string; text: string }) {
  return (
    <article>
      <div className="flex h-56 flex-col justify-center gap-2.5 border border-border bg-[var(--public-bg)] p-6 text-[0.8125rem] leading-snug">
        {art}
      </div>
      <p className="mt-7 text-sm font-medium text-primary">{who}</p>
      <h3 className="mt-1.5 text-[1.4rem] font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="mt-3 text-[0.9375rem] leading-7 text-muted-foreground">{text}</p>
    </article>
  );
}

function PersonRow({ name, percent, hot = false }: { name: string; percent: number; hot?: boolean }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 border border-border bg-white px-3 py-2.5">
      <span className="font-semibold">{name}</span>
      <Meter percent={percent} hot={hot} />
    </div>
  );
}

function RenewalRow({ plan, date, used, total }: { plan: string; date: string; used: number; total: number }) {
  return (
    <div className="border border-border bg-white px-3.5 py-3">
      <p className="font-semibold">
        {plan} renews {date}
      </p>
      <p className="mb-2.5 text-xs text-muted-foreground">
        {total} seats paid, {used} in use
      </p>
      <SeatSplit used={used} total={total} />
    </div>
  );
}

function SwitchRow({ label, detail, on }: { label: string; detail: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-white px-3.5 py-3">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <span aria-hidden className={cn("relative h-5 w-[34px] shrink-0", on ? "bg-primary" : "bg-[#d6d8d0]")}>
        <span className={cn("absolute top-[3px] size-[14px] bg-white", on ? "right-[3px]" : "left-[3px]")} />
      </span>
    </div>
  );
}

export function HomeReaders() {
  return (
    <section aria-labelledby="home-readers-heading" className={HOME_SECTION}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <h2 id="home-readers-heading" className={cn(HOME_H2, "max-w-md")}>
          One picture. <Muted>Three people who need it.</Muted>
        </h2>
        <div className="mt-12 grid gap-14 md:grid-cols-3 md:gap-9 lg:mt-16">
          <Reader
            who="For the engineering lead"
            title="Who uses what."
            text="Per-person usage and plan limits across every tool, so seat decisions stop being guesses."
            art={
              <>
                <PersonRow name="Marco D." percent={9} />
                <PersonRow name="Aiko T." percent={96} hot />
                <PersonRow name="Ben W." percent={48} />
              </>
            }
          />
          <Reader
            who="For finance"
            title="What renewal should cost."
            text="Seats paid against seats used for each plan, before the invoice lands."
            art={
              <>
                <RenewalRow plan="Cursor Teams" date="3 Dec" used={14} total={18} />
                <RenewalRow plan="Copilot Business" date="14 Dec" used={9} total={12} />
              </>
            }
          />
          <Reader
            who="For the developer"
            title="Their own switch."
            text="Every developer sees their own numbers and decides what their login shares."
            art={
              <>
                <SwitchRow label="Usage collection" detail="Tools, models, tokens" on />
                <SwitchRow label="Work-session detail" detail="Asks and change summaries" on={false} />
              </>
            }
          />
        </div>
      </div>
    </section>
  );
}

/** DRAFT quote written from the author bio; the founder should replace it with their own words. */
export function HomeFounderNote() {
  const author = DINUDA_YAGGAHAVITA;
  return (
    <section aria-label="Why we built UseJunction" className={HOME_SECTION}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <figure className="grid border border-border bg-[var(--public-bg)] md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="px-6 py-9 sm:px-12 sm:py-14 lg:px-16 lg:py-[4.5rem]">
            <blockquote className="text-[1.375rem] font-medium leading-[1.35] tracking-[-0.02em] [text-wrap:balance] sm:text-[1.8rem]">
              “Every AI coding tool came with its own bill and its own admin page, and nobody could tell us which seats
              were actually used. We built UseJunction to answer that without watching what developers type.”
            </blockquote>
            <figcaption className="mt-7 text-[0.9375rem] text-muted-foreground">
              <span className="font-semibold text-foreground">{author.name}</span>, founder of UseJunction
            </figcaption>
          </div>
          <div
            aria-hidden
            className="flex h-28 items-center justify-center bg-primary-pale text-4xl font-bold tracking-[-0.04em] text-primary-dark md:h-auto md:text-6xl"
          >
            {author.initials}
          </div>
        </figure>
      </div>
    </section>
  );
}
