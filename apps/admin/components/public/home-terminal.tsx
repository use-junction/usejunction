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

/**
 * The graph: spend so far as a rising line, then a dashed stretch for next month at the same pace.
 * Sizes are in CSS pixels; the line keeps 2px clear of the top and bottom.
 */
const GRAPH = { past: 96, ahead: 36, height: 32 };
const GRAPH_TOP = TOTAL_CENTS * ((GRAPH.past + GRAPH.ahead) / GRAPH.past);
const graphY = (cents: number) => GRAPH.height - 2 - (cents / GRAPH_TOP) * (GRAPH.height - 4);
const PAST_LINE = (() => {
  let spent = 0;
  return DAYS.map((cents, index) => {
    spent += cents;
    const x = (index / (DAYS.length - 1)) * GRAPH.past;
    return `${index ? "L" : "M"}${x.toFixed(1)} ${graphY(spent).toFixed(1)}`;
  }).join(" ");
})();
const PAST_END_Y = graphY(TOTAL_CENTS);
const AHEAD_END_Y = graphY(GRAPH_TOP);

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

const READOUTS: { label: string; value: (animate: boolean) => ReactNode }[] = [
  {
    label: "Total spent",
    value: (animate) => (
      <span className={NUMBER}>
        <Amount cents={TOTAL_CENTS} animate={animate} />
      </span>
    ),
  },
  {
    label: "Estimated next month",
    value: (animate) => (
      <span className={NUMBER}>
        <Amount cents={NEXT_MONTH_CENTS} animate={animate} whole />
      </span>
    ),
  },
  {
    label: "We recommend",
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

/**
 * A one-line strip, the weight of the "Works with" strip: the free terminal
 * command, and beside it a small graph with one short readout of what the
 * command tells you. The command stays still. Once the strip is on screen the
 * graph draws itself and the readout takes turns, holding while somebody
 * points at it.
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
  const round = Math.floor(turn / READOUTS.length);
  // The dashed stretch belongs to next month, so it comes in with that readout and stays for the plans.
  const ahead = readout > 0;

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

        <div className="flex items-center gap-x-4 sm:pl-8 xl:pl-0">
          <div
            role="img"
            aria-label="A graph of spend rising over the last 30 days"
            data-ahead={ahead}
            className="relative shrink-0"
            style={{ width: GRAPH.past + GRAPH.ahead + 4, height: GRAPH.height }}
          >
            {/* Each stretch is uncovered from the left, which draws its line. */}
            <span key={`past-${onScreen}-${round}`} className="home-term-draw absolute left-0 top-0 block overflow-hidden" style={{ width: GRAPH.past }}>
              <svg width={GRAPH.past} height={GRAPH.height} viewBox={`0 0 ${GRAPH.past} ${GRAPH.height}`} className="block" aria-hidden>
                <path d={`${PAST_LINE} L${GRAPH.past} ${GRAPH.height} L0 ${GRAPH.height} Z`} className="fill-primary/15" />
                <path d={PAST_LINE} className="fill-none stroke-primary" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </span>
            {ahead ? (
              <span className="home-term-draw absolute top-0 block overflow-hidden" style={{ left: GRAPH.past, width: GRAPH.ahead }}>
                <svg width={GRAPH.ahead} height={GRAPH.height} viewBox={`0 0 ${GRAPH.ahead} ${GRAPH.height}`} className="block" aria-hidden>
                  <path
                    d={`M0 ${PAST_END_Y.toFixed(1)} L${GRAPH.ahead} ${AHEAD_END_Y.toFixed(1)}`}
                    className="fill-none stroke-primary"
                    strokeWidth="2"
                    strokeDasharray="3 3"
                  />
                </svg>
              </span>
            ) : null}
            {/* The dot sits on the end of the line and follows it out along the dashed stretch. */}
            <span
              key={`dot-${onScreen}-${round}`}
              className="home-term-dot absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-[left,top] duration-700 ease-linear"
              style={{ left: ahead ? GRAPH.past + GRAPH.ahead : GRAPH.past, top: ahead ? AHEAD_END_Y : PAST_END_Y }}
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
            </span>
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
