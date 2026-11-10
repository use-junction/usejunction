"use client";

import { useReducedMotion } from "framer-motion";
import { Check, Eye } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { HOME_H2, HOME_SECTION, Muted, ResultNote } from "@/components/public/home-bits";
import { cn } from "@/lib/utils";

/** Example data only. Kept in one place so the panels stay consistent with each other. */
const SEAT_ROWS = [
  { tool: "Cursor", plan: "Teams", logo: "cursor.svg", seats: 18, inUse: 14, idleCost: "$120" },
  { tool: "Claude", plan: "Team", logo: "claude.svg", seats: 12, inUse: 12, idleCost: "$0" },
  { tool: "GitHub Copilot", plan: "Business", logo: "copilot.svg", seats: 12, inUse: 9, idleCost: "$57" },
] as const;

const LIMIT_ROWS = [
  { person: "Marco D.", seat: "Premium", used: 9, verdict: "move" },
  { person: "Jules P.", seat: "Premium", used: 11, verdict: "move" },
  { person: "Hana S.", seat: "Premium", used: 14, verdict: "move" },
  { person: "Aiko T.", seat: "Standard", used: 96, verdict: "near" },
  { person: "Ben W.", seat: "Standard", used: 48, verdict: "fits" },
] as const;

const LOOK_ROWS = [
  { kind: "Spend spike", who: "Lena K.", what: "used three times her usual week on Codex.", when: "Tue" },
  { kind: "Personal API key", who: "Tom R.", what: "is running Claude Code on a personal key, not the company one.", when: "Mon" },
  { kind: "Machine went quiet", who: "build-mac-02", what: "has not reported for 9 days.", when: "1 Nov" },
] as const;

const workflows = [
  {
    id: "seats",
    label: "Which seats are idle?",
    title: "Every seat you pay for, next to whether anyone used it this cycle.",
  },
  {
    id: "spend",
    label: "Who is on the wrong plan?",
    title: "Premium seats that barely touch their limit, and Standard seats that run into it.",
  },
  {
    id: "signals",
    label: "What needs a look this week?",
    title: "Spend spikes, personal API keys, and machines that stopped reporting.",
  },
] as const;

type WorkflowId = (typeof workflows)[number]["id"];

function Bar({ percent, hot = false }: { percent: number; hot?: boolean }) {
  return (
    <span className="block h-1.5 w-full bg-[#ecede8]" aria-hidden>
      <span className={cn("block h-full", hot ? "bg-[var(--public-warning)]" : "bg-primary")} style={{ width: `${percent}%` }} />
    </span>
  );
}

function Chip({ verdict }: { verdict: "move" | "near" | "fits" }) {
  if (verdict === "fits") return <span className="text-sm text-muted-foreground">Fits</span>;
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border px-2 py-1 text-xs font-semibold leading-tight",
        verdict === "move"
          ? "border-[#b9dce3] bg-primary-pale text-primary-dark"
          : "border-[var(--public-warning-border)] bg-white text-[#7a4d00]",
      )}
    >
      {verdict === "move" ? "Move to Standard" : "Close to limit"}
    </span>
  );
}

function PanelFrame({
  title,
  meta,
  foot,
  children,
}: {
  title: string;
  meta: string;
  foot: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-white text-sm leading-snug">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-5 sm:px-7">
        <h3 className="text-base font-semibold tracking-[-0.01em]">{title}</h3>
        <span className="text-[0.8125rem] text-muted-foreground">{meta}</span>
      </div>
      <ul>{children}</ul>
      <p className="bg-[var(--public-bg)] px-5 py-5 text-[0.8125rem] text-[#5c5e56] sm:px-7">{foot}</p>
    </div>
  );
}

function SeatsPanel() {
  return (
    <PanelFrame
      title="Seats this cycle"
      meta={`${SEAT_ROWS.reduce((s, r) => s + r.seats, 0)} seats, ${SEAT_ROWS.reduce((s, r) => s + r.inUse, 0)} in use`}
      foot="Example data."
    >
      {SEAT_ROWS.map((row) => (
        <li
          key={row.tool}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2.5 border-b border-border px-5 py-5 sm:grid-cols-[11rem_minmax(0,1fr)_8rem] sm:px-7"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Image src={`/tool-logos/${row.logo}`} alt="" width={22} height={22} className="shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">{row.tool}</p>
              <p className="text-[0.8125rem] text-muted-foreground">
                {row.plan}, {row.seats} seats
              </p>
            </div>
          </div>
          <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
            <span className="flex h-2 gap-0.5" aria-hidden>
              <span className="bg-primary" style={{ flex: row.inUse }} />
              {row.seats > row.inUse ? (
                <span className="bg-[var(--public-warning)]" style={{ flex: row.seats - row.inUse }} />
              ) : null}
            </span>
            <span className="mt-1.5 block text-[0.8125rem] text-[#5c5e56]">
              {row.inUse} of {row.seats} in use
            </span>
          </div>
          <div className="col-start-2 row-start-1 text-right sm:col-start-auto sm:row-start-auto">
            <p className="font-semibold tabular-nums">{row.idleCost}</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {row.seats > row.inUse ? `${row.seats - row.inUse} idle, per month` : "none idle"}
            </p>
          </div>
        </li>
      ))}
    </PanelFrame>
  );
}

