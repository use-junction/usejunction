"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, GitMerge } from "lucide-react";
import { HOME_PRICE_LINE, HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";
import { cn } from "@/lib/utils";

type Mark = "yes" | "partly" | "no" | "unknown";
type Cell = { mark: Mark; text?: string };

const MARK_LABEL: Record<Mark, string> = {
  yes: "Yes",
  partly: "Partly",
  no: "Not in their docs",
  unknown: "Unconfirmed",
};

const VENDORS = [
  { name: "Claude", logo: "claude.svg" },
  { name: "Cursor", logo: "cursor.svg" },
  { name: "GitHub Copilot", logo: "copilot.svg" },
  { name: "Codex", logo: "chatgpt.svg" },
] as const;

/**
 * Each row is a question a manager asks. Our column holds the answer for the example team; the
 * vendor cells say what each vendor's own admin shows, from their public team and enterprise docs
 * (November 2026). Sources: .claude/research/research_notes/Homepage value beyond cost savings/
 * vendor_admin_capabilities.md. Codex cells come from OpenAI's Codex analytics and credit-control
 * help pages as summarised in search results (November 2026); re-check them against the pages themselves.
 */
/** `elsewhere` is the phone layout's one-line reading of the four vendor cells, so it must stay true to them. */
const ROWS: { question: string; answer: string; detail: string; elsewhere: string; vendors: [Cell, Cell, Cell, Cell] }[] = [
  {
    question: "Who is about to hit a limit?",
    answer: "Priya, 97%",
    detail: "resets Thursday 9:00 AM",
    elsewhere: "A spending cap at best, set tool by tool",
    vendors: [{ mark: "no", text: "Not shown" }, { mark: "partly", text: "Spend limit" }, { mark: "partly", text: "Budgets" }, { mark: "partly", text: "Credit limit" }],
  },
  {
    question: "What did each person spend?",
    answer: "Marcus, $948",
    detail: "this month, across both tools",
    elsewhere: "Four separate numbers, one per tool",
    vendors: [{ mark: "partly", text: "CSV report" }, { mark: "partly", text: "This cycle" }, { mark: "partly", text: "Estimate" }, { mark: "yes", text: "Credits" }],
  },
  // Each vendor shows spend for its own tool, never the total across tools.
  {
    question: "Where will this month’s bill land?",
    answer: "$42,540 by month end",
    detail: "$14,180 spent in the first ten days",
    elsewhere: "Four separate bills, and no total",
    vendors: [{ mark: "partly", text: "Own bill" }, { mark: "partly", text: "Own bill" }, { mark: "partly", text: "Own bill" }, { mark: "partly", text: "Own bill" }],
  },
];

/**
 * The fourth row: the next feature, which has not started, priced from its tickets. Each ticket is
 * estimated from what its assignee spent on the last feature like it, and the teal bar shows who
 * the spend is expected to come from. The thin grey bar under it is that earlier feature, drawn to
 * the same scale, so the estimate visibly sits against something that already merged. It is a
 * share of one feature, never a score: people are listed in ticket order, not ranked. This needs
 * tickets and assignees from Jira, which the app still marks "Soon".
 */
const SPRINT_QUESTION = "What will the next feature cost?";
const SPRINT = { answer: "SSO login, about $5,400", detail: "not started, 6 tickets" };
const SPRINT_TICKETS = 6;
const BASED_ON = { name: "Team invitations", amount: 6930 };
const SPRINT_PEOPLE = [
  { name: "Marcus", amount: 1900, tickets: 2, bar: "bg-[#08758a] text-white" },
  { name: "Priya", amount: 1600, tickets: 2, bar: "bg-[#3d94a5] text-white" },
  { name: "Tom", amount: 1100, tickets: 1, bar: "bg-[#7fbcc6] text-foreground" },
  { name: "Amara", amount: 800, tickets: 1, bar: "bg-[#b9dce2] text-foreground" },
] as const;
const SPRINT_TOTAL = SPRINT_PEOPLE.reduce((sum, person) => sum + person.amount, 0);
const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

function SprintBar({ picked, onPick }: { picked: number | null; onPick: (index: number | null) => void }) {
  return (
    <div>
      <div
        role="group"
        aria-label="Who the feature’s spend comes from"
        className="flex gap-0.5"
        style={{ width: `${Math.round((SPRINT_TOTAL / BASED_ON.amount) * 100)}%` }}
      >
        {SPRINT_PEOPLE.map((person, index) => (
          <button
            key={person.name}
            type="button"
            aria-pressed={picked === index}
            onClick={() => onPick(picked === index ? null : index)}
            style={{ flex: person.amount }}
            className={cn("min-w-[3.25rem] px-1.5 py-2 text-left transition-opacity lg:min-w-0 lg:px-2", person.bar, picked !== null && picked !== index && "opacity-40")}
          >
            <span className="block truncate text-[0.84rem] font-semibold leading-tight">{person.name}</span>
            <span className="block text-[0.78rem] leading-tight tabular-nums">{usd(person.amount)}</span>
          </button>
        ))}
      </div>
      <span aria-hidden className="mt-1.5 block h-1.5 bg-[#b4c3c6]" />
      <p className="mt-1.5 flex items-center gap-1.5 text-[0.78rem] text-[#3f5d63]">
        <GitMerge className="size-3.5 shrink-0 text-[#8250df]" strokeWidth={2.2} aria-hidden />
        Based on {BASED_ON.name}, which merged at {usd(BASED_ON.amount)}
      </p>
    </div>
  );
}

function Dot({ mark, small }: { mark: Exclude<Mark, "unknown">; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full",
        small ? "size-[13px]" : "size-[18px]",
        mark === "yes" && "bg-[#33342f]",
        mark === "partly" && "bg-[linear-gradient(90deg,#33342f_50%,transparent_50%)] shadow-[inset_0_0_0_2px_#33342f]",
        mark === "no" && "shadow-[inset_0_0_0_2px_#c8c8c2]",
      )}
    />
  );
}

