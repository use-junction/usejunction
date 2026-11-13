import type { ReactNode } from "react";
import { ChartLine, Check, Receipt, SquareKanban, SquareTerminal, UsersRound, type LucideIcon } from "lucide-react";
import { IntegrationProviderMark } from "@/components/features/integration-provider-logos";
import { Note, Notes } from "@/components/public/home-story";
import { DecorativeToolIcon } from "@/components/public/tool-logos-strip";
import { cn } from "@/lib/utils";

/**
 * One row per person who asks. Each heading is the answer they get for the example team, and each
 * picture is drawn from numbers the app holds (People, Usage, Work, Overview, Cost export, My data).
 * The app lays some of them out differently, which the caption under the rows says.
 */

const ROLE_ICONS: Record<string, LucideIcon> = {
  "Engineering manager": UsersRound,
  "Project manager": SquareKanban,
  Leadership: ChartLine,
  Finance: Receipt,
  Developer: SquareTerminal,
};

/** Who is asking, as a tinted tag with an icon, so each row can be found while scrolling. */
function RoleLabel({ who }: { who: string }) {
  const Icon = ROLE_ICONS[who];
  return (
    <p className="inline-flex items-center gap-2 border !border-[#bfdde3] bg-[#e6f3f5] px-2.5 py-[5px] text-[0.875rem] font-semibold leading-none text-[#06606f]">
      {Icon ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}
      {who}
    </p>
  );
}

/** Text beside its picture. Every other row flips sides on desktop; the text stays first in the markup. */
function Role({ who, answer, flip, children }: { who: string; answer: string; flip?: boolean; children: ReactNode }) {
  return (
    <div
      data-role={who}
      className={cn(
        "grid gap-5 py-10 lg:gap-7 lg:py-14 xl:items-start xl:gap-20 xl:py-16",
        flip ? "xl:grid-cols-[minmax(0,1fr)_23.25rem]" : "xl:grid-cols-[23.25rem_minmax(0,1fr)]",
      )}
    >
      <div className={cn(flip && "xl:order-last")}>
        <RoleLabel who={who} />
        <h3 className="mt-3.5 text-[1.3rem] font-semibold leading-snug tracking-[-0.02em] [text-wrap:balance] sm:text-2xl lg:mt-4 lg:text-[1.75rem] lg:leading-[1.22]">
          {answer}
        </h3>
      </div>
      {/* Side by side only from 1280px: below that the people table and the sheet need the full width. */}
      <div className="min-w-0 max-w-[700px] xl:max-w-none">{children}</div>
    </div>
  );
}

function Card({ title, sub, meta, icon, label, children }: { title: string; sub: string; meta: string; icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <figure aria-label={label} className="border border-border bg-white text-[0.9375rem] leading-snug">
      <figcaption className="flex items-center justify-between gap-4 border-b border-border px-4 py-[15px] sm:px-[22px]">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[1.0625rem] font-semibold tracking-[-0.01em]">
          {icon}
          {title}
          <span className="text-sm font-normal tracking-normal text-muted-foreground">{sub}</span>
        </span>
        <span className="shrink-0 text-[0.8125rem] text-muted-foreground">{meta}</span>
      </figcaption>
      {children}
    </figure>
  );
}

/* ---------- Engineering manager: one row per person, every tool ---------- */

type ToolUse = { percent: number; tone: "warn" | "ok" | "idle"; status: string } | { note: string; warn?: boolean };

const PEOPLE: { name: string; plan: string; claude: ToolUse; cursor: ToolUse; spend: string }[] = [
  { name: "Priya Natarajan", plan: "Team Standard", claude: { percent: 97, tone: "warn", status: "Near limit" }, cursor: { percent: 1, tone: "warn", status: "Barely used" }, spend: "$612" },
  { name: "Marcus Lee", plan: "Team Premium", claude: { percent: 58, tone: "ok", status: "OK" }, cursor: { percent: 41, tone: "ok", status: "OK" }, spend: "$948" },
  { name: "Tom Becker", plan: "Team Standard", claude: { percent: 31, tone: "ok", status: "OK" }, cursor: { percent: 2, tone: "warn", status: "Barely used" }, spend: "$403" },
  { name: "Elena Rossi", plan: "Team Standard", claude: { percent: 6, tone: "idle", status: "Quiet seat" }, cursor: { note: "No seat" }, spend: "$41" },
];

const PEOPLE_GRID = "sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_4.75rem]";

