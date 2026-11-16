"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clipboard } from "lucide-react";
import { HOME_TERMINAL_COMMAND, HOME_TERMINAL_COMPARE_HREF } from "@/lib/public/home-cta";

/**
 * What the command prints, for an example developer. The layout is the
 * agent's own table (agent/cmd/usage_report.go); the numbers are made up and
 * the block is labelled as an example.
 */
const EXAMPLE_ROWS = [
  ["2026-11-12", "Claude Code", "opus, sonnet", "$46.59"],
  ["2026-11-13", "Claude Code", "opus", "$11.59"],
  ["", "Codex", "gpt-5", "$9.75"],
  ["2026-11-14", "Claude Code", "sonnet", "$3.20"],
] as const;
const EXAMPLE_TOTAL = "$71.13";

export function HomeTerminal() {
  const [copied, setCopied] = useState(false);

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
    <section aria-labelledby="home-terminal-heading" className="bg-white pt-16 sm:pt-20 lg:pt-24">
      <div className="mx-auto grid w-full max-w-[75rem] items-center gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <h2
            id="home-terminal-heading"
            className="max-w-md text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-[#3a3b37] sm:text-[1.95rem]"
          >
            Or see your own number first, in the terminal.
          </h2>
          <p className="mt-4 max-w-md text-[1.0625rem] leading-relaxed text-[#3a3b37]">
            One command reads the logs already on your laptop. No account. Nothing leaves your machine.
          </p>

          <div className="mt-6 flex max-w-md items-stretch border-2 !border-foreground">
            <code className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto bg-white px-4 py-3 font-mono text-[0.9375rem]">
              <span aria-hidden className="select-none text-muted-foreground">
                $
              </span>
              <span className="whitespace-nowrap">{HOME_TERMINAL_COMMAND}</span>
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex shrink-0 items-center gap-2 border-l-2 !border-foreground bg-brand-yellow px-4 text-[0.9375rem] font-semibold transition-colors hover:bg-brand-yellow-hover"
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Clipboard className="size-4" aria-hidden />}
              <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <Link
            href={HOME_TERMINAL_COMPARE_HREF}
            className="mt-5 inline-flex items-center gap-1.5 border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
          >
            How it compares with ccusage
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <figure className="min-w-0">
          <div className="overflow-x-auto bg-foreground px-4 py-5 font-mono text-[0.8125rem] leading-relaxed text-[#e6e8df] sm:px-6 sm:text-[0.875rem]">
            <p className="whitespace-nowrap text-[#9aa18c]">
              <span aria-hidden className="select-none">$ </span>
              {HOME_TERMINAL_COMMAND}
            </p>
            <p className="mt-3 font-semibold text-white">AI coding usage · last 30 days · this machine</p>
            <table className="mt-3 w-full border-separate border-spacing-x-0 border-spacing-y-0.5 whitespace-nowrap">
              <thead>
                <tr className="text-left text-[#9aa18c]">
                  <th scope="col" className="pr-5 font-normal">Date</th>
                  <th scope="col" className="pr-5 font-normal">Tool</th>
                  {/* On a phone the models column goes, so the cost stays on screen. */}
                  <th scope="col" className="hidden pr-5 font-normal sm:table-cell">Models</th>
                  <th scope="col" className="text-right font-normal">Cost</th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLE_ROWS.map(([date, tool, models, cost], index) => (
                  <tr key={index}>
                    <td className="pr-5">{date}</td>
                    <td className="pr-5">{tool}</td>
                    <td className="hidden pr-5 sm:table-cell">{models}</td>
                    <td className="text-right">{cost}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-white">
                  <td className="pr-5 pt-1">Total</td>
                  <td className="pr-5" />
                  <td className="hidden pr-5 sm:table-cell" />
                  <td className="pt-1 text-right">{EXAMPLE_TOTAL}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4 text-[#9aa18c]">Estimated at API list prices from local logs, not your bill.</p>
            <p className="text-[#9aa18c]">Nothing left this machine.</p>
          </div>
          <figcaption className="mt-2.5 text-[0.8125rem] text-muted-foreground">Example output. Your own tools and numbers appear in their place.</figcaption>
        </figure>
      </div>
    </section>
  );
}
