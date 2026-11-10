import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Note } from "@/components/public/home-story";
import { cn } from "@/lib/utils";

function Role({
  who,
  question,
  line,
  art,
  artAlign = "end",
}: {
  who: string;
  question: string;
  line: string;
  art: ReactNode;
  artAlign?: "start" | "end";
}) {
  return (
    <div className="grid gap-6 border-b border-border py-8 lg:grid-cols-[23.25rem_minmax(0,1fr)] lg:items-center lg:gap-[4.5rem] lg:py-10">
      <div>
        <p className="text-[0.9rem] font-semibold text-primary">{who}</p>
        <h3 className="mt-2 text-[1.3rem] font-semibold leading-snug tracking-[-0.02em] [text-wrap:balance] sm:text-2xl">
          {question}
        </h3>
        <p className="mt-3 text-[0.9375rem] leading-7 text-muted-foreground">{line}</p>
      </div>
      <div className={cn("flex min-w-0 flex-wrap gap-4", artAlign === "end" ? "lg:justify-end" : "lg:justify-start")}>
        {art}
      </div>
    </div>
  );
}

function Crop({ src, alt, width, height, display }: { src: string; alt: string; width: number; height: number; display: number }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={`(max-width: 768px) 92vw, ${display}px`}
      className="h-auto max-w-full border border-border"
      style={{ width: display }}
    />
  );
}

/** Columns match the Cost page's "Export CSV" header (components/tools/subscription-inventory.tsx). */
const SHEET_COLUMNS = [
  { head: "Tool", width: 62 },
  { head: "Plans", width: 104 },
  { head: "Seats paid", width: 62, numeric: true },
  { head: "Seats assigned", width: 76, numeric: true },
  { head: "People using it (30d)", width: 98, numeric: true },
  { head: "Seats per month (USD)", width: 104, numeric: true },
  { head: "Next renewal", width: 94 },
] as const;

const SHEET_ROWS = [
  ["Claude", "Claude Team", "5", "4", "4", "350.00", "2026-12-03"],
  ["Cursor", "Cursor Teams", "3", "3", "1", "90.00", "2026-12-14"],
] as const;

