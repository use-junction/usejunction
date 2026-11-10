import Image from "next/image";
import Link from "next/link";
import { Note, ShotScroll } from "@/components/public/home-story";

/** Real Adoption page for the example team "Northwind Labs". */
export function HomeAdoption() {
  return (
    <section aria-labelledby="home-adoption-heading" className="bg-white pt-24 sm:pt-32 lg:pt-[9.5rem]">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[23.75rem_minmax(0,1fr)] lg:items-center lg:gap-24 lg:px-0">
        <div>
          <h2
            id="home-adoption-heading"
            className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] [text-wrap:balance] sm:text-[1.95rem]"
          >
            Who has started, and who needs a nudge.
          </h2>
          <p className="mt-4 text-base leading-7 text-[#3a3b37] sm:text-[1.0625rem]">
            Each person gets a band from the days they used a tool: Regular, Occasional or Not using yet. Elena was
            regular last period and has two active days in this one.
          </p>
          <Link
            href="/guides/see-team-ai-coding-usage"
            className="mt-5 inline-block border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
          >
            See team usage
          </Link>
        </div>
        <figure className="relative border border-border bg-white">
          <Image
            src="/home/adoption-grid.png"
            alt="UseJunction's Adoption page for an example team: who uses AI day by day, with each person marked Regular, Occasional or Not using yet"
            width={1300}
            height={1160}
            sizes="(max-width: 1024px) 92vw, 724px"
            className="h-auto w-full"
          />
          <Note
            className="hidden lg:block"
            style={{ left: "68%", top: "9.5%", transform: "rotate(1.5deg)" }}
            arrow={{
              viewBox: "0 0 60 36",
              box: { left: -56, top: 6, width: 60, height: 36 },
              paths: ["M58 8C40 2 22 8 8 24", "M6 6l1 19 18-5"],
            }}
          >
            Two people haven’t started yet
          </Note>
        </figure>
      </div>
    </section>
  );
}

/** Real Work page: AI spend split across GitHub commits, rolled up by pull request, issue and repository. */
export function HomeWork() {
  return (
    <section
      aria-labelledby="home-work-heading"
      className="mt-24 border-y border-border bg-[#fafaf7] sm:mt-32 lg:mt-[9.5rem]"
    >
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-16 sm:px-6 lg:px-0 lg:pb-[8.5rem] lg:pt-[7.5rem]">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
          <h2
            id="home-work-heading"
            className="text-[2.4rem] font-semibold leading-[1.02] tracking-[-0.04em] [text-wrap:balance] sm:text-5xl lg:text-[4rem]"
          >
            Where the AI spend landed.
          </h2>
          <div>
            <p className="max-w-md text-base leading-7 text-[#3a3b37] sm:text-[1.0625rem]">
              Connect GitHub and each person’s AI spend for a day is split across the commits they made that day, then
              added up by pull request, issue and repository. Part of it is estimated.
            </p>
            <Link
              href="/solutions/ai-coding-spend-management"
              className="mt-5 inline-block border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
            >
              How spend is matched to work
            </Link>
          </div>
        </div>

        <ShotScroll className="mt-10 pb-14 pt-10 lg:mt-[4.75rem] lg:pb-0 lg:pt-0">
          <figure className="relative">
            <Image
              src="/home/work-row.png"
              alt="UseJunction's Work page for an example team: AI spend by week and repository, with $1,213.59 on work, $693.48 merged, $346.74 open and $173.37 not moving"
              width={2240}
              height={690}
              sizes="(max-width: 1024px) 860px, 1152px"
              className="h-auto w-full"
            />
            <Note
              style={{ left: "57%", top: -30, transform: "rotate(-1.5deg)" }}
              arrow={{
                viewBox: "0 0 70 64",
                box: { left: "100%", top: 0, width: 70, height: 64, marginLeft: -6 },
                paths: ["M6 4C10 30 30 46 60 50", "M42 36l19 14-21 9"],
              }}
            >
              $693 landed on work that merged
            </Note>
            <Note
              style={{ left: "61%", top: "101%", transform: "rotate(1deg)" }}
              arrow={{
                viewBox: "0 0 64 60",
                box: { left: "100%", top: -48, width: 64, height: 60, marginLeft: -4 },
                paths: ["M4 56C30 54 48 38 54 10", "M38 24L55 8l8 21"],
              }}
            >
              $173 on work that isn’t moving
            </Note>
          </figure>
        </ShotScroll>
      </div>
    </section>
  );
}
