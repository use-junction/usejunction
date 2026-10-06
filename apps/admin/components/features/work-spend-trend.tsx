"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Panel } from "@/components/panel";
import { WorkSpendSectionHeader, TREND_SERIES_COLORS } from "@/components/features/work-spend-ui";
import type { WorkSpendTrend } from "@/components/features/work-spend-types";
import { formatMicrosAsCurrency } from "@/lib/format";
import { useAppQuery } from "@/lib/api/client";
import { useIsMobile } from "@/hooks/use-mobile";

const MIN_WEEKS_FOR_CHART = 4;

function seriesKey(id: string) {
  return `s_${id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="8" height="8">
      <rect width="8" height="8" fill={color} />
      <path d="M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2" stroke="rgba(255,255,255,0.7)" strokeWidth="1.25" />
    </pattern>
  );
}

function seriesFill(series: WorkSpendTrend["series"][number], index: number) {
  const color = TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1];
  return series.inferred ? `url(#hatch-${seriesKey(series.id)})` : color;
}

export function WorkSpendTrend({
  days, by, canViewPeople, repositoryCount, allocatedMicros, onBy,
}: {
  days: number;
  by: "repository" | "project" | "person";
  canViewPeople: boolean;
  repositoryCount: number;
  allocatedMicros: string;
  onBy: (next: "repository" | "project" | "person") => void;
}) {
  const isMobile = useIsMobile();
  const query = useAppQuery<WorkSpendTrend>(["app", "work-spend-trend", days, by], `/api/app/work-spend/trend?days=${days}&by=${by}`);
  const tabs = [
    ...(repositoryCount > 1 ? [["repository", "Repos"] as const] : []),
    ["project", "Projects"] as const,
    ...(canViewPeople ? [["person", "People"] as const] : []),
  ];
  return (
    <Panel as="section" aria-label="Spend by week" className="flex min-h-[17.5rem] min-w-0 flex-col">
      <WorkSpendSectionHeader
        title="Spend by week."
        description={by === "person" ? "AI cost on their commits" : "Weekly spend on work"}
        action={tabs.length > 1 ? (
          <div role="group" aria-label="Group spend by" className="flex gap-3 overflow-x-auto text-sm">
            {tabs.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={by === value} onClick={() => onBy(value)} className={`shrink-0 pb-0.5 focus-visible:outline focus-visible:outline-ring ${by === value ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
        ) : undefined}
      />
      {query.isPending ? <p className="py-10 text-sm text-muted-foreground">Loading weekly allocation…</p> : null}
      {query.error ? <p role="alert" className="py-10 text-sm text-destructive">Couldn’t load the weekly view.</p> : null}
      {query.data ? <TrendChart data={query.data} isMobile={isMobile} allocatedMicros={allocatedMicros} /> : null}
    </Panel>
  );
}

function TrendChart({ data, isMobile, allocatedMicros }: { data: WorkSpendTrend; isMobile: boolean; allocatedMicros: string }) {
  const weeks = data.weeks;
  const sparse = weeks.length < MIN_WEEKS_FOR_CHART;
  const config = Object.fromEntries(data.series.map((series, index) => [seriesKey(series.id), { label: series.title, color: TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1] }])) as ChartConfig;
  const points = weeks.map((week, index) => {
    const row: Record<string, string | number> = { week };
    for (const series of data.series) row[seriesKey(series.id)] = series.points[index] ?? 0;
    return row;
  });
  if (!data.series.length) return <p className="py-10 text-sm text-muted-foreground">No allocated work in this period.</p>;
  if (sparse) {
    return (
      <ol>
        {data.series.map((series, index) => (
          <li key={series.id} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-3 last:border-b-0">
            <span className="inline-flex min-w-0 items-center gap-2 truncate text-sm font-medium">
              <span className="size-2 shrink-0" style={{ background: TREND_SERIES_COLORS[index] }} aria-hidden />
              {series.title}{series.inferred ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Guessed from the repo</span> : null}
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatMicrosAsCurrency(series.totalMicros)}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (data.by === "project") {
    return (
      <div>
        <p className="mb-4 text-xs text-muted-foreground">The same work can sit on two projects, so these totals can add up to more than spend on work ({formatMicrosAsCurrency(allocatedMicros)}).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {data.series.filter((series) => series.id !== "__other__").map((series, index) => (
            <figure key={series.id} className="border border-border/70 p-4">
              <figcaption className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">{series.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatMicrosAsCurrency(series.totalMicros)}</span>
              </figcaption>
              {series.inferred ? <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Guessed from the repo</p> : null}
              <ChartContainer config={{ [seriesKey(series.id)]: { label: series.title, color: TREND_SERIES_COLORS[index % TREND_SERIES_COLORS.length] } }} className="mt-3 aspect-auto h-24 w-full">
                <BarChart data={weeks.map((week, i) => ({ week, value: series.points[i] ?? 0 }))} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} accessibilityLayer>
                  {series.inferred ? <defs><Hatch id={`hatch-${seriesKey(series.id)}`} color={TREND_SERIES_COLORS[index % TREND_SERIES_COLORS.length]} /></defs> : null}
                  <Bar dataKey="value" fill={seriesFill(series, index)} maxBarSize={18} />
                </BarChart>
              </ChartContainer>
            </figure>
          ))}
        </div>
      </div>
    );
  }
  return (
    <figure className="min-h-0 flex-1">
      <figcaption className="sr-only">Weekly allocated AI cost by {data.by}</figcaption>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {data.series.map((series, index) => (
          <li key={series.id} className="inline-flex items-center gap-1.5">
            <span className="size-2" style={{ background: TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1] }} aria-hidden />
            {series.title}{series.inferred ? " · guessed from the repo" : ""}
          </li>
        ))}
      </ul>
      <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
        <BarChart data={points} margin={{ left: 0, right: isMobile ? 0 : 8, top: 12, bottom: 0 }} accessibilityLayer>
          <defs>
            {data.series.map((series, index) => series.inferred ? <Hatch key={series.id} id={`hatch-${seriesKey(series.id)}`} color={TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1]} /> : null)}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} minTickGap={isMobile ? 42 : 24} tickFormatter={(value) => String(value).slice(5)} />
          <YAxis tickLine={false} axisLine={false} width={isMobile ? 36 : 44} tickFormatter={(value) => `$${Math.round(Number(value) / 1_000_000)}`} />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => String(value)} formatter={(value) => formatMicrosAsCurrency(String(value))} />} />
          {data.series.map((series, index) => (
            <Bar key={series.id} dataKey={seriesKey(series.id)} stackId="alloc" fill={seriesFill(series, index)} maxBarSize={42} />
          ))}
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Weekly allocated AI cost</caption>
        <thead><tr><th>Week</th>{data.series.map((series) => <th key={series.id}>{series.title}</th>)}</tr></thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={week}>
              <td>{week}</td>
              {data.series.map((series) => <td key={series.id}>{formatMicrosAsCurrency(String(series.points[index] ?? 0))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
