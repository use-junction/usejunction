"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, SquareTerminal } from "lucide-react";
import { DecorativeToolIcon } from "@/components/public/tool-logos-strip";
import { HOME_TERMINAL_COMMAND } from "@/lib/public/home-cta";
import { cn } from "@/lib/utils";

/** How long each readout stays up. */
const READOUT_MS = 3600;

/** One developer's last 30 days of spend, in cents a day, weekends quiet. They add up to the total shown. */
const DAYS = [
  1420, 980, 0, 210, 1845, 2230, 1275, 2760, 1120, 0, 0, 1690, 3140, 1985, 860, 1335, 425, 0, 2170, 1715, 2490, 1550,
  1040, 0, 320, 1960, 1231, 4659, 2134, 716,
];
const TOTAL_CENTS = DAYS.reduce((sum, cents) => sum + cents, 0);
const NEXT_MONTH_CENTS = 43000;

const PLANS_DOLLARS = 120;

/** The line for "Total spent": spend adding up over the 30 days. Drawn in a 100 x 40 box that stretches to the space it gets. */
const LINE_BOX = { width: 100, height: 40 };
const lineY = (cents: number) => LINE_BOX.height - 2 - (cents / TOTAL_CENTS) * (LINE_BOX.height - 6);
const TOTAL_LINE = (() => {
  let spent = 0;
  return DAYS.map((cents, index) => {
    spent += cents;
    const x = (index / (DAYS.length - 1)) * LINE_BOX.width;
    return `${index ? "L" : "M"}${x.toFixed(1)} ${lineY(spent).toFixed(1)}`;
  }).join(" ");
})();

/**
 * The bars for "Estimated next month": the 30 days in two-day bars, then next month's in the same
 * rhythm, scaled to the estimate and started a few days along so it is not a copy of the first half.
 */
const PAST_BARS = Array.from({ length: DAYS.length / 2 }, (_, index) => DAYS[index * 2] + DAYS[index * 2 + 1]);
const AHEAD_BARS = PAST_BARS.map((_, index) =>
  Math.round(PAST_BARS[(index + 4) % PAST_BARS.length] * (NEXT_MONTH_CENTS / TOTAL_CENTS)),
);
const TOP_BAR = Math.max(...PAST_BARS, ...AHEAD_BARS);

/** A dollar amount that counts up to its value when `animate` is set. Without it the value is there from the start. */
function Amount({ cents, animate, whole }: { cents: number; animate: boolean; whole?: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : cents);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / 1000);
      setShown(Math.round(cents * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, cents]);

  return <>{whole ? `$${Math.round(shown / 100)}` : `$${(shown / 100).toFixed(2)}`}</>;
}

const NUMBER = "text-[1.25rem] font-bold leading-6 tracking-[-0.03em] tabular-nums";
/** Staggers an entrance: see `.home-term-rise` in globals.css. */
const after = (index: number) => ({ "--i": index }) as CSSProperties;

const READOUTS: { label: string; graph: string; describes: string; value: (animate: boolean) => ReactNode }[] = [
  {
    label: "Total spent",
    graph: "total",
    describes: "A line of spend adding up over the last 30 days",
    value: (animate) => (
      <span className={NUMBER}>
        <Amount cents={TOTAL_CENTS} animate={animate} />
      </span>
    ),
  },
  {
    label: "Estimated next month",
    graph: "forecast",
    describes: "Bars of spend over the last 30 days, then paler bars for next month",
    value: (animate) => (
      <span className={NUMBER}>
        <Amount cents={NEXT_MONTH_CENTS} animate={animate} whole />
      </span>
    ),
  },
  {
    label: "We recommend",
    graph: "plans",
    describes: "Two bars: $430 at API prices, and $120 on the recommended plans",
    value: () => (
      <span className="flex h-6 items-center gap-1.5 font-medium">
        <span className="home-term-rise flex items-center gap-1.5" style={after(1)}>
          <DecorativeToolIcon name="Claude Code" size={18} />
          <span>
            <span className="sr-only">Claude </span>Max $100
          </span>
        </span>
        <span className="home-term-rise text-muted-foreground" style={after(3)}>
          +
        </span>
        <span className="home-term-rise flex items-center gap-1.5" style={after(3)}>
          <DecorativeToolIcon name="Codex" size={18} />
          <span>
            <span className="sr-only">ChatGPT </span>Plus $20
          </span>
        </span>
      </span>
    ),
  },
];

/** Total spent: one line rising to the total, uncovered from the left, with a dot where it ends. */
function TotalGraph() {
  return (
    <div className="absolute inset-y-0 left-0 right-1.5">
      <svg
        viewBox={`0 0 ${LINE_BOX.width} ${LINE_BOX.height}`}
        preserveAspectRatio="none"
        className="home-term-draw block size-full"
        aria-hidden
      >
        <path d={`${TOTAL_LINE} L${LINE_BOX.width} ${LINE_BOX.height} L0 ${LINE_BOX.height} Z`} className="fill-primary/15" />
        <path
          d={TOTAL_LINE}
          className="fill-none stroke-primary"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="home-term-dot absolute left-full size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{ top: `${(lineY(TOTAL_CENTS) / LINE_BOX.height) * 100}%` }}
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
      </span>
    </div>
  );
}