function ToolCell({ tool, use }: { tool: string; use: ToolUse }) {
  return (
    <div className="flex items-center gap-2.5 max-sm:col-span-2">
      <span className="sm:hidden">
        <DecorativeToolIcon name={tool} size={15} />
      </span>
      {"note" in use ? (
        <span className={cn("text-[0.78rem]", use.warn ? "font-medium text-[#c2650c]" : "text-muted-foreground")}>{use.note}</span>
      ) : (
        <>
          <span className="relative h-1.5 w-[84px] shrink-0 bg-[#eeefe9]">
            <span
              className={cn("absolute inset-y-0 left-0", use.tone === "warn" ? "bg-[#dd7a12]" : use.tone === "ok" ? "bg-primary" : "bg-[#8f918a]")}
              style={{ width: `${use.percent}%` }}
            />
          </span>
          <span className="w-9 text-sm font-semibold tabular-nums">{use.percent}%</span>
          <span className={cn("whitespace-nowrap text-[0.78rem]", use.tone === "warn" ? "font-medium text-[#c2650c]" : "text-muted-foreground")}>
            {use.status}
          </span>
        </>
      )}
    </div>
  );
}

function PeopleCard() {
  return (
    <Card title="People" sub="4 of 38 shown" meta="36 of 38 machines reporting" label="Four people on an example team, with each person’s Claude and Cursor use and what they spent this month">
      <div aria-hidden className={cn("hidden border-b border-border px-[22px] py-2.5 text-[0.78rem] text-muted-foreground sm:grid", PEOPLE_GRID)}>
        <span>Person</span>
        <span className="flex items-center gap-1.5">
          <DecorativeToolIcon name="Claude Code" size={15} />
          Claude
        </span>
        <span className="flex items-center gap-1.5">
          <DecorativeToolIcon name="Cursor" size={15} />
          Cursor
        </span>
        <span className="whitespace-nowrap text-right">This month</span>
      </div>
      <ul>
        {PEOPLE.map((person) => (
          <li
            key={person.name}
            className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3.5 last:border-b-0 sm:gap-y-0 sm:px-[22px] sm:py-[13px]", PEOPLE_GRID)}
          >
            <div>
              <p className="font-semibold">{person.name}</p>
              <p className="text-[0.78rem] text-muted-foreground">{person.plan}</p>
            </div>
            <p className="text-right font-semibold tabular-nums sm:order-last">{person.spend}</p>
            <ToolCell tool="Claude Code" use={person.claude} />
            <ToolCell tool="Cursor" use={person.cursor} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- Developer: what is held, and the switch ---------- */

const NEVER = ["Keystrokes", "Screenshots", "Browser activity", "Network traffic"];

function Switch({ on }: { on: boolean }) {
  return (
    <span role="img" aria-label={on ? "Sharing on" : "Sharing off"} className={cn("relative h-6 w-11 shrink-0 rounded-full", on ? "bg-primary" : "bg-[#d5d7cf]")}>
      <span className={cn("absolute top-[3px] size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]", on ? "left-[23px]" : "left-[3px]")} />
    </span>
  );
}

function MyDataCard() {
  const logins = [
    { tool: "Claude Code", name: "Claude", login: "priya@northwind.dev · company login", on: true, state: "Shared with admins" },
    { tool: "Codex", name: "Codex", login: "p•••@gmail.com · personal login", on: false, state: "Not shared" },
  ];
  return (
    <Card title="My data" sub="Priya Natarajan" meta="Only you can change these" label="A developer’s own page: each login with a sharing switch, and what is never collected">
      <ul>
        {logins.map((login) => (
          <li key={login.name} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3.5 border-b border-border px-4 py-4 sm:grid-cols-[22px_minmax(0,1fr)_auto_auto] sm:px-[22px]">
            <DecorativeToolIcon name={login.tool} size={22} />
            <div className="min-w-0">
              <p className="text-[0.97rem] font-semibold">{login.name}</p>
              <p className="truncate text-[0.8125rem] text-muted-foreground">{login.login}</p>
            </div>
            <span className={cn("text-[0.84rem] font-medium max-sm:hidden", login.on ? "text-[#0a6373]" : "text-muted-foreground")}>{login.state}</span>
            <Switch on={login.on} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1.5 px-4 py-3.5 text-[0.9rem] text-[#55574f] sm:px-[22px]">
        <span className="text-[0.78rem] font-semibold text-muted-foreground">Never collected</span>
        <ul aria-label="Never collected" className="contents">
          {NEVER.map((item) => (
            <li key={item} className="line-through decoration-foreground decoration-[1.5px]">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/* ---------- Project manager: a Jira board with the spend beside each ticket ---------- */

/**
 * Ticket keys are read from branch names, commits and pull requests (lib/features/ticket-keys.ts),
 * so spend can be shown per Jira ticket today. Connecting Jira itself is still marked "Soon" in the app,
 * and the estimate on a ticket that has not started (from its assignee's past tickets) needs that connection.
 */
type Ticket = { id: string; title: string; who: string; spend: string; estimate?: boolean; stalled?: boolean };
const BOARD: { column: string; tickets: Ticket[] }[] = [
  { column: "To do", tickets: [{ id: "NW-238", title: "Usage alerts by email", who: "TB", spend: "$2,100", estimate: true }] },
  {
    column: "In progress",
    tickets: [
      { id: "NW-231", title: "Fix repeated webhook deliveries", who: "PN", spend: "$3,382" },
      { id: "NW-224", title: "Rewrite billing jobs", who: "AO", spend: "$1,819", stalled: true },
    ],
  },
  { column: "Done", tickets: [{ id: "NW-212", title: "Add team invitations", who: "ML", spend: "$6,930" }] },
];

function BoardCard() {
  return (
    <Card
      title="Product roadmap"
      sub="Board"
      meta="Spent, and estimated before it starts"
      icon={<IntegrationProviderMark provider="jira" size={18} className="shrink-0" />}
      label="A Jira board for an example team with the AI spend on each ticket"
    >
      <div className="grid gap-3 bg-[#f7f8f9] p-3 sm:grid-cols-3 sm:p-4">
        {BOARD.map((list) => (
          <section key={list.column} aria-label={list.column} className="bg-[#eceef1] p-2">
            <h4 className="px-1.5 pb-2 pt-1 text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-[#44546f]">
              {list.column} <span className="font-normal">{list.tickets.length}</span>
            </h4>
            <ul className="grid gap-2">
              {list.tickets.map((ticket) => (
                <li key={ticket.id} className="rounded-[3px] bg-white p-2.5 shadow-[0_1px_1px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)]">
                  <p className="text-[0.875rem] leading-snug text-[#172b4d]">{ticket.title}</p>
                  <p className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[0.75rem] font-medium text-[#44546f]">
                      <span aria-hidden className="flex size-4 items-center justify-center rounded-[3px] bg-[#4bade8] text-white">
                        <Check className="size-3" strokeWidth={3.5} />
                      </span>
                      {ticket.id}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "whitespace-nowrap px-1.5 py-0.5 text-[0.78rem] font-bold tabular-nums",
                          ticket.estimate
                            ? "border border-dashed !border-primary bg-white text-[#0a6373]"
                            : ticket.stalled
                              ? "bg-[#fbebdd] text-[#b9561c]"
                              : "bg-[#e6f3f5] text-[#0a6373]",
                        )}
                      >
                        <span className="sr-only">{ticket.estimate ? "Estimated AI spend " : "AI spend "}</span>
                        {ticket.estimate ? <span aria-hidden className="font-medium">est. </span> : null}
                        {ticket.spend}
                      </span>
                      <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-[#dfe1e6] text-[0.6rem] font-bold text-[#42526e]">
                        {ticket.who}
                      </span>
                    </span>
                  </p>
                  {ticket.stalled ? <p className="mt-1.5 text-[0.75rem] font-medium text-[#b9561c]">Not moving</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Leadership: three questions, one small picture each ---------- */

const TEAMS = [
  { name: "Platform", people: 12, percent: 92 },
  { name: "Payments", people: 14, percent: 79 },
  { name: "Data", people: 12, percent: 42 },
];

function Answer({ label, question, children }: { label: string; question: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[1.0625rem] font-semibold leading-snug tracking-[-0.012em]">{question}</h4>
      <figure aria-label={label} className="mt-3 flex h-[212px] flex-col justify-center border border-border bg-white px-5 py-5 sm:px-6">
        {children}
      </figure>
    </div>
  );
}

function LeadershipAnswers() {
  return (
    <div className="mt-7 grid gap-7 sm:grid-cols-3 sm:gap-5 lg:mt-12 lg:gap-6">
      <Answer
        label="Share of each team that used an AI tool this week: Platform 92%, Payments 79%, Data 42%"
        question="Which teams are using it?"
      >
        <ul className="grid gap-4">
          {TEAMS.map((team) => (
            <li key={team.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
              <p className="text-[0.9375rem] font-semibold">
                {team.name} <span className="text-[0.78rem] font-normal text-muted-foreground">{team.people} people</span>
              </p>
              <p className={cn("text-[0.9375rem] font-bold tabular-nums", team.percent < 50 && "text-[#c2650c]")}>{team.percent}%</p>
              <span className="relative col-span-2 h-2 bg-[#eeefe9]">
                <span className={cn("absolute inset-y-0 left-0", team.percent < 50 ? "bg-[#dd7a12]" : "bg-primary")} style={{ width: `${team.percent}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </Answer>

      <Answer
        label="Spend this month: $14,180 in the first ten days, $42,540 projected at the same daily pace"
        question="What will this month cost?"
      >
        <div className="flex items-end justify-between gap-3">
          <p>
            <span className="block text-[1.75rem] font-bold leading-none tracking-[-0.035em]">$42,540</span>
            <span className="mt-1.5 block text-[0.78rem] text-muted-foreground">at this pace</span>
          </p>
          <p className="text-right">
            <span className="block text-[0.9375rem] font-semibold">$14,180</span>
            <span className="block text-[0.78rem] text-muted-foreground">so far, day 10</span>
          </p>
        </div>
        <svg viewBox="0 0 240 86" className="mt-4 h-[86px] w-full" preserveAspectRatio="none" aria-hidden>
          <path d="M2 82L28 74 54 69 82 58V82Z" fill="#08758a" fillOpacity="0.1" />
          <path d="M2 82L28 74 54 69 82 58" fill="none" stroke="#08758a" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <path d="M82 58L238 6" fill="none" stroke="#08758a" strokeWidth="2.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
          <path d="M82 4V82" stroke="#c9cbc3" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d="M2 82H238" stroke="#c9cbc3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
      </Answer>

      <Answer
        label="Return on the spend: 57% of matched spend landed on merged work, at $1,527 per merged pull request"
        question="What are we getting for it?"
      >
        <p className="flex items-baseline gap-2">
          <span className="text-[2.5rem] font-bold leading-none tracking-[-0.04em] text-primary">57%</span>
          <span className="text-[0.84rem] leading-tight text-muted-foreground">of spend landed on merged work</span>
        </p>
        <span aria-hidden className="mt-4 flex h-3 gap-0.5">
          <span className="bg-primary" style={{ flex: 35120 }} />
          <span className="bg-[#9aae2f]" style={{ flex: 17140 }} />
          <span className="bg-[#c1652b]" style={{ flex: 9220 }} />
        </span>
        <p className="mt-5 flex items-baseline justify-between gap-3 border-t border-border pt-3.5">
          <span className="text-[0.84rem] text-muted-foreground">Per merged pull request</span>
          <span className="text-[1.25rem] font-bold tracking-[-0.02em]">$1,527</span>
        </p>
      </Answer>
    </div>
  );
}

/* ---------- Finance: the Cost page's CSV export, as it looks opened in a spreadsheet ---------- */

/** Columns match the Cost page's "Export CSV" header (components/tools/subscription-inventory.tsx). */
const SHEET_COLUMNS = [
  { head: "Tool", width: "9.8%" },
  { head: "Plans", width: "16.5%", wide: true },
  { head: "Seats paid", width: "9.8%", numeric: true },
  { head: "Seats assigned", width: "12%", numeric: true, wide: true },
  { head: "People using it (30d)", width: "15.5%", numeric: true },
  { head: "Seats per month (USD)", width: "16.6%", numeric: true },
  { head: "Next renewal", width: "15%" },
] as const;

const SHEET_ROWS = [
  ["Claude", "Claude Team", "38", "36", "34", "1750.00", "2026-12-03"],
  ["Cursor", "Cursor Teams", "24", "24", "15", "960.00", "2026-12-14"],
] as const;

const SHEET_NOTE = "24 paid, 15 using. Decide by 14 Dec.";

function CostSheet() {
  const letters = "ABCDEFG".split("");
  // On a phone columns B and D are hidden, as a spreadsheet hides them, so the marked cell stays in view.
  const narrow = (index: number) => ("wide" in SHEET_COLUMNS[index] ? "max-sm:hidden" : undefined);
  const cell = "h-[26px] overflow-hidden border border-[#e1e3dd] px-[7px] py-1 align-bottom";
  const rowHead = "border border-[#e1e3dd] bg-[#f1f2ee] text-center text-[11.5px] font-normal text-[#6b6d66]";
  return (
    <div className="overflow-x-auto pb-1 xl:overflow-visible xl:pb-7">
      <div className="relative min-w-[440px] sm:min-w-[620px]">
        <figure
          aria-label="cost.csv from the Cost page, opened in a spreadsheet"
          className="border border-[#c9cbc3] bg-white font-[Arial,Helvetica,sans-serif] text-[13px] leading-[1.3] text-[#1f1f1f]"
        >
          <div className="flex items-center gap-2 border-b border-[#d7d9d2] bg-[#f6f6f2] px-2 py-1.5 text-xs">
            <span className="min-w-[46px] border border-[#d7d9d2] bg-white px-2 py-0.5 text-center text-[#5b5d56]">E3</span>
            <span className="flex-1 border border-[#d7d9d2] bg-white px-2 py-0.5">15</span>
          </div>
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={rowHead} style={{ width: "4.8%" }}>
                  <span className="sr-only">Row</span>
                </th>
                {letters.map((letter, index) => (
                  <th key={letter} className={cn(rowHead, "h-6", narrow(index))} style={{ width: SHEET_COLUMNS[index].width }}>
                    {letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className={rowHead}>1</th>
                {SHEET_COLUMNS.map((column, index) => (
                  <td key={column.head} className={cn(cell, "font-bold", narrow(index))}>
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
                        narrow(index),
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
                  {SHEET_COLUMNS.map((column, index) =>
                    n === 4 && index === 4 ? (
                      // Below lg the note sits in the empty row under E3, its arrow pointing up at the cell.
                      <td key={column.head} className={cn(cell, "relative overflow-visible")}>
                        <span
                          aria-hidden
                          className="home-note home-note-pin lg:!hidden"
                          style={{
                            position: "absolute",
                            left: -34,
                            top: 27,
                            zIndex: 3,
                            width: 172,
                            maxWidth: "none",
                            padding: "6px 10px 7px",
                            fontFamily: "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif",
                            fontSize: 13.5,
                          }}
                        >
                          <svg viewBox="0 0 26 30" style={{ left: 58 }} aria-hidden>
                            <path d="M9 29C6 20 8 11 16 4" />
                            <path d="M8 6l8-3 2 9" />
                          </svg>
                          {SHEET_NOTE}
                        </span>
                      </td>
                    ) : (
                      <td key={column.head} className={cn(cell, narrow(index))} />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex border-t border-[#d7d9d2] bg-[#f6f6f2] text-xs">
            <span className="border-b-2 border-r border-[#d7d9d2] !border-b-primary bg-white px-4 pb-[5px] pt-1.5 font-bold">cost</span>
          </div>
        </figure>
        <Notes>
          <Note
            style={{ right: -16, top: "100%", marginTop: -26, transform: "rotate(1.5deg)" }}
            arrow={{
              viewBox: "0 0 56 44",
              box: { left: 6, top: -58, width: 56, height: 60 },
              paths: ["M50 40C46 22 30 10 8 8", "M22 2L6 8l11 14"],
            }}
          >
            {SHEET_NOTE}
          </Note>
        </Notes>
      </div>
    </div>
  );
}

export function HomeRoles() {
  return (
    <section
      aria-labelledby="home-roles-heading"
      className="mt-24 overflow-x-clip border-y border-border bg-[#fafaf7] pb-16 pt-16 sm:mt-32 lg:mt-[9.5rem] lg:pb-28 lg:pt-[7.5rem]"
    >
      <div className="mx-auto w-full max-w-[75rem] px-4 sm:px-6">
        <h2 id="home-roles-heading" className="text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-[#3a3b37] sm:text-[1.95rem]">
          Someone is going to ask you.
        </h2>
        <div className="mt-8 border-t-2 !border-foreground lg:mt-14">
          <Role who="Engineering manager" answer="Priya needs Premium. Elena barely uses hers.">
            <PeopleCard />
          </Role>
          <Role who="Project manager" answer="The billing rewrite has $1,819 in it and isn’t moving." flip>
            <BoardCard />
          </Role>
          {/* The one full-width row, set larger: the section turns on it. */}
          <div data-role="Leadership" className="py-10 lg:py-14 xl:py-20">
            <RoleLabel who="Leadership" />
            <h3 className="mt-3.5 text-[1.3rem] font-semibold leading-snug tracking-[-0.02em] [text-wrap:balance] sm:text-2xl lg:mt-4 lg:text-[2.75rem] lg:leading-[1.08] lg:tracking-[-0.03em] xl:text-[3.25rem]">
              We’re on pace for $42,540 this month.
            </h3>
            <LeadershipAnswers />
          </div>
          <Role who="Finance" answer="Two renewals in December: $1,750 and $960.">
            <CostSheet />
          </Role>
          <Role who="Developer" answer="I can see what it holds about me." flip>
            <MyDataCard />
          </Role>
        </div>
        <p className="mt-2 text-[0.8125rem] leading-6 text-muted-foreground lg:mt-0">
          The pictures use an example team’s numbers. The app lays some of them out differently.
        </p>
      </div>
    </section>
  );
}