function LimitsPanel() {
  return (
    <PanelFrame
      title="Claude Team, weekly limit used"
      meta="12 seats"
      foot="Example data."
    >
      {LIMIT_ROWS.map((row) => (
        <li
          key={row.person}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2.5 border-b border-border px-5 py-5 sm:grid-cols-[9rem_minmax(0,1fr)_9.5rem] sm:px-7"
        >
          <div>
            <p className="font-semibold">{row.person}</p>
            <p className="text-[0.8125rem] text-muted-foreground">{row.seat}</p>
          </div>
          <div className="col-span-2 row-start-2 flex items-center gap-3 sm:col-span-1 sm:row-start-auto">
            <Bar percent={row.used} hot={row.used >= 90} />
            <span className="w-10 shrink-0 text-right font-semibold tabular-nums">{row.used}%</span>
          </div>
          <div className="col-start-2 row-start-1 text-right sm:col-start-auto sm:row-start-auto">
            <Chip verdict={row.verdict} />
          </div>
        </li>
      ))}
    </PanelFrame>
  );
}

function LookPanel() {
  return (
    <PanelFrame
      title="Needs a look"
      meta={`${LOOK_ROWS.length} this week`}
      foot="Example data."
    >
      {LOOK_ROWS.map((row) => (
        <li
          key={row.kind}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 border-b border-border px-5 py-5 sm:grid-cols-[9.5rem_minmax(0,1fr)_4rem] sm:px-7"
        >
          <p className="text-[0.8125rem] font-semibold">{row.kind}</p>
          <p className="col-span-2 row-start-2 text-[0.9375rem] text-[#5c5e56] sm:col-span-1 sm:row-start-auto">
            <span className="font-semibold text-foreground">{row.who}</span> {row.what}
          </p>
          <p className="col-start-2 row-start-1 text-right text-[0.8125rem] text-muted-foreground sm:col-start-auto sm:row-start-auto">
            {row.when}
          </p>
        </li>
      ))}
    </PanelFrame>
  );
}

const PANELS: Record<WorkflowId, { Panel: () => React.ReactNode; note: { icon: React.ReactNode; title: string; detail: string } }> = {
  seats: {
    Panel: SeatsPanel,
    note: { icon: <Check />, title: "7 idle seats, $177 a month", detail: "Both plans renew in the next 23 days" },
  },
  spend: {
    Panel: LimitsPanel,
    note: { icon: <Check />, title: "3 Premium seats barely used", detail: "1 Standard seat is close to its limit" },
  },
  signals: {
    Panel: LookPanel,
    note: { icon: <Eye />, title: "3 things this week", detail: "Each one has a name on it" },
  },
};

/** How long each tab stays up before the next one, unless the reader is hovering or focused inside. */
const ADVANCE_MS = 7000;

export function HomeProductStory() {
  const [activeId, setActiveId] = useState<WorkflowId>("seats");
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion() === true;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = workflows.findIndex((workflow) => workflow.id === activeId);
  const { Panel, note } = PANELS[activeId];

  function selectAndFocus(index: number) {
    const nextIndex = (index + workflows.length) % workflows.length;
    setActiveId(workflows[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: workflows.length - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      selectAndFocus(keys[event.key]);
    }
  }

  return (
    <section id="product" aria-labelledby="home-product-heading" className={cn("scroll-mt-20", HOME_SECTION)}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div
          className="grid gap-10 border border-border bg-[var(--public-bg)] px-4 py-8 sm:p-10 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-16 lg:p-16"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
          }}
        >
          <div className="flex flex-col justify-between gap-10 lg:gap-14">
            <h2 id="home-product-heading" className={cn(HOME_H2, "lg:text-[2.15rem]")}>
              Three things to check <Muted>before you renew.</Muted>
            </h2>
            <div role="tablist" aria-label="Product workflows" aria-orientation="vertical" className="grid gap-1">
              {workflows.map((workflow, index) => {
                const selected = workflow.id === activeId;
                return (
                  <button
                    key={workflow.id}
                    ref={(element) => {
                      tabRefs.current[index] = element;
                    }}
                    id={`home-product-tab-${workflow.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="home-product-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveId(workflow.id)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                    className={cn(
                      "relative block w-full border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5",
                      selected ? "border-border bg-white text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className={cn("block text-base tracking-[-0.01em] sm:text-[1.0625rem]", selected ? "font-semibold" : "font-medium")}>
                      {workflow.label}
                    </span>
                    {selected ? (
                      <span className="mt-2 block text-sm leading-6 text-muted-foreground">{workflow.title}</span>
                    ) : null}
                    {selected && !reduceMotion ? (
                      <span
                        key={`${workflow.id}-${activeIndex}`}
                        aria-hidden
                        data-testid="home-product-progress"
                        className="absolute -bottom-px -left-px h-0.5 w-[calc(100%+2px)] origin-left bg-primary animate-[home-tab-progress_linear_both]"
                        style={{ animationDuration: `${ADVANCE_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                        onAnimationEnd={() => setActiveId(workflows[(index + 1) % workflows.length].id)}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            id="home-product-panel"
            role="tabpanel"
            aria-labelledby={`home-product-tab-${activeId}`}
            tabIndex={0}
            className="relative min-w-0 self-center pb-8 pr-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pr-6"
          >
            <div className="shadow-[0_30px_60px_-44px_rgba(17,18,16,0.4)]">
              <Panel />
            </div>
            <ResultNote icon={note.icon} title={note.title} detail={note.detail} className="bottom-0 right-2 sm:right-0" />
          </div>
        </div>
      </div>
    </section>
  );
}
