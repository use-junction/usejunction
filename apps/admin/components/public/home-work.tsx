import Link from "next/link";
import type { CSSProperties } from "react";
import { CircleDot, GitMerge, type LucideIcon } from "lucide-react";
import { HOME_BIG_H2, HOME_LEDE, HOME_LINK, Note, Notes, PinNote } from "@/components/public/home-story";
import { cn } from "@/lib/utils";

/** The Work page's three states for the example team, last eight weeks. They add up to $61,480. */
const LANDED: { icon: LucideIcon; iconClass: string; count: string; amount: number; state: string; bar: string; text: string; pin?: string }[] = [
  { icon: GitMerge, iconClass: "text-[#8250df]", count: "23 pull requests", amount: 35120, state: "Merged", bar: "bg-primary", text: "text-primary", pin: "57% landed on work that merged" },
  { icon: CircleDot, iconClass: "text-[#1a7f37]", count: "11 pull requests", amount: 17140, state: "Open", bar: "bg-[#9aae2f]", text: "text-[#5f7012]" },
  { icon: CircleDot, iconClass: "text-[#1a7f37]", count: "4 pull requests", amount: 9220, state: "Not moving", bar: "bg-[#c1652b]", text: "text-[#a8521c]", pin: "$9,220 in, and it stopped" },
];
const LARGEST = Math.max(...LANDED.map((part) => part.amount));
const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

/** Where the spend landed, as one bar. Redrawn from the Work page's Merged, Open and Not moving totals. */
export function HomeWork() {
  return (
    <section aria-labelledby="home-work-heading" className="overflow-x-clip bg-white pt-24 sm:pt-32 lg:pt-[9.5rem]">
      <div className="mx-auto w-full max-w-[75rem] px-4 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
          <h2 id="home-work-heading" className={HOME_BIG_H2}>
            Where the AI spend landed.
          </h2>
          <div>
            <p className={HOME_LEDE}>
              Every pull request and issue shows the AI spend behind it and whether it merged. The last six features
              to merge cost $1,480 to $6,930 each.
            </p>
            <Link href="/solutions/ai-coding-spend-management" className={HOME_LINK}>
              How spend is matched to work
            </Link>
          </div>
        </div>

        <figure
          aria-label="$61,480 of AI spend matched to work in the last eight weeks: $35,120 on merged pull requests, $17,140 on open ones and $9,220 on work that is not moving"
          className="relative mt-10 lg:mt-[4.25rem]"
        >
          <figcaption className="text-[0.9375rem] text-muted-foreground">
            <b className="text-[1.0625rem] font-semibold text-foreground">$61,480</b> of AI spend matched to work in the last
            eight weeks. Part of it is estimated.
          </figcaption>
          <div className="mt-7 flex flex-col gap-6 lg:mt-[34px] lg:flex-row lg:gap-1">
            {LANDED.map((part) => (
              <div
                key={part.state}
                className="min-w-0 lg:[flex:var(--share)]"
                style={{ "--share": part.amount, "--bar": `${Math.round((part.amount / LARGEST) * 100)}%` } as CSSProperties}
              >
                <p className="mb-2.5 flex items-center gap-2 whitespace-nowrap text-sm font-medium text-[#55574f] lg:mb-3">
                  <part.icon className={cn("size-4 shrink-0", part.iconClass)} strokeWidth={2} aria-hidden />
                  {part.count}
                </p>
                <span aria-hidden className={cn("block h-7 w-[var(--bar)] lg:h-[60px] lg:w-full", part.bar)} />
                <p className="mt-2.5 flex items-baseline gap-2.5 lg:mt-3.5 lg:block">
                  <span className="text-[2rem] font-bold leading-none tracking-[-0.035em] tabular-nums lg:block lg:text-[2.75rem]">
                    {usd(part.amount)}
                  </span>
                  <span className={cn("text-[0.9375rem] font-semibold lg:mt-1.5 lg:block", part.text)}>{part.state}</span>
                </p>
                {part.pin ? <PinNote className="pt-7">{part.pin}</PinNote> : null}
              </div>
            ))}
          </div>
          <Notes>
            <Note
              style={{ left: 236, top: "calc(100% - 66px)", transform: "rotate(1.5deg)" }}
              arrow={{
                viewBox: "0 0 50 26",
                box: { left: -54, top: 7, width: 50, height: 26 },
                paths: ["M48 14C36 19 20 19 6 12", "M15 4L5 12l9 9"],
              }}
            >
              57% landed on work that merged
            </Note>
            <Note
              style={{ right: -10, top: -36, transform: "rotate(-2deg)" }}
              arrow={{
                viewBox: "0 0 34 46",
                box: { left: "34%", top: "100%", width: 34, height: 46 },
                paths: ["M20 2C28 16 26 30 12 40", "M5 26l6 15 14-6"],
              }}
            >
              $9,220 in, and it stopped
            </Note>
          </Notes>
        </figure>
      </div>
    </section>
  );
}
