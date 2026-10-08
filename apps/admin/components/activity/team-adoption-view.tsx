"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/panel";
import { Ghost } from "@/components/empty-states/ghost";
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

function toolHref(tool: string) {
  return `/tools/${encodeURIComponent(tool)}`;
}

function ToolName({ tool, size = 14, className, linked = false }: { tool: string; size?: number; className?: string; linked?: boolean }) {
  const content = (
    <>
      <ToolBrandIcon tool={tool} size={size} />
      <span className="truncate">{toolDisplayName(tool)}</span>
    </>
  );
  return linked ? (
    <Link href={toolHref(tool)} className={cn("inline-flex min-w-0 items-center gap-1 underline-offset-4 hover:underline", className)}>{content}</Link>
  ) : (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>{content}</span>
  );
}

function ToolNames({ tools }: { tools: string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {tools.map((tool) => <ToolName key={tool} tool={tool} size={12} linked />)}
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

/** Assigned-but-idle plus unassigned seats, per tool, so this matches the Cost page. */
function paidSeatsNotUsed(data: TeamAdoption) {
  const unassigned = data.unassignedSeats ?? { count: 0, monthlyMicros: "0", tools: [] };
  const byTool = new Map<string, { toolName: string; count: number; micros: bigint }>();
  for (const tool of [...data.idleSeats.tools, ...unassigned.tools]) {
    const entry = byTool.get(tool.toolName) ?? { toolName: tool.toolName, count: 0, micros: 0n };
    entry.count += tool.count;
    entry.micros += BigInt(tool.monthlyMicros);
    byTool.set(tool.toolName, entry);
  }
  return {
    assigned: data.idleSeats.count,
    unassigned: unassigned.count,
    count: data.idleSeats.count + unassigned.count,
    micros: BigInt(data.idleSeats.monthlyMicros) + BigInt(unassigned.monthlyMicros),
    tools: [...byTool.values()].sort((a, b) => (b.micros > a.micros ? 1 : b.micros < a.micros ? -1 : a.toolName.localeCompare(b.toolName))),
  };
}

function AdoptionSummary({ data }: { data: TeamAdoption }) {
  const { counts } = data;
  const idle = paidSeatsNotUsed(data);
  const nudges = counts.notStarted + counts.noData + data.notEnrolled.length;
  return (
    <section aria-label="Adoption summary" className="mb-10">
      <div className="grid gap-y-8 py-2 sm:grid-cols-3">
        <SignalsKpi
          label="Tried it this period"
          hero
          className="pl-5"
          value={<span className="tabular-nums">{counts.active}<span className="text-muted-foreground"> of {counts.enrolled}</span></span>}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>
                {counts.enrolled === 1 ? "person" : "people"} with a connected machine
                {data.notEnrolled.length ? ` · ${data.notEnrolled.length} more on the roster without one` : ""}
              </span>
              <Delta now={counts.active} before={counts.previousActive} />
            </span>
          }
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
          value={idle.count ? (
            <span className="tabular-nums">
              {formatMicrosAsCurrency(idle.micros)}
              <span className="ml-1 text-base font-normal text-muted-foreground">/ mo</span>
            </span>
          ) : "None"}
          sub={idle.count ? (
            <span className="flex flex-col gap-1">
              <span>
                {[
                  idle.assigned ? `${plural(idle.assigned, "assigned seat")} unused` : null,
                  idle.unassigned ? `${plural(idle.unassigned, "seat")} assigned to no one` : null,
                ].filter(Boolean).join(" · ")}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {idle.tools.map((tool) => (
                  <span key={tool.toolName} className="inline-flex items-center gap-1 text-foreground/80">
                    <ToolName tool={tool.toolName} size={13} linked />
                    {idle.tools.length > 1 || tool.count > 1 ? (
                      <span className="tabular-nums text-muted-foreground">{formatMicrosAsCurrency(tool.micros)}{tool.count > 1 ? ` ×${tool.count}` : ""}</span>
                    ) : null}
                  </span>
                ))}
                <Link href="/tools" className="inline-flex items-center gap-0.5 hover:underline">Review in Cost <ArrowRight className="size-3" aria-hidden /></Link>
              </span>
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

function StripLegend({ data, daily }: { data: TeamAdoption; daily: boolean }) {
  const items: Array<{ cell: AdoptionCell; label: string }> = [
    { cell: "active", label: "Used AI" },
    { cell: "inactive", label: "No use" },
  ];
  if (data.people.some((person) => person.enrolledAt > data.from)) items.push({ cell: "before", label: "Before enrolling" });
  if (data.people.some((person) => person.band === "no_data")) items.push({ cell: "no_data", label: "Agent not reporting" });
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((item) => (
        <li key={item.cell} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              daily ? "h-3 w-2" : "size-3",
              item.cell === "active" && "bg-primary",
              item.cell === "inactive" && (daily ? "bg-muted" : "border border-border bg-background"),
              item.cell === "before" && "border border-dashed border-border/70",
            )}
            style={item.cell === "no_data" ? HATCH("var(--muted-foreground)") : undefined}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function PeopleGrid({ data }: { data: TeamAdoption }) {
  const [band, setBand] = useState<AdoptionBand | "all">("all");
  const order = new Map(BANDS.map((row, index) => [row.key, index]));
  const people = data.people
    .filter((person) => band === "all" || person.band === band)
    .sort((a, b) => order.get(a.band)! - order.get(b.band)! || a.name.localeCompare(b.name));
  const bands = BANDS.map((row) => ({
    key: row.key, label: row.label, count: data.people.filter((person) => person.band === row.key).length,
  })).filter((row) => row.count > 0);
  const options = [{ key: "all" as const, label: "Everyone", count: data.people.length }, ...bands];
  const daily = eachDay(data.from, data.to).length <= DAILY_MAX_DAYS;

  return (
    <Panel as="section" className="mb-10">
      <SignalsSectionHeader title={daily ? "Who uses AI, day by day." : "Who uses AI, week by week."} bordered={false} />
      {bands.length > 1 ? (
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
      ) : null}
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
      <StripLegend data={data} daily={daily} />
    </Panel>
  );
}

function ToolSpread({ data }: { data: TeamAdoption }) {
  const enrolled = Math.max(1, data.counts.enrolled);
  return (
    <Panel as="section">
      <SignalsSectionHeader title="Spread by tool." bordered={false} />
      {data.tools.length ? (
        <ul className="divide-y divide-border/60">
          {data.tools.map((tool) => {
            const diff = tool.people - tool.previousPeople;
            return (
              <li key={tool.toolName}>
                <Link
                  href={toolHref(tool.toolName)}
                  aria-label={`${toolDisplayName(tool.toolName)} usage · ${tool.people} ${tool.people === 1 ? "person" : "people"}`}
                  className="group -mx-2 block px-2 py-3 hover:bg-muted/40 focus-visible:outline focus-visible:outline-ring"
                >
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <ToolName tool={tool.toolName} size={18} className="gap-2 font-medium group-hover:underline group-hover:underline-offset-4" />
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {tool.people} {tool.people === 1 ? "person" : "people"}
                      {diff !== 0 ? (
                        <span className="text-xs" title="vs previous period">{`${diff > 0 ? "+" : "−"}${Math.abs(diff)}`}</span>
                      ) : null}
                      <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-muted" aria-hidden>
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (tool.people / enrolled) * 100)}%` }} />
                  </div>
                </Link>
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

function NudgeList({ rows }: { rows: Nudge[] }) {
  return (
    <Panel as="section">
      <SignalsSectionHeader title="Needs a nudge." bordered={false} />
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
    </Panel>
  );
}

export function TeamAdoptionView({
  data, sample, children,
}: {
  data: TeamAdoption;
  /** Sample team drawn faded into the activity and tool panels while nobody has a connected machine. */
  sample?: TeamAdoption;
  /** Collection diagnostics, rendered folded at the bottom. */
  children?: ReactNode;
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const nudges = nudgesFor(data);
  return (
    <>
      <AdoptionSummary data={data} />
      {sample ? <Ghost><PeopleGrid data={sample} /></Ghost> : <PeopleGrid data={data} />}
      {nudges.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <NudgeList rows={nudges} />
          {sample ? <Ghost><ToolSpread data={sample} /></Ghost> : <ToolSpread data={data} />}
        </div>
      ) : sample ? (
        <Ghost><ToolSpread data={sample} /></Ghost>
      ) : (
        <ToolSpread data={data} />
      )}
      {children ? (
        <details
          className="group mt-10 border-t border-border/60 pt-4"
          open={diagnosticsOpen}
          onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none text-sm font-semibold marker:hidden">
            <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
            Collection health
          </summary>
          <div className="mt-6">{children}</div>
        </details>
      ) : null}
    </>
  );
}
