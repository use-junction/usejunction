import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { DecorativeToolIcon } from "@/components/public/tool-logos-strip";
import { cn } from "@/lib/utils";

/**
 * The homepage pictures are drawn from one example team, "Northwind Labs": 38 people, Claude Team
 * (30 Standard and 8 Premium seats) and Cursor Teams (24 seats), about $42,540 a month of usage.
 * Seat prices are list prices billed monthly, read in November 2026. Keep the numbers in step
 * across home-story, home-work, home-vendor-compare and home-roles.
 */

/** A hand-placed note. From `lg` it sits where `style` puts it; below that it drops into the flow. */
export function Note({
  children,
  style,
  arrow,
  className,
}: {
  children: ReactNode;
  style: CSSProperties;
  arrow: { box: CSSProperties; viewBox: string; paths: string[] };
  className?: string;
}) {
  return (
    <span className={cn("home-note", className)} style={style}>
      {children}
      <svg viewBox={arrow.viewBox} style={arrow.box} aria-hidden>
        {arrow.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/** Wraps a picture's notes, positioned over it from `lg`. Below that each note is a PinNote under the thing it is about. */
export function Notes({ children }: { children: ReactNode }) {
  return <div className="hidden lg:contents">{children}</div>;
}

/**
 * Below `lg`: the same note, placed straight under what it is about, with a short arrow pointing up at it.
 * `align` puts the note (and its arrow) at the start or the end of the row.
 */
export function PinNote({ children, align = "start", className }: { children: ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <div aria-hidden className={cn("flex pt-8 lg:hidden", align === "end" ? "justify-end pr-1" : "pl-1", className)}>
      <span className={cn("home-note home-note-pin", align === "end" && "home-note-pin-end")}>
        <svg viewBox="0 0 26 30" aria-hidden>
          <path d="M9 29C6 20 8 11 16 4" />
          <path d="M8 6l8-3 2 9" />
        </svg>
        {children}
      </span>
    </div>
  );
}

export const HOME_BIG_H2 =
  "text-[2rem] font-medium leading-[1.08] tracking-[-0.025em] text-[#3a3b37] [text-wrap:balance] sm:text-[2.5rem] lg:text-[2.875rem]";
export const HOME_LEDE = "max-w-md text-base leading-7 text-[#55574f] sm:text-[1.0625rem]";
export const HOME_LINK =
  "mt-5 inline-block border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary";

function LimitRow({
  name,
  plan,
  percent,
  tone,
  detail,
  labelled,
  pin,
}: {
  name: string;
  plan: string;
  percent: number;
  tone: "warn" | "idle";
  detail: string;
  labelled?: boolean;
  pin?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-4 border-b border-border px-4 py-6 last:border-b-0 sm:px-[26px] lg:grid-cols-[200px_minmax(0,1fr)_150px] lg:gap-8 lg:py-[34px]">
      <div>
        <p className="text-lg font-semibold tracking-[-0.01em]">{name}</p>
        <p className="text-[0.84rem] text-muted-foreground">{plan}</p>
      </div>
      <div className="relative order-3 col-span-2 h-[18px] bg-[#deded6] lg:order-2 lg:col-span-1">
        {labelled ? (
          <span className="absolute -top-8 right-0 hidden whitespace-nowrap text-xs text-muted-foreground lg:block">
            weekly limit
          </span>
        ) : null}
        <span
          className={cn("absolute inset-y-0 left-0", tone === "warn" ? "bg-[#dd7a12]" : "bg-[#8f918a]")}
          style={{ width: `${percent}%` }}
        />
        <span className="absolute -bottom-2 -top-2 right-0 w-0.5 bg-foreground" />
      </div>
      <div className="order-2 text-right lg:order-3">
        <p
          className={cn(
            "text-[2.5rem] font-bold leading-none tracking-[-0.04em] tabular-nums lg:text-[3.25rem]",
            tone === "warn" && "text-[#c2650c]",
          )}
        >
          {percent}%
        </p>
        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{detail}</p>
      </div>
      {pin ? <div className="order-4 col-span-2 -mt-4 lg:hidden">{pin}</div> : null}
    </div>
  );
}

export function HomeWeeksChapter() {
  return (
    <section id="product" aria-labelledby="home-weeks-heading" className="scroll-mt-20 overflow-x-clip bg-white pt-24 sm:pt-32 lg:pt-44">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
          <h2 id="home-weeks-heading" className={HOME_BIG_H2}>
            You’ve probably had one of these weeks.
          </h2>
          <div>
            <p className={HOME_LEDE}>
              Priya is about to run out and Elena has barely used hers, on seats that cost the same.
            </p>
            <Link href="/guides/claude-team-usage-limits" className={HOME_LINK}>
              How Claude Team limits work
            </Link>
          </div>
        </div>

        <figure
          aria-label="Two people on the same Claude plan this week: Priya at 97% of her weekly limit, Elena at 6%"
          className="relative mt-10 lg:mt-[3.75rem] lg:w-[68%]"
        >
          <figcaption className="mb-3.5 flex items-center gap-2.5 text-sm font-medium text-[#55574f]">
            <DecorativeToolIcon name="Claude Code" size={20} />
            Claude Team, this week
          </figcaption>
          <div className="border border-border bg-white">
            <LimitRow
              name="Priya Natarajan"
              plan="Team Standard"
              percent={97}
              tone="warn"
              detail="resets Thu 9:00 AM"
              labelled
              pin={<PinNote align="end">Move her to Premium</PinNote>}
            />
            <LimitRow
              name="Elena Rossi"
              plan="Team Standard"
              percent={6}
              tone="idle"
              detail="all week"
              pin={<PinNote>Does Elena still need hers?</PinNote>}
            />
          </div>
          <Notes>
            <Note
              style={{ right: -16, top: -4, transform: "rotate(-2deg)" }}
              arrow={{
                viewBox: "0 0 30 28",
                box: { left: "52%", top: "100%", width: 30, height: 28 },
                paths: ["M18 2C23 10 21 17 11 23", "M5 12l5 12 12-4"],
              }}
            >
              Move her to Premium
            </Note>
            <Note
              style={{ left: "calc(100% + 54px)", top: 214, transform: "rotate(1.5deg)" }}
              arrow={{
                viewBox: "0 0 72 30",
                box: { left: -74, top: 2, width: 72, height: 30 },
                paths: ["M70 24C50 28 28 24 6 10", "M12 26L5 9l18-2"],
              }}
            >
              Does Elena still need hers?
            </Note>
          </Notes>
        </figure>
      </div>
    </section>
  );
}

/** `claudeShort` and `cursorShort` are what the narrow columns on a phone have room for. */
const TWO_SEATS = [
  { name: "Priya Natarajan", email: "priya@northwind.dev", claude: "Used today", cursor: "No usage", cursorShort: "No usage", on: "" },
  { name: "Tom Becker", email: "tom@northwind.dev", claude: "Used this week", cursor: "2% used", cursorShort: "2% used", on: "on Claude models" },
  { name: "Amara Okafor", email: "amara@northwind.dev", claude: "Used today", cursor: "1% used", cursorShort: "1% used", on: "on Grok models" },
] as const;

const SEAT_CELL = "flex items-center gap-2 px-2.5 py-3 text-[0.875rem] sm:gap-2.5 sm:px-[26px] sm:py-[13px] sm:text-[0.9375rem]";

function SeatUsed({ children, short }: { children: ReactNode; short: string }) {
  return (
    <div className={cn(SEAT_CELL, "text-[#6f7169]")}>
      <span aria-hidden className="mx-[3px] size-2 shrink-0 rounded-full bg-primary" />
      <span className="max-sm:hidden">{children}</span>
      <span className="sm:hidden">{short}</span>
    </div>
  );
}

function SeatUnused({ children }: { children: ReactNode }) {
  return (
    <div className={cn(SEAT_CELL, "bg-[#fbebdd] font-semibold lg:whitespace-nowrap")}>
      <span aria-hidden className="size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_2.5px_#dd7a12]" />
      {children}
    </div>
  );
}

/** Person, Claude, Cursor. On a phone the two tool columns are just wide enough for a dot and two words. */
const SEAT_GRID =
  "grid grid-cols-[minmax(0,1fr)_5.5rem_6.75rem] items-stretch sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)]";

export function HomePaidTwiceBand() {
  return (
    <section aria-labelledby="home-paid-twice-heading" className="mt-24 overflow-x-clip bg-brand-yellow sm:mt-32 lg:mt-44">
      <div className="mx-auto w-full max-w-6xl px-4 pb-[4.5rem] pt-16 sm:px-6 lg:px-0 lg:pb-32 lg:pt-[7.5rem]">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
          <h2
            id="home-paid-twice-heading"
            className="text-[4rem] font-bold leading-[0.95] tracking-[-0.05em] sm:text-[5rem] lg:text-[6.5rem]"
          >
            Paid twice.
          </h2>
          <div>
            <p className="max-w-md text-[1.0625rem] leading-7 text-foreground sm:text-[1.1875rem] sm:leading-8">
              Nine people hold a Claude seat and a Cursor seat. They barely touch Cursor, and when they do it runs models they already have.
            </p>
            <Link href="/guides/see-team-ai-coding-usage" className={cn(HOME_LINK, "hover:text-foreground")}>
              See team usage
            </Link>
          </div>
        </div>

        <figure
          aria-label="Nine people on an example team hold a Claude seat and a Cursor seat and use under 3% of the Cursor seat. Those Cursor seats cost $360 a month."
          className="relative mt-10 border-2 !border-foreground bg-white lg:mt-[4.75rem] lg:grid lg:grid-cols-[minmax(0,1fr)_300px]"
        >
          <div>
            <div aria-hidden className={cn(SEAT_GRID, "border-b border-border text-[0.78rem] text-muted-foreground")}>
              <p className="px-4 pb-3 pt-3.5 sm:px-[26px] sm:pb-3.5 sm:pt-4">Person</p>
              <div className="px-2.5 pb-3 pt-3.5 sm:px-[26px] sm:pb-3.5 sm:pt-4">
                <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-foreground sm:gap-2 sm:text-[0.9rem]">
                  <DecorativeToolIcon name="Claude Code" size={18} />
                  <span>
                    Claude<span className="max-sm:hidden"> Team</span>
                  </span>
                </p>
                <p className="mt-0.5 pl-7 max-sm:hidden">renews 3 Dec</p>
              </div>
              <div className="px-2.5 pb-3 pt-3.5 sm:px-[26px] sm:pb-3.5 sm:pt-4">
                <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-foreground sm:gap-2 sm:text-[0.9rem]">
                  <DecorativeToolIcon name="Cursor" size={18} />
                  <span>
                    Cursor<span className="max-sm:hidden"> Teams</span>
                  </span>
                </p>
                <p className="mt-0.5 pl-7 max-sm:hidden">renews 14 Dec</p>
              </div>
            </div>
            <ul>
              {TWO_SEATS.map((person) => (
                <li key={person.email} className={cn(SEAT_GRID, "border-b border-border")}>
                  <div className="flex flex-col justify-center px-4 py-3 sm:px-[26px] sm:py-[13px]">
                    <p className="text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] sm:text-[1.0625rem]">{person.name}</p>
                    <p className="font-mono text-xs text-muted-foreground max-sm:hidden">{person.email}</p>
                  </div>
                  <SeatUsed short="In use">{person.claude}</SeatUsed>
                  <SeatUnused>
                    <span className="whitespace-nowrap">{person.cursor}</span>
                    {person.on ? <span className="font-normal text-[#6f5a47] max-lg:hidden">{person.on}</span> : null}
                  </SeatUnused>
                </li>
              ))}
              <li className={SEAT_GRID}>
                <p className="flex items-center px-4 py-3 text-[0.875rem] text-[#6f7169] sm:px-[26px] sm:py-[13px] sm:text-[0.9375rem]">
                  <span>
                    and 6 more<span className="max-sm:hidden"> people</span>
                  </span>
                </p>
                <SeatUsed short="In use">All six use Claude</SeatUsed>
                <SeatUnused>
                  <span className="whitespace-nowrap">
                    Under 3%<span className="max-sm:hidden"> each</span>
                  </span>
                  <span className="font-normal text-[#6f5a47] max-lg:hidden">on several vendors</span>
                </SeatUnused>
              </li>
            </ul>
          </div>
          <div className="flex items-center gap-4 border-t border-border px-4 py-5 sm:px-[30px] lg:flex-col lg:items-start lg:justify-center lg:gap-0 lg:border-t-0 lg:py-[22px]">
            <p className="text-[3.25rem] font-bold leading-[0.9] tracking-[-0.05em] text-[#c8321e] lg:text-[5.25rem]">$360</p>
            <p className="text-[0.9375rem] leading-snug text-[#3a3b37] lg:mt-3">
              a month for nine Cursor seats used under 3%
            </p>
          </div>
          <PinNote className="-mt-2 px-4 pb-5 sm:px-[30px]">Cancel nine Cursor seats by 14 Dec</PinNote>
          <Notes>
            <Note
              style={{ left: "64.5%", top: -31, transform: "rotate(-1.5deg)" }}
              arrow={{
                viewBox: "0 0 60 56",
                box: { left: -62, top: "60%", width: 60, height: 56 },
                paths: ["M56 4C52 24 36 40 6 46", "M20 32L5 46l17 6"],
              }}
            >
              Cancel nine Cursor seats by 14 Dec
            </Note>
          </Notes>
        </figure>
      </div>
    </section>
  );
}