/** The Cost page's CSV export as it looks opened in a spreadsheet; example data. */
function CostSheet() {
  const letters = "ABCDEFG".split("");
  const cell = "h-6 overflow-hidden border border-[#e1e3dd] px-[7px] py-1 align-bottom";
  const rowHead = "border border-[#e1e3dd] bg-[#f1f2ee] text-center text-[11.5px] font-normal text-[#6b6d66]";
  return (
    <div className="w-full overflow-x-auto pb-12 lg:w-auto lg:overflow-visible lg:pb-9">
      <figure
        aria-label="cost.csv from the Cost page, opened in a spreadsheet"
        className="relative w-[632px] border border-[#c9cbc3] bg-white font-[Arial,Helvetica,sans-serif] text-[12.5px] leading-[1.3] text-[#1f1f1f]"
      >
        <div className="flex items-center gap-2 border-b border-[#d7d9d2] bg-[#f6f6f2] px-2 py-1.5 text-xs">
          <span className="min-w-[46px] border border-[#d7d9d2] bg-white px-2 py-0.5 text-center text-[#5b5d56]">E3</span>
          <span className="flex-1 border border-[#d7d9d2] bg-white px-2 py-0.5">1</span>
        </div>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: 30 }} />
            {SHEET_COLUMNS.map((column) => (
              <col key={column.head} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={rowHead}>
                <span className="sr-only">Row</span>
              </th>
              {letters.map((letter) => (
                <th key={letter} className={cn(rowHead, "h-6")}>
                  {letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className={rowHead}>1</th>
              {SHEET_COLUMNS.map((column) => (
                <td key={column.head} className={cn(cell, "font-bold")}>
                  {column.head}
                </td>
              ))}
            </tr>
            {SHEET_ROWS.map((row, rowIndex) => (
              <tr key={row[0]}>
                <th className={rowHead}>{rowIndex + 2}</th>
                {row.map((value, index) => (
                  <td
                    key={index}
                    className={cn(
                      cell,
                      "numeric" in SHEET_COLUMNS[index] && "text-right tabular-nums",
                      rowIndex === 1 && index === 4 && "outline outline-2 -outline-offset-2 outline-primary",
                    )}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
            {[4, 5].map((n) => (
              <tr key={n}>
                <th className={rowHead}>{n}</th>
                {SHEET_COLUMNS.map((column) => (
                  <td key={column.head} className={cell} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex border-t border-[#d7d9d2] bg-[#f6f6f2] text-xs">
          <span className="border-b-2 border-r border-[#d7d9d2] !border-b-primary bg-white px-4 pb-[5px] pt-1.5 font-bold">cost</span>
        </div>
        <Note
          style={{ left: "60%", top: "100%", marginTop: -22, transform: "rotate(1.5deg)", fontFamily: "var(--public-sans)" }}
          arrow={{
            viewBox: "0 0 56 44",
            box: { left: -10, top: -40, width: 56, height: 44 },
            paths: ["M50 40C46 22 30 10 8 8", "M22 2L6 8l11 14"],
          }}
        >
          3 seats paid, 1 person using them
        </Note>
      </figure>
    </div>
  );
}

const NEVER = ["Keystrokes or screenshots", "Browser activity", "Network traffic", "Time in the editor"];

export function HomeRoles() {
  return (
    <section aria-labelledby="home-roles-heading" className="bg-white pt-24 sm:pt-32 lg:pt-[9.5rem]">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <h2 id="home-roles-heading" className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.95rem]">
          Who asks, and what they see.
        </h2>
        <div className="mt-10 border-t-2 !border-foreground lg:mt-14">
          <Role
            who="Engineering manager"
            question="What this month comes to at the current pace."
            line="Provider usage projects the rest of the month from the daily spend so far."
            art={
              <Crop
                src="/home/forecast.png"
                alt="Provider usage: $639.00 projected at current daily pace, $213.00 actual so far, with a dashed line to the end of the month"
                width={1292}
                height={486}
                display={646}
              />
            }
          />
          <Role
            who="Project manager"
            question="What each task has cost so far, and whether it shipped."
            line="Biggest items lists pull requests and issues with their spend, marked Merged, Open or Not moving."
            artAlign="start"
            art={
              <Crop
                src="/home/items.png"
                alt="Biggest items: Add team invitations $693.48 merged, Fix repeated webhook deliveries $346.74 open, Rewrite billing jobs $173.37 not moving"
                width={658}
                height={724}
                display={360}
              />
            }
          />
          <Role
            who="Leadership"
            question="Which roadmap work is the spend sitting on?"
            line="Spend by week, split by GitHub Projects board."
            art={
              <Crop
                src="/home/projects-chart.png"
                alt="Spend by week by project: Product roadmap $1,040.22 and Launch readiness $346.74, as weekly bars"
                width={1292}
                height={566}
                display={646}
              />
            }
          />
          <Role
            who="Finance"
            question="One row per tool, ready for a spreadsheet."
            line="Export CSV on the Cost page gives seats paid, seats assigned, people using it and the next renewal."
            artAlign="start"
            art={<CostSheet />}
          />
          <Role
            who="Developer"
            question="What is held about them, and who sees it."
            line="My data lists it, with a sharing switch for each login."
            art={
              <div className="w-[420px] max-w-full">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Never collected</p>
                <ul className="mt-2">
                  {NEVER.map((item) => (
                    <li
                      key={item}
                      className="py-1.5 text-lg font-medium text-[#8b8d85] line-through decoration-foreground decoration-[1.5px]"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href="#home-privacy-heading"
                  className="mt-3.5 inline-block border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary"
                >
                  See what it collects
                </Link>
              </div>
            }
          />
        </div>
      </div>
    </section>
  );
}
