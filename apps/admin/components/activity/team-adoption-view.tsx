"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/panel";
import { SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { formatMicrosAsCurrency, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toolDisplayName } from "@/lib/tools/catalog";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import type { AdoptionBand, AdoptionCell, AdoptionPerson, TeamAdoption } from "@/lib/queries/activity/adoption";

const BANDS: Array<{ key: AdoptionBand; label: string; hint: string; color: string; hatched?: boolean }> = [
  { key: "regular", label: "Regular", hint: "Used AI in most weeks", color: "var(--primary)" },
  { key: "occasional", label: "Occasional", hint: "Used AI in some weeks", color: "color-mix(in srgb, var(--primary) 45%, transparent)" },
  { key: "not_started", label: "Not using yet", hint: "Reporting, but no AI-tool days this period", color: "var(--border)" },
  { key: "no_data", label: "No data", hint: "Agent has not reported this period, so we can't tell", color: "var(--muted-foreground)", hatched: true },
];

const HATCH = (color: string): CSSProperties => ({
  backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1.5px, transparent 1.5px 4px)`,
});

const PREVIOUS_RANK = { inactive: 0, occasional: 1, regular: 2 } as const;
const BAND_RANK: Record<AdoptionBand, number | null> = { not_started: 0, occasional: 1, regular: 2, no_data: null };

function ToolName({ tool, size = 14, className }: { tool: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <ToolBrandIcon tool={tool} size={size} />
      <span className="truncate">{toolDisplayName(tool)}</span>
    </span>
  );
}

function ToolNames({ tools }: { tools: string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {tools.map((tool) => <ToolName key={tool} tool={tool} size={12} />)}
    </span>
  );
}

function weekLabel(start: string) {
  return new Date(`${start}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function bandChange(person: AdoptionPerson): { direction: "up" | "down"; text: string } | null {
  const now = BAND_RANK[person.band];
  if (now === null || person.previousBand === null) return null;
  const before = PREVIOUS_RANK[person.previousBand];
  if (now === before) return null;
  const from = person.previousBand === "inactive" ? "not using" : person.previousBand;
  return { direction: now > before ? "up" : "down", text: `${now > before ? "Up" : "Down"} from ${from}` };
}

function Delta({ now, before }: { now: number; before: number }) {
  const diff = now - before;
  if (diff === 0) return <span>Same as previous period</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {diff > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
      {diff > 0 ? "+" : "−"}{Math.abs(diff)} vs previous period
    </span>
  );
}

function rangeLabel(from: string, to: string) {
  const format = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

function AdoptionSummary({ data, periodLabel }: { data: TeamAdoption; periodLabel: string }) {
  const { counts, idleSeats } = data;
  const nudges = counts.notStarted + counts.noData + data.notEnrolled.length;
  return (
    <section aria-label="Adoption summary" className="mb-10 space-y-3">
      <p className="text-sm text-muted-foreground">{rangeLabel(data.from, data.to)} · {periodLabel}, up to today</p>
      <div className="grid gap-y-8 border-y border-border/60 py-2 sm:grid-cols-3">
        <SignalsKpi
          label="Tried it this period"
          hero
          className="pl-5"
          value={<span className="tabular-nums">{counts.active}<span className="text-muted-foreground"> of {counts.enrolled}</span></span>}
          sub={<Delta now={counts.active} before={counts.previousActive} />}
        />
        <SignalsKpi
          label="Need a nudge"
          className="sm:border-l sm:border-border sm:pl-8"
          value={nudges}
          sub={nudges ? "not started, lapsed, or not reporting" : "everyone is set up"}
        />
        <SignalsKpi
          label="Paid seats not used"
          className="sm:border-l sm:border-border sm:pl-8"
          value={idleSeats.count ? formatMicrosAsCurrency(idleSeats.cycleMicros) : "None"}
          sub={idleSeats.count ? (
            <span className="block space-y-1">
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-foreground/80">
                {idleSeats.tools.map((tool) => (
                  <span key={tool.toolName} className="inline-flex items-center gap-1">
                    <ToolName tool={tool.toolName} size={13} />
                    {idleSeats.tools.length > 1 || tool.count > 1 ? (
                      <span className="tabular-nums text-muted-foreground">{formatMicrosAsCurrency(tool.cycleMicros)}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
                    ) : null}
                  </span>
                ))}
              </span>
              <span className="block">per cycle · <Link href="/tools" className="underline underline-offset-4">Review in Tools</Link></span>
            </span>
          ) : "every paid seat saw use"}
        />
      </div>
    </section>
  );
}

const CELL_LABEL: Record<AdoptionCell, string> = {
  active: "used AI",
  inactive: "no AI use",
  before: "not enrolled yet",
  no_data: "no data",
};

function Cell({ cell, title }: { cell: AdoptionCell; title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className={cn(
        "block size-5 shrink-0",
        cell === "active" && "bg-primary",
        cell === "inactive" && "border border-border bg-background",
        cell === "before" && "border border-dashed border-border/70",
      )}
      style={cell === "no_data" ? HATCH("var(--muted-foreground)") : undefined}
    />
  );
}

function SeatTags({ seats }: { seats: Array<{ toolName: string; used: boolean }> }) {
  const unused = seats.filter((seat) => !seat.used);
  if (!unused.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {unused.map((seat) => (
        <span key={seat.toolName} className="inline-flex items-center gap-1 border border-border px-1.5 py-px text-[11px] text-muted-foreground">
          <ToolBrandIcon tool={seat.toolName} size={11} />
          {toolDisplayName(seat.toolName)} seat unused
        </span>
      ))}
    </span>
  );
}

const DAILY_MAX_DAYS = 42;

function eachDay(from: string, to: string) {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function isWeekend(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** One square per day (short periods) or per week (long periods), grouped by week. */
function ActivityStrip({ person, data }: { person: AdoptionPerson; data: TeamAdoption }) {
  const daily = eachDay(data.from, data.to).length <= DAILY_MAX_DAYS;
  if (!daily) {
    return (
      <span className="flex gap-1">
        {person.weeks.map((cell, index) => (
          <Cell key={data.weeks[index]!.start} cell={cell} title={`Week of ${weekLabel(data.weeks[index]!.start)}: ${CELL_LABEL[cell]}`} />
        ))}
      </span>
    );
  }
  const active = new Set(person.activeDates);
  return (
    <span className="flex gap-1.5">
      {data.weeks.map((week) => (
        <span key={week.start} className="flex gap-[2px]">
          {eachDay(week.start, week.end).map((day) => {
            const cell: AdoptionCell = day < person.enrolledAt ? "before" : person.band === "no_data" ? "no_data" : active.has(day) ? "active" : "inactive";
            return (
              <span
                key={day}
                role="img"
                aria-label={`${dayLabel(day)}: ${CELL_LABEL[cell]}`}
                title={`${dayLabel(day)}: ${CELL_LABEL[cell]}`}
                className={cn(
                  "block h-4 w-2.5",
                  cell === "active" && "bg-primary",
                  cell === "inactive" && (isWeekend(day) ? "bg-muted/40" : "bg-muted"),
                  cell === "before" && "border border-dashed border-border/70",
                )}
                style={cell === "no_data" ? HATCH("var(--muted-foreground)") : undefined}
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}

function HabitChip({ band }: { band: AdoptionBand }) {
  const meta = BANDS.find((row) => row.key === band)!;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="size-2 shrink-0" style={meta.hatched ? HATCH(meta.color) : { background: meta.color }} aria-hidden />
      {meta.label}
    </span>
  );
}

function UnusedSeats({ seats }: { seats: Array<{ toolName: string; used: boolean }> }) {
  const unused = seats.filter((seat) => !seat.used);
  if (!unused.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
      {unused.map((seat) => <ToolName key={seat.toolName} tool={seat.toolName} size={12} />)}
    </span>
  );
}

const ROSTER_COLUMNS = "grid-cols-[minmax(10rem,1.2fr)_minmax(0,2.4fr)_minmax(8rem,1fr)_minmax(7rem,0.9fr)]";

function RosterRow({ person, data }: { person: AdoptionPerson; data: TeamAdoption }) {
  const change = bandChange(person);
  const eligibleWeeks = person.weeks.filter((cell) => cell !== "before").length;
  const activeWeeks = person.weeks.filter((cell) => cell === "active").length;
  return (
    <li className={cn("grid items-center gap-x-6 gap-y-2 border-t border-border/60 py-3", ROSTER_COLUMNS)}>
      <span className="min-w-0">
        <Link href={`/team/${encodeURIComponent(person.id)}`} className="block truncate text-sm font-medium hover:underline">{person.name}</Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground">
          <HabitChip band={person.band} />
          {change ? (
            <span className={cn("inline-flex items-center gap-0.5 text-[11px]", change.direction === "down" && "text-foreground")}>
              {change.direction === "up" ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
              {change.text}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <ActivityStrip person={person} data={data} />
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {person.band === "no_data"
            ? `Agent not reporting · last seen ${formatRelativeTime(person.lastSeenAt)}`
            : `${person.activeDays} active ${person.activeDays === 1 ? "day" : "days"} · ${activeWeeks} of ${eligibleWeeks} weeks`}
        </span>
      </span>
      <span className="min-w-0 text-xs">
        {person.tools.length ? <ToolNames tools={person.tools} /> : <span className="text-muted-foreground">—</span>}
      </span>
      <UnusedSeats seats={person.band === "no_data" ? [] : person.seats} />
    </li>
  );
}

function PeopleGrid({ data }: { data: TeamAdoption }) {
  const [band, setBand] = useState<AdoptionBand | "all">("all");
  const order = new Map(BANDS.map((row, index) => [row.key, index]));
  const people = data.people
    .filter((person) => band === "all" || person.band === band)
    .sort((a, b) => order.get(a.band)! - order.get(b.band)! || a.name.localeCompare(b.name));
  const options = [{ key: "all" as const, label: "Everyone", count: data.people.length }, ...BANDS.map((row) => ({
    key: row.key, label: row.label, count: data.people.filter((person) => person.band === row.key).length,
  }))];
  const daily = eachDay(data.from, data.to).length <= DAILY_MAX_DAYS;

  return (
    <Panel as="section" className="mb-10">
      <SignalsSectionHeader
        title="Who uses AI, day by day."
        description={`Each square is ${daily ? "a day" : "a week"}; filled means any AI tool was used. Grouped by habit, alphabetical — no volume, no ranking.`}
        bordered={false}
      />
      <div role="radiogroup" aria-label="Filter by habit" className="mb-4 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={band === option.key}
            onClick={() => setBand(option.key)}
            className={cn(
              "border px-2.5 py-1 text-xs tabular-nums",
              band === option.key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label} {option.count}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[44rem]">
          <div className={cn("grid gap-x-6 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground", ROSTER_COLUMNS)}>
            <span>Person</span>
            <span>{daily ? "Daily" : "Weekly"} activity · {rangeLabel(data.from, data.to)}</span>
            <span>Tools used</span>
            <span>Unused paid seats</span>
          </div>
          {people.length ? (
            <ul>{people.map((person) => <RosterRow key={person.id} person={person} data={data} />)}</ul>
          ) : (
            <p className="border-t border-border/60 py-6 text-sm text-muted-foreground">No one in this group.</p>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        A day counts when any enrolled machine reports AI-tool use for that person. Weekends are lighter; dashed squares are before they enrolled; striped means the agent wasn&apos;t reporting.
      </p>
    </Panel>
  );
}

function ToolSpread({ data }: { data: TeamAdoption }) {
  const enrolled = Math.max(1, data.counts.enrolled);
  return (
    <Panel as="section">
      <SignalsSectionHeader title="Spread by tool." description="How many people used each tool, against the previous period." bordered={false} />
      {data.tools.length ? (
        <ul className="divide-y divide-border/60">
          {data.tools.map((tool) => {
            const diff = tool.people - tool.previousPeople;
            return (
              <li key={tool.toolName} className="py-3">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <ToolName tool={tool.toolName} size={18} className="gap-2 font-medium" />
                  <span className="tabular-nums">
                    {tool.people} {tool.people === 1 ? "person" : "people"}
                    <span className={cn("ml-2 text-xs", diff === 0 ? "text-muted-foreground" : "text-foreground")}>
                      {diff === 0 ? "no change" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full bg-muted" aria-hidden>
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (tool.people / enrolled) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">No AI-tool use reported yet.</p>
      )}
    </Panel>
  );
}

type Nudge = { id: string; name: string; reason: string; detail?: string; action: ReactNode; seats: Array<{ toolName: string; used: boolean }> };

function nudgesFor(data: TeamAdoption): Nudge[] {
  const rows: Nudge[] = [];
  for (const person of data.people) {
    const open = <Link href={`/team/${encodeURIComponent(person.id)}`} className="inline-flex items-center gap-0.5 hover:underline">Open <ArrowRight className="size-3" aria-hidden /></Link>;
    if (person.band === "no_data") {
      rows.push({ id: person.id, name: person.name, reason: "Agent not reporting", detail: `last seen ${formatRelativeTime(person.lastSeenAt)}`, action: <Link href="/team" className="inline-flex items-center gap-0.5 hover:underline">Check device <ArrowRight className="size-3" aria-hidden /></Link>, seats: person.seats });
    } else if (person.band === "not_started") {
      const lapsed = person.previousBand === "regular" || person.previousBand === "occasional";
      rows.push({ id: person.id, name: person.name, reason: lapsed ? "Stopped using AI" : "Hasn't started", detail: lapsed ? `was ${person.previousBand} last period` : undefined, action: open, seats: person.seats });
    }
  }
  for (const person of data.notEnrolled) {
    rows.push({ id: person.id, name: person.name, reason: "No machine enrolled", action: <Link href="/team" className="inline-flex items-center gap-0.5 hover:underline">Send setup <ArrowRight className="size-3" aria-hidden /></Link>, seats: person.seats });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function NudgeList({ data }: { data: TeamAdoption }) {
  const rows = nudgesFor(data);
  return (
    <Panel as="section">
      <SignalsSectionHeader title="Needs a nudge." description="An onboarding to-do list, not a scorecard. Alphabetical." bordered={false} />
      {rows.length ? (
        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-3">
              <span className="min-w-0 space-y-1">
                <span className="block truncate text-sm font-medium">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.reason}{row.detail ? ` · ${row.detail}` : ""}
                </span>
                <SeatTags seats={row.seats} />
              </span>
              <span className="shrink-0 text-xs">{row.action}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">Everyone enrolled is using AI and reporting. Nothing to chase.</p>
      )}
    </Panel>
  );
}

export function TeamAdoptionView({
  data, periodLabel, children,
}: {
  data: TeamAdoption;
  periodLabel: string;
  /** Collection diagnostics, rendered folded at the bottom. */
  children?: ReactNode;
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  useEffect(() => {
    // Report links land on #reports; open the fold so the anchor is visible.
    if (window.location.hash === "#reports") setDiagnosticsOpen(true);
  }, []);
  return (
    <>
      <AdoptionSummary data={data} periodLabel={periodLabel} />
      <PeopleGrid data={data} />
      <div className="grid gap-6 lg:grid-cols-2">
        <NudgeList data={data} />
        <ToolSpread data={data} />
      </div>
      {children ? (
        <details
          className="group mt-10 border-t border-border/60 pt-4"
          open={diagnosticsOpen}
          onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none text-sm font-semibold marker:hidden">
            <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
            Collection health and sent reports
          </summary>
          <div className="mt-6">{children}</div>
        </details>
      ) : null}
    </>
  );
}
