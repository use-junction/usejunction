import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Mark = "yes" | "partly" | "no";
type Cell = { mark: Mark; text?: string };

/** Same facts as the table in /blog/check-claude-team-usage; keep the two in step. */
const ROWS: { feature: string; team: Cell; enterprise: Cell; ours: Cell }[] = [
  {
    feature: "Spend per person",
    team: { mark: "partly", text: "CSV, if extra usage is on" },
    enterprise: { mark: "yes", text: "CSV and API" },
    ours: { mark: "yes", text: "Estimated, per tool" },
  },
  {
    feature: "Weekly and 5-hour limit use",
    team: { mark: "no" },
    enterprise: { mark: "no" },
    ours: { mark: "yes", text: "Over time" },
  },
  { feature: "Raw data or API", team: { mark: "no" }, enterprise: { mark: "yes" }, ours: { mark: "yes" } },
  { feature: "Personal accounts", team: { mark: "no" }, enterprise: { mark: "no" }, ours: { mark: "yes" } },
];

const MARK_LABEL: Record<Mark, string> = { yes: "Yes", partly: "Partly", no: "No" };

function Dot({ mark }: { mark: Mark }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[18px] shrink-0 rounded-full",
        mark === "yes" && "bg-primary",
        mark === "partly" && "bg-[linear-gradient(90deg,#e59a18_50%,transparent_50%)] shadow-[inset_0_0_0_2px_#e59a18]",
        mark === "no" && "shadow-[inset_0_0_0_2px_#c9cbc3]",
      )}
    />
  );
}

function MarkCell({ cell }: { cell: Cell }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Dot mark={cell.mark} />
      <span className="sr-only">{MARK_LABEL[cell.mark]}</span>
      {cell.text ? <span className="hidden sm:inline">{cell.text}</span> : null}
    </span>
  );
}

function ClaudeHead({ label, className }: { label: string; className?: string }) {
  return (
    <th scope="col" className={cn("px-2 py-4 font-semibold sm:px-0 sm:pr-7", className)}>
      <span className="inline-flex items-center gap-2 text-foreground">
        <Image src="/tool-logos/claude.svg" alt="" width={20} height={20} aria-hidden />
        {label}
      </span>
    </th>
  );
}

export function HomeClaudeCompare() {
  return (
    <section aria-labelledby="home-compare-heading" className="bg-white pt-24 sm:pt-32 lg:pt-44">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <h2 id="home-compare-heading" className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.95rem]">
            What Claude’s own admin shows per person.
          </h2>
          <p className="flex gap-5 text-sm text-muted-foreground" aria-hidden>
            {(["yes", "partly", "no"] as const).map((mark) => (
              <span key={mark} className="inline-flex items-center gap-2">
                <Dot mark={mark} />
                {MARK_LABEL[mark]}
              </span>
            ))}
          </p>
        </div>

        <table className="mt-8 w-full border-collapse border-t-2 !border-foreground text-left text-sm sm:mt-11 sm:text-[0.9375rem]">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-4 pr-2 sm:pr-7">
                <span className="sr-only">What you want to see</span>
              </th>
              <ClaudeHead label="Team admin" />
              <ClaudeHead label="Enterprise admin" className="hidden md:table-cell" />
              <th scope="col" className="bg-primary px-3 py-4 font-semibold text-white sm:px-6">
                UseJunction
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.feature} className="border-b border-border">
                <th scope="row" className="py-[18px] pr-2 font-semibold sm:w-[31%] sm:pr-7">
                  {row.feature}
                </th>
                <td className="px-2 py-[18px] text-[#3a3b37] sm:px-0 sm:pr-7">
                  <MarkCell cell={row.team} />
                </td>
                <td className="hidden py-[18px] pr-7 text-[#3a3b37] md:table-cell">
                  <MarkCell cell={row.enterprise} />
                </td>
                <td className="bg-[#e6f3f5] px-3 py-[18px] sm:w-[27%] sm:px-6">
                  <MarkCell cell={row.ours} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_44rem] lg:gap-14">
          <div className="flex flex-col items-start gap-3.5">
            <Link
              href="/blog/check-claude-team-usage"
              className="border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
            >
              How to check your team’s usage in Claude
            </Link>
            <Link
              href="/guides/claude-premium-vs-standard-seat"
              className="border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
            >
              Premium or Standard seat?
            </Link>
          </div>
          <figure>
            <div className="overflow-x-auto">
              <Image
                src="/home/crop-priya.png"
                alt="One person's weekly limit at 97%, near limit, and 5-hour limit at 64%"
                width={1717}
                height={140}
                sizes="704px"
                className="h-auto w-[600px] max-w-none border border-border sm:w-full sm:max-w-full"
              />
            </div>
            <figcaption className="mt-2.5 text-[0.8125rem] text-muted-foreground">
              Weekly and 5-hour limit use for one person, in UseJunction.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
