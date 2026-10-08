"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleDollarSign, MonitorSmartphone, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";
import { Ghost } from "@/components/empty-states/ghost";
import { ExportCsvButton } from "@/components/export-csv-button";
import { OverviewConnectBanner, sampleOverview } from "@/components/overview/overview-preview";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { TeamFilter } from "@/components/team-filter";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppPageQuery, useAppQuery } from "@/lib/api/client";
import { overviewKey, workspaceContextKey } from "@/lib/app-pages/query-keys";
import type { OverviewAction, OverviewPayload } from "@/lib/app-pages/overview";
import { microsToDollarsCell } from "@/lib/csv";
import { formatMicrosAsCurrency } from "@/lib/format";
import { canSeeOrgOverview, type OrganizationRole } from "@/lib/rbac/permissions";
import { cn } from "@/lib/utils";

const money = formatMicrosAsCurrency;

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function wholeDollars(micros: string | bigint) {
  const dollars = Number(BigInt(micros)) / 1_000_000;
  if (dollars > 0 && dollars < 1) return "<$1";
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function monthLabel(from: string) {
  return new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

const ACTION_ICON = { money: CircleDollarSign, people: Users, fleet: MonitorSmartphone } as const;

function Actions({ actions }: { actions: OverviewAction[] }) {
  if (!actions.length) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Nothing needs attention. Seats are in use, everyone is connected, and no machine is behind.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-border/60">
      {actions.slice(0, 7).map((action) => {
        const Icon = ACTION_ICON[action.tone];
        return (
          <li
            key={action.key}
            className="group relative -mx-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 rounded-md px-3 py-3.5 transition-colors hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50"
          >
            <span className="flex min-w-0 items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{action.title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{action.detail}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-4">
              {action.savingsMicros ? (
                <span className="text-sm">
                  Save <span className="font-semibold tabular-nums">{money(action.savingsMicros)}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </span>
              ) : null}
              <Link
                href={action.href}
                className="inline-flex items-center gap-0.5 text-xs outline-none group-hover:underline after:absolute after:inset-0 after:content-['']"
              >
                {action.cta} <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type DayBar = { date: string; label: string; weekend: boolean; usageMicros: bigint | null };

/** One bar per day of the month so far: the pulse of AI use. Weekends grey, days still to come as a baseline. */
function DailyUsage({ daily, month }: { daily: OverviewPayload["daily"]; month: OverviewPayload["month"] }) {
  const byDate = new Map(daily.map((row) => [row.date, BigInt(row.usageMicros)]));
  const total = daily.reduce((sum, row) => sum + BigInt(row.usageMicros), 0n);
  const max = Number(daily.reduce((top, row) => (BigInt(row.usageMicros) > top ? BigInt(row.usageMicros) : top), 0n));
  const today = daily.at(-1)?.date ?? null;
  const start = new Date(`${month.from}T00:00:00Z`);
  const days: DayBar[] = Array.from({ length: month.daysInMonth }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), index + 1));
    const key = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    return {
      date: key,
      label: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
      weekend: weekday === 0 || weekday === 6,
      usageMicros: byDate.get(key) ?? null,
    };
  });

  return (
    <section aria-label="AI usage by day this month" className="mb-8">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>AI usage by day, {monthLabel(month.from)}</span>
        <span className="tabular-nums">
          {total > 0n ? `~${wholeDollars(total)} so far at API prices · ` : "No usage yet this month · "}
          day {daily.length} of {month.daysInMonth}, weekends in grey
        </span>
      </div>
      <div className="grid h-9 auto-cols-fr grid-flow-col items-end gap-[3px]" aria-hidden>
        {days.map((day) => {
          if (day.usageMicros === null) return <span key={day.date} className="h-0.5 bg-border" />;
          const share = max > 0 ? (Number(day.usageMicros) / max) * 100 : 0;
          return (
            <Tooltip key={day.date} delayDuration={80}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "block min-h-0.5 transition-colors hover:bg-foreground",
                    day.weekend || day.usageMicros === 0n ? "bg-border-strong" : "bg-primary",
                    day.date === today && "outline outline-offset-1 outline-foreground",
                  )}
                  style={{ height: day.usageMicros > 0n ? `${Math.max(8, share)}%` : undefined }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {day.label}
                {day.date === today ? " · today so far" : ""}
                {" · "}
                {day.usageMicros > 0n ? `~${wholeDollars(day.usageMicros)} at API prices` : "no usage"}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>AI usage by day this month at API prices</caption>
        <tbody>
          {daily.map((row) => (
            <tr key={row.date}><th scope="row">{row.date}</th><td>{wholeDollars(row.usageMicros)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const trendConfig = { usage: { label: "Usage at API prices", color: "var(--primary)" } } satisfies ChartConfig;

type TrendPoint = { label: string; usage: number; partial: boolean };

function TrendTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as TrendPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="grid min-w-[11rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <span className="text-muted-foreground">{point.label}{point.partial ? " · month to date" : ""}</span>
      <span className="font-mono font-medium tabular-nums text-foreground">
        ${point.usage.toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}

/** One series, so no legend; the hatched bar is the month still in progress. */
function UsageTrend({ trend }: { trend: OverviewPayload["trend"] }) {
  const data: TrendPoint[] = trend.map((row) => ({ label: row.label, usage: Number(BigInt(row.usageMicros)) / 1_000_000, partial: row.partial }));
  if (!data.some((row) => row.usage > 0)) {
    return <p className="py-10 text-sm text-muted-foreground">No usage reported in the last six months yet.</p>;
  }
  return (
    <>
      <ChartContainer config={trendConfig} className="h-[220px] w-full">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }} barCategoryGap="28%" accessibilityLayer>
          <defs>
            <pattern id="overview-partial-month" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--color-usage)" fillOpacity={0.18} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-usage)" strokeWidth="2.5" />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => (value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${Math.round(value)}`)}
          />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={TrendTooltip} />
          <Bar dataKey="usage" radius={[4, 4, 0, 0]} maxBarSize={44}>
            {data.map((row) => (
              <Cell key={row.label} fill={row.partial ? "url(#overview-partial-month)" : "var(--color-usage)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>AI usage by month at API prices</caption>
        <tbody>
          {data.map((row) => (
            <tr key={row.label}><th scope="row">{row.label}{row.partial ? " (month to date)" : ""}</th><td>${row.usage.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Hatched: this month so far. On tools with a seat plan this is what the usage is worth, not an extra bill.</p>
    </>
  );
}

function TeamTable({ rows, canManage }: { rows: OverviewPayload["byTeam"]; canManage: boolean }) {
  if (!rows.length) {
    return (
      <div className="py-6 text-sm text-muted-foreground">
        <p>Group people into teams to compare spend, idle seats and adoption across squads or cost centres.</p>
        {canManage ? (
          <Link href="/team?tab=teams" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline">
            Create teams <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px] text-left text-sm">
        <thead className="border-b border-border/70 text-xs text-muted-foreground">
          <tr>
            <th className="pb-2.5 pr-3 font-medium">Team</th>
            <th className="pb-2.5 pr-3 font-medium">Using AI</th>
            <th className="pb-2.5 pr-3 text-right font-medium" title="Seat cost per month">Seats</th>
            <th className="pb-2.5 pr-3 text-right font-medium" title="Idle seat cost per month">Idle</th>
            <th className="pb-2.5 text-right font-medium" title="Usage this month at API prices">Usage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60 last:border-b-0">
              <td className="py-3 pr-3">
                <Link href={`/overview?team=${encodeURIComponent(row.id)}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                  <span className="size-2 shrink-0" style={{ background: row.color ?? "var(--muted-foreground)" }} aria-hidden />
                  {row.name}
                </Link>
              </td>
              <td className="py-3 pr-3 tabular-nums">
                {row.active} <span className="text-muted-foreground">of {row.people}</span>
              </td>
              <td className="py-3 pr-3 text-right tabular-nums">{wholeDollars(row.seatsMonthlyMicros)}</td>
              <td className={cn("py-3 pr-4 text-right tabular-nums", BigInt(row.idleMonthlyMicros) > 0n && "text-warning")}>
                {BigInt(row.idleMonthlyMicros) > 0n ? wholeDollars(row.idleMonthlyMicros) : "—"}
              </td>
              <td className="py-3 text-right tabular-nums">{BigInt(row.usageMonthToDateMicros) > 0n ? `~${wholeDollars(row.usageMonthToDateMicros)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type WorkspaceRole = { current: { role: OrganizationRole } | null };

export default function OverviewClientScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const team = searchParams.get("team");
  const queryString = team ? `team=${encodeURIComponent(team)}` : "";
  const context = useAppQuery<WorkspaceRole>(workspaceContextKey, "/api/app/workspace-context");
  const role = context.data?.current?.role ?? null;
  const allowed = role ? canSeeOrgOverview(role) : null;
  const query = useAppPageQuery<OverviewPayload>(
    overviewKey(queryString),
    `/api/app/overview${queryString ? `?${queryString}` : ""}`,
    { enabled: allowed === true },
  );
  useAppQueryErrorToast(query.error && query.data ? query.error : null, { retry: () => void query.refetch() });

  // Developers get their personal home instead of the workspace overview.
  useEffect(() => {
    if (allowed === false) router.replace("/dashboard");
  }, [allowed, router]);

  if (allowed !== true || (query.isPending && !query.data)) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  if (!query.data) return <AppPageSkeleton />;

  const data = query.data;
  // A brand-new workspace (just you, no machines, no usage): show the page's shape with sample numbers under a connect prompt.
  const empty = !data.team
    && data.adoption.members <= 1
    && data.fleet.machines === 0
    && data.trend.every((row) => BigInt(row.usageMicros) === 0n);

  return (
    <>
      <PageHeader
        title={data.team ? `Overview · ${data.team.name}.` : "Overview."}
        description={`${monthLabel(data.month.from)} so far: what you pay, who uses it, and what to change.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TeamFilter />
            <ExportCsvButton
              name={data.team ? `overview-${data.team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "overview"}
              header={["Team", "People", "Using AI (30d)", "Seats per month (USD)", "Idle seats per month (USD)", "Usage this month at API prices (USD)"]}
              rows={() => data.byTeam.map((row) => [row.name, row.people, row.active, microsToDollarsCell(row.seatsMonthlyMicros), microsToDollarsCell(row.idleMonthlyMicros), microsToDollarsCell(row.usageMonthToDateMicros)])}
              label="Export teams"
              className={data.byTeam.length ? undefined : "hidden"}
            />
          </div>
        }
      />

      {empty ? (
        <>
          <OverviewConnectBanner />
          <Ghost fade><OverviewBody data={sampleOverview(data)} /></Ghost>
        </>
      ) : (
        <OverviewBody data={data} />
      )}
    </>
  );
}

function OverviewBody({ data }: { data: OverviewPayload }) {
  const paygProjected = data.spend.payAsYouGoProjectedMicros;
  const payg = BigInt(paygProjected ?? data.spend.payAsYouGoToDateMicros);
  const idle = BigInt(data.idle.micros);
  const activeDelta = data.adoption.active - data.adoption.previousActive;

  return (
    <>
      <DailyUsage daily={data.daily ?? []} month={data.month} />

      <section aria-label="Summary" className="mb-10 grid gap-y-8 py-2 sm:grid-cols-2 lg:grid-cols-4">
        <SignalsKpi
          label="AI spend this month"
          hero
          accent
          className="pl-5"
          value={data.spend.totalIsEstimate ? `~${wholeDollars(data.spend.monthlyTotalMicros)}` : money(data.spend.monthlyTotalMicros)}
          sub={
            <span>
              {wholeDollars(data.spend.seatsMonthlyMicros)} seats
              {payg > 0n ? ` + ${wholeDollars(payg)} pay-as-you-go${paygProjected ? " (projected)" : ""}` : ""}
              {" · "}
              <Link href="/tools" className="hover:underline">Cost</Link>
            </span>
          }
        />
        <SignalsKpi
          label="Idle seats"
          className="sm:border-l sm:border-border sm:pl-8"
          value={idle > 0n ? <span className="text-warning">{wholeDollars(idle)}<span className="ml-1 text-base font-normal text-muted-foreground">/ mo</span></span> : "None"}
          sub={idle > 0n ? `${data.idle.seats} ${data.idle.seats === 1 ? "seat" : "seats"} unused in ${data.adoption.windowDays} days or unassigned` : "every paid seat saw use"}
        />
        <SignalsKpi
          label="Using AI"
          className="lg:border-l lg:border-border lg:pl-8"
          value={<span className="tabular-nums">{data.adoption.active}<span className="text-muted-foreground"> of {data.adoption.enrolled}</span></span>}
          sub={`connected people, last ${data.adoption.windowDays} days${activeDelta ? ` · ${activeDelta > 0 ? "+" : "−"}${Math.abs(activeDelta)} vs previous` : ""}`}
        />
        <SignalsKpi
          label="Connected"
          className="sm:border-l sm:border-border sm:pl-8"
          value={<span className="tabular-nums">{data.adoption.enrolled}<span className="text-muted-foreground"> of {data.adoption.members}</span></span>}
          sub={
            data.fleet.needsUpdate || data.fleet.stale || data.fleet.needsRepair
              ? [
                `${plural(data.fleet.machines, "machine")}`,
                data.fleet.stale + data.fleet.needsRepair ? `${data.fleet.stale + data.fleet.needsRepair} not reporting` : null,
                data.fleet.needsUpdate ? `${data.fleet.needsUpdate} ${data.fleet.needsUpdate === 1 ? "needs" : "need"} an update` : null,
              ].filter(Boolean).join(" · ")
              : `${plural(data.fleet.machines, "machine")}, all reporting`
          }
        />
      </section>

      <Panel as="section" className="mb-10">
        <SignalsSectionHeader title="What to do." bordered={false} />
        <Actions actions={data.actions} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel as="section" className="min-w-0">
          <SignalsSectionHeader title="AI usage by month." description="Usage at API prices, last six months. Not your invoice for tools with seats." bordered={false} />
          <UsageTrend trend={data.trend} />
        </Panel>
        <Panel as="section" className="min-w-0">
          <SignalsSectionHeader title="By team." description="Seat cost and idle seats per month, usage this month at API prices. Open a team to scope this page." bordered={false} />
          <TeamTable rows={data.byTeam} canManage={data.canManageTeams} />
        </Panel>
      </div>
    </>
  );
}