/** Estimated next month: this month's bars, then next month's in a paler shade. */
function ForecastGraph() {
  return (
    <div className="absolute inset-0 flex items-end gap-[2px]">
      {[...PAST_BARS, ...AHEAD_BARS].map((cents, index) => (
        <span
          key={index}
          data-bar={index < PAST_BARS.length ? "past" : "ahead"}
          className={cn("home-term-bar flex-1", index < PAST_BARS.length ? "bg-primary" : "bg-primary/30")}
          style={{ ...after(index), height: `${Math.max(6, (cents / TOP_BAR) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** We recommend: the same work at API prices, and on the two plans. */
function PlansGraph() {
  const row = "home-term-grow flex h-[17px] items-center whitespace-nowrap px-1.5 text-[0.6875rem] font-semibold leading-none";
  return (
    <div className="absolute inset-0 flex flex-col justify-between">
      <span className={cn(row, "bg-[#deded6]")}>${NEXT_MONTH_CENTS / 100} at API prices</span>
      <span
        className={cn(row, "bg-brand-yellow")}
        style={{ ...after(3), width: `${(PLANS_DOLLARS / (NEXT_MONTH_CENTS / 100)) * 100}%` }}
      >
        ${PLANS_DOLLARS} on plans
      </span>
    </div>
  );
}

/**
 * A one-line strip, the weight of the "Works with" strip: the free terminal
 * command, and beside it one short readout of what the command tells you, with
 * its own small graph. The command stays still. Once the strip is on screen the
 * readouts take turns, each graph drawing itself, and hold while somebody
 * points at the strip.
 */
export function HomeTerminal() {
  const section = useRef<HTMLElement>(null);
  const [turn, setTurn] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [held, setHeld] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const node = section.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setOnScreen(true);
      setMoving(!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen || held) return;
    const timer = window.setInterval(() => setTurn((current) => current + 1), READOUT_MS);
    return () => window.clearInterval(timer);
  }, [onScreen, held]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(HOME_TERMINAL_COMMAND);
      setCopied(true);
    } catch {
      // No clipboard access: the command is on screen to select by hand.
    }
  }

  const readout = turn % READOUTS.length;

  return (
    <section
      ref={section}
      aria-labelledby="home-terminal-heading"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="mt-16 border-y border-border bg-white sm:mt-20 lg:mt-28"
    >
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-9 gap-y-4 px-4 py-5 text-[0.9375rem] sm:px-6">
        <div>
          <h2 id="home-terminal-heading" className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
            <SquareTerminal className="size-[22px] shrink-0 text-primary" aria-hidden />
            See your own number in the terminal
          </h2>
          <p className="mt-0.5 pl-8 text-[0.8125rem] text-muted-foreground">No account. Nothing leaves your machine.</p>
        </div>

        {/* The command is its own copy button: click it and it is on the clipboard. */}
        <button
          type="button"
          onClick={copy}
          title="Click to copy"
          aria-label={`Copy ${HOME_TERMINAL_COMMAND}`}
          className="grid w-full border border-border bg-muted px-4 py-2 text-left font-mono text-[0.875rem] transition-colors hover:border-foreground sm:w-auto"
        >
          <code className={cn("col-start-1 row-start-1 flex items-center gap-2.5 whitespace-nowrap", copied && "invisible")}>
            <span aria-hidden className="select-none text-muted-foreground">
              $
            </span>
            {HOME_TERMINAL_COMMAND}
          </code>
          <span
            aria-live="polite"
            className={cn("col-start-1 row-start-1 flex items-center gap-2 font-sans font-semibold", !copied && "invisible")}
          >
            {copied ? (
              <>
                <Check className="size-4 text-primary" aria-hidden />
                Copied
              </>
            ) : null}
          </span>
        </button>

        {/* The graph takes whatever room the row has left, so the strip runs the full width of the page column. */}
        <div className="flex w-full min-w-0 items-center gap-x-6 lg:w-auto lg:flex-1 lg:gap-x-9">
          <div
            role="img"
            aria-label={READOUTS[readout].describes}
            data-graph={READOUTS[readout].graph}
            className="relative h-10 min-w-0 flex-1"
          >
            {/* Keyed so each graph draws itself again when its turn comes. */}
            <div key={`${onScreen}-${turn}`} className="absolute inset-0">
              {readout === 0 ? <TotalGraph /> : null}
              {readout === 1 ? <ForecastGraph /> : null}
              {readout === 2 ? <PlansGraph /> : null}
            </div>
          </div>

          {/* The readouts share one cell, so the strip keeps its size while they take turns. */}
          <div className="grid">
            {READOUTS.map((item, index) => {
              const up = index === readout;
              return (
                <div
                  key={item.label}
                  data-readout={up ? "shown" : "waiting"}
                  aria-hidden={!up}
                  className={cn("col-start-1 row-start-1 whitespace-nowrap", !up && "invisible")}
                >
                  <p className={cn("text-[0.8125rem] text-muted-foreground", up && "home-term-rise")}>{item.label}</p>
                  {/* Keyed so the number counts up, and the plans come in, each time this readout's turn comes. */}
                  <div key={up ? `${onScreen}-${turn}` : "waiting"} className={cn("mt-0.5", up && "home-term-rise")} style={after(1)}>
                    {item.value(up && moving)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