function MarkCell({ cell, small }: { cell: Cell; small?: boolean }) {
  if (cell.mark === "unknown") {
    return <span className="text-[0.78rem] italic text-[#8b8d85]">Unconfirmed</span>;
  }
  return (
    <span className="inline-flex items-center gap-2.5">
      <Dot mark={cell.mark} small={small} />
      {cell.text === MARK_LABEL[cell.mark] ? null : <span className="sr-only">{MARK_LABEL[cell.mark]}</span>}
      {cell.text ? <span className={cn(cell.mark === "no" && "text-[#8b8d85]")}>{cell.text}</span> : null}
    </span>
  );
}

export function HomeVendorCompare() {
  const [picked, setPicked] = useState<number | null>(null);
  const person = picked === null ? null : SPRINT_PEOPLE[picked];
  const sprintAnswer = person ? `${person.name}, about ${usd(person.amount)}` : SPRINT.answer;
  const sprintDetail = person ? `${person.tickets} of the ${SPRINT_TICKETS} tickets` : SPRINT.detail;
  return (
    <section aria-labelledby="home-compare-heading" className="overflow-x-clip bg-white pt-24 sm:pt-32 lg:pt-[9.5rem]">
      <div className="mx-auto w-full max-w-[75rem] px-4 sm:px-6">
        <h2 id="home-compare-heading" className="text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-[#3a3b37] sm:text-[1.95rem]">
          Four tabs open, and you’re still guessing.
        </h2>

        {/* Desktop: one table, our answer straight after the question. */}
        <div className="relative mt-11 hidden lg:block">
          <table className="w-full table-fixed border-collapse border-t-2 !border-foreground text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-[290px]">
                  <span className="sr-only">The question</span>
                </th>
                <th scope="col" className="w-[284px] border-t-4 !border-primary bg-[#d9edf0] px-[22px] py-5 align-middle">
                  <Image src="/usejunction.png" alt="UseJunction" width={132} height={32} className="h-8 w-auto" />
                </th>
                {VENDORS.map((vendor, index) => (
                  <th key={vendor.name} scope="col" className={cn("py-4 pr-3 align-bottom font-semibold", index === 0 && "pl-7")}>
                    <span className="flex flex-col gap-2 text-[0.9rem] text-foreground">
                      <Image src={`/tool-logos/${vendor.logo}`} alt="" width={22} height={22} aria-hidden />
                      {vendor.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.question} className="border-b border-border">
                  <th scope="row" className="py-5 pr-4 text-[1.03rem] font-medium leading-snug tracking-[-0.008em]">
                    {row.question}
                  </th>
                  <td className="bg-[#e6f3f5] px-[22px] py-5">
                    <span className="block text-[1.1875rem] font-bold leading-tight tracking-[-0.015em]">{row.answer}</span>
                    <span className="mt-0.5 block text-[0.84rem] text-[#3f5d63]">{row.detail}</span>
                  </td>
                  {row.vendors.map((cell, index) => (
                    <td key={index} className={cn("py-5 pr-3 text-[#3a3b37]", index === 0 && "pl-7")}>
                      <MarkCell cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b-4 !border-primary bg-[#e6f3f5]">
                <th scope="row" className="bg-white py-5 pr-4 text-[1.03rem] font-medium leading-snug tracking-[-0.008em]">
                  {SPRINT_QUESTION}
                </th>
                <td aria-live="polite" className="px-[22px] py-5">
                  <span className="block text-[1.1875rem] font-bold leading-tight tracking-[-0.015em]">{sprintAnswer}</span>
                  <span className="mt-0.5 block text-[0.84rem] text-[#3f5d63]">{sprintDetail}</span>
                </td>
                <td colSpan={4} className="py-4 pl-7 pr-4">
                  <SprintBar picked={picked} onPick={setPicked} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Phones and tablets: one block per question. */}
        <ul className="mt-8 border-t-2 !border-foreground sm:grid sm:grid-cols-2 sm:gap-x-8 lg:hidden">
          {ROWS.map((row) => (
            <li key={row.question} className="border-b border-border py-6">
              <h3 className="text-[1.0625rem] font-semibold leading-snug tracking-[-0.01em]">{row.question}</h3>
              <div className="mt-3 border-l-4 !border-primary bg-[#e6f3f5] px-4 py-3">
                <p className="text-xs font-semibold text-primary-dark">UseJunction</p>
                <p className="mt-0.5 text-lg font-bold leading-tight tracking-[-0.015em]">{row.answer}</p>
                <p className="mt-0.5 text-[0.84rem] text-[#3f5d63]">{row.detail}</p>
              </div>
              <div className="mt-1.5 border-l-4 !border-[#cfd0c8] bg-[#f4f4f0] px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-[#6b6d66]">
                  <span aria-hidden className="flex items-center gap-1">
                    {VENDORS.map((vendor) => (
                      <Image key={vendor.name} src={`/tool-logos/${vendor.logo}`} alt="" width={15} height={15} />
                    ))}
                  </span>
                  The four admin pages
                </p>
                <p className="mt-1 text-[0.9375rem] font-medium leading-snug text-[#3a3b37]">{row.elsewhere}</p>
              </div>
            </li>
          ))}
          <li className="border-b border-border py-6">
            <h3 className="text-[1.0625rem] font-semibold leading-snug tracking-[-0.01em]">{SPRINT_QUESTION}</h3>
            <div aria-live="polite" className="mt-3 border-l-4 !border-primary bg-[#e6f3f5] px-4 py-3">
              <p className="text-xs font-semibold text-primary-dark">UseJunction</p>
              <p className="mt-0.5 text-lg font-bold leading-tight tracking-[-0.015em]">{sprintAnswer}</p>
              <p className="mt-0.5 text-[0.84rem] text-[#3f5d63]">{sprintDetail}</p>
            </div>
            <div className="mt-3.5">
              <SprintBar picked={picked} onPick={setPicked} />
            </div>
          </li>
        </ul>

        <p className="mt-6 max-w-3xl text-[0.8125rem] leading-6 text-muted-foreground">
          Our answers are for an example team. The rest comes from each tool’s public admin docs for team and
          enterprise plans, read in November 2026
          <span className="max-lg:hidden">
          :{" "}
          <span className="whitespace-nowrap">
            <span className="mr-1 inline-block align-[-2px]">
              <Dot mark="yes" small />
            </span>
            yes,
          </span>{" "}
          <span className="whitespace-nowrap">
            <span className="mr-1 inline-block align-[-2px]">
              <Dot mark="partly" small />
            </span>
            partly,
          </span>{" "}
          <span className="whitespace-nowrap">
            <span className="mr-1 inline-block align-[-2px]">
              <Dot mark="no" small />
            </span>
            not shown in their docs
          </span>
          </span>
          . Tell us if one is wrong.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <Link
            href={HOME_SIGNUP_HREF}
            className="public-btn public-btn-cta w-full rounded-none sm:w-auto"
          >
            {HOME_SIGNUP_LABEL}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
          <p className="text-[0.9rem] text-[#3a3b37]">{HOME_PRICE_LINE}</p>
        </div>
      </div>
    </section>
  );
}
