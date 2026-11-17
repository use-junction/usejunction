"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Clipboard, SquareTerminal } from "lucide-react";
import { DecorativeToolIcon } from "@/components/public/tool-logos-strip";
import { HOME_TERMINAL_COMMAND } from "@/lib/public/home-cta";
import { cn } from "@/lib/utils";

/** How long each readout stays up. */
const READOUT_MS = 3200;

const VALUE = "text-[1.25rem] font-bold leading-none tracking-[-0.03em] tabular-nums";

/** One example developer: what the command would tell them. Made-up numbers; the strip says so. */
const READOUTS: { label: string; value: ReactNode }[] = [
  { label: "Total spent", value: <span className={VALUE}>$412.60</span> },
  { label: "Estimated next month", value: <span className={VALUE}>$430</span> },
  {
    label: "We recommend",
    value: (
      <span className="flex items-center gap-1.5 font-medium">
        <DecorativeToolIcon name="Claude Code" size={18} />
        <span>
          <span className="sr-only">Claude </span>Max $100
        </span>
        <span className="text-muted-foreground">+</span>
        <DecorativeToolIcon name="Codex" size={18} />
        <span>
          <span className="sr-only">ChatGPT </span>Plus $20
        </span>
      </span>
    ),
  },
];

/**
 * A one-line strip, the weight of the "Works with" strip: the free terminal
 * command, and beside it one short readout of what the command tells you.
 * The command stays still; the readout changes every few seconds once the
 * strip is on screen, and holds while somebody points at it.
 */
export function HomeTerminal() {
  const section = useRef<HTMLElement>(null);
  const [readout, setReadout] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  const [held, setHeld] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const node = section.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setOnScreen(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen || held) return;
    const timer = window.setInterval(() => setReadout((current) => (current + 1) % READOUTS.length), READOUT_MS);
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
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-8 gap-y-4 px-4 py-5 text-[0.9375rem] sm:px-6">
        <div>
          <h2 id="home-terminal-heading" className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
            <SquareTerminal className="size-[22px] shrink-0 text-primary" aria-hidden />
            See your own number in the terminal
          </h2>
          <p className="mt-0.5 pl-8 text-[0.8125rem] text-muted-foreground">No account. Nothing leaves your machine.</p>
        </div>

        <div className="flex w-full items-stretch bg-foreground font-mono text-[0.875rem] text-[#e6e8df] sm:w-auto">
          <code className="flex min-w-0 flex-1 items-center gap-2.5 whitespace-nowrap py-2.5 pl-4 pr-5">
            <span aria-hidden className="select-none text-[#9aa18c]">
              $
            </span>
            {HOME_TERMINAL_COMMAND}
          </code>
          <button
            type="button"
            onClick={copy}
            className="flex shrink-0 items-center gap-2 border-l border-white/20 px-3.5 font-sans text-[0.875rem] font-semibold text-white transition-colors hover:bg-white/10"
          >
            {copied ? <Check className="size-4 text-brand-yellow" aria-hidden /> : <Clipboard className="size-4" aria-hidden />}
            <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        {/* Beside the command where there is room for one line; under it, lined up with the heading, where there is not. */}
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 sm:pl-8 xl:w-auto xl:flex-1 xl:pl-0">
          <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground xl:block" aria-hidden />
          {/* The readouts share one cell, so the strip keeps its size while they take turns. */}
          <div className="grid">
            {READOUTS.map((item, index) => (
              <p
                key={item.label}
                data-readout={index === readout ? "shown" : "waiting"}
                aria-hidden={index !== readout}
                className={cn(
                  "col-start-1 row-start-1 flex items-center gap-2.5 whitespace-nowrap",
                  index === readout ? "home-term-rise" : "invisible",
                )}
              >
                <span className="text-muted-foreground">{item.label}</span>
                {item.value}
              </p>
            ))}
          </div>
          <p className="w-full text-[0.8125rem] text-muted-foreground sm:ml-auto sm:w-auto">Example</p>
        </div>
      </div>
    </section>
  );
}
