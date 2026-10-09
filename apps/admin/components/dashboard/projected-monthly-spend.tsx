"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import { barColorForVerdict } from "@/components/dashboard/cycle-utilization-bar";
import {
  buildCycleCoverageRunways,
  buildProjectedSpendSeries,
  type CycleCoverageRunway,
  type ProjectedSpendPoint,
  type SpendLens,
} from "@/lib/dashboard/projected-spend";
import { billingCadenceLabel } from "@/lib/billing/cycles";
import { formatShortDate, formatUsd } from "@/lib/format";
import { canonicalToolKey, toolDisplayName } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";
import { isIdlePaidCycle } from "@/lib/dashboard/idle-cycles";
import { useIsMobile } from "@/hooks/use-mobile";
import type { OrgOverviewV1 } from "@/lib/insights";

const MAX_VISIBLE = 3;
/** Fixed chart pane so the seats card matches the KPI grid height. */
const CHART_HEIGHT = 220;

const usageChartConfig = {
  actual: { label: "Actual usage", color: "var(--primary)" },
  projected: { label: "Projected usage", color: "var(--primary)" },
} satisfies ChartConfig;

function rankCycles(cycles: OrgOverviewV1["subscriptionCycles"]) {
  return [...cycles]
    .filter((row) => row.utilizationPercent != null)
    .sort((a, b) => {
      const useDiff = (b.utilizationPercent ?? 0) - (a.utilizationPercent ?? 0);
      if (useDiff !== 0) return useDiff;
      const costA = a.verifiedUsageCost + a.estimatedApiCost;
      const costB = b.verifiedUsageCost + b.estimatedApiCost;
      return costB - costA;
    });
}

function toolKeyOf(row: OrgOverviewV1["subscriptionCycles"][number]) {
  return canonicalToolKey(row.toolKey ?? row.toolName);
}

function formatAxisUsd(value: number) {
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

function utcMs(isoDate: string) {
  return Date.parse(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

const COVERED_BAR_COLOR = "var(--primary)";
const UNCOVERED_BAR_COLOR = "var(--border-strong)";

type RunwayChartRow = CycleCoverageRunway & {
  domainSpan: number;
  cycleStartMs: number;
  cycleEndMs: number;
  coversThroughMs: number | null;
};

type CalendarDomain = {
  rangeStartMs: number;
  rangeEndMs: number;
  todayMs: number;
  tickDates: string[];
};

function UsageTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as ProjectedSpendPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="grid min-w-[12rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{formatShortDate(point.date)}</p>
      {point.actual != null ? (
        <TooltipRow color="var(--color-actual)" label="Actual usage" value={formatUsd(point.actual)} />
      ) : null}
      {point.projected != null ? (
        <TooltipRow
          color="var(--color-projected)"
          label="Projected usage"
          value={formatUsd(point.projected)}
        />
      ) : null}
    </div>
  );
}

function RunwayTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as RunwayChartRow | undefined;
  if (!active || !row) return null;
  return (
    <div className="grid min-w-[14rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{row.label}</p>
      <TooltipRow
        color="var(--muted-foreground)"
        label="Plan"
        value={`${billingCadenceLabel(row.billingCadence, row.totalDays)} · ${formatShortDate(row.cycleStart)} → ${formatShortDate(row.cycleEnd)}`}
      />
      {row.coversThroughDate && !row.coversFullCycle ? (
        <TooltipRow
          color={barColorForVerdict(row.verdictCode)}
          label="Out"
          value={formatShortDate(row.coversThroughDate)}
        />
      ) : (
        <TooltipRow color="var(--primary)" label="Status" value="Lasts full cycle" />
      )}
      <TooltipRow
        color="var(--foreground)"
        label="Allowance used"
        value={`${Math.round(row.usedPercent)}%`}
      />
      <div className="mt-1 space-y-1 border-t border-border/60 pt-1.5 text-[0.65rem] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-primary" />
          Within allowance
        </p>
        <p className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-border-strong" />
          After run-out
        </p>
      </div>
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** One bar = one billed seat cycle. Fill matches cycle verdict; muted = after run-out. */
function RunwayShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: RunwayChartRow;
  domain?: CalendarDomain;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload, domain } = props;
  if (!payload || !domain || width <= 0 || height <= 0) return null;

  const span = Math.max(1, domain.rangeEndMs - domain.rangeStartMs);
  const toX = (ms: number) => x + ((ms - domain.rangeStartMs) / span) * width;
  const barH = Math.max(12, Math.min(16, height * 0.42));
  const barY = y + height * 0.26;
  const cycleX = toX(payload.cycleStartMs);
  const cycleW = Math.max(4, toX(payload.cycleEndMs) - cycleX);
  const known =
    payload.coverageState !== "unavailable" && payload.coverageState !== "forming";
  const coverEndMs = known
    ? Math.min(payload.coversThroughMs ?? payload.cycleEndMs, payload.cycleEndMs)
    : null;
  const coverW =
    coverEndMs == null ? 0 : Math.max(0, toX(coverEndMs) - cycleX);
  const uncovered =
    coverEndMs != null && !payload.coversFullCycle
      ? Math.max(0, toX(payload.cycleEndMs) - toX(coverEndMs))
      : 0;
  const coveredColor = barColorForVerdict(payload.verdictCode);

  return (
    <g>
      {/* Track for the single monthly (or billed) cycle only — no week segments. */}
      <rect x={cycleX} y={barY} width={cycleW} height={barH} rx={0} fill="var(--muted)" />
      {coverW > 0 ? (
        <rect
          x={cycleX}
          y={barY}
          width={coverW}
          height={barH}
          rx={0}
          fill={coveredColor}
          opacity={0.92}
        />
      ) : null}
      {uncovered > 0 && coverEndMs != null ? (
        <rect
          x={toX(coverEndMs)}
          y={barY}
          width={uncovered}
          height={barH}
          rx={0}
          fill={UNCOVERED_BAR_COLOR}
          opacity={0.9}
        />
      ) : null}
      {known && payload.coversThroughDate && !payload.coversFullCycle ? (
        <text
          x={toX(coverEndMs!)}
          y={barY + barH + 11}
          fill={coveredColor}
          fontSize={9}
          fontWeight={600}
          textAnchor="middle"
        >
          Out {formatShortDate(payload.coversThroughDate)}
        </text>
      ) : null}
    </g>
  );
}

function ToolAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  rows: RunwayChartRow[];
}) {
  const { x = 0, y = 0, payload, rows } = props;
  const row = rows.find((item) => item.label === payload?.value);
  if (!row) return null;
  return (
    <g transform={`translate(${x - 8},${y})`}>
      <foreignObject x={-88} y={-10} width={88} height={20}>
        <div className="flex h-5 items-center justify-end gap-1.5 pr-1">
          <ToolBrandIcon tool={row.toolKey} size={12} />
          <span className="truncate text-[11px] font-medium text-foreground">{row.label}</span>
        </div>
      </foreignObject>
    </g>
  );
}

export function ProjectedMonthlySpend({
  trend,
  commitment,
  cycles = [],
  className,
}: {
  trend: OrgOverviewV1["trend"];
  commitment: number;
  cycles?: OrgOverviewV1["subscriptionCycles"];
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [lens, setLens] = useState<SpendLens>("commitment");

  const usageSeries = useMemo(
    () => buildProjectedSpendSeries(trend, commitment),
    [trend, commitment],
  );

  const ranked = useMemo(() => rankCycles(cycles), [cycles]);
  const allKeys = useMemo(() => ranked.map(toolKeyOf), [ranked]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  useEffect(() => {
    setSelectedKeys((prev) => {
      const stillValid = prev.filter((key) => allKeys.includes(key));
      if (stillValid.length > 0) return stillValid.slice(0, MAX_VISIBLE);
      return allKeys.slice(0, MAX_VISIBLE);
    });
  }, [allKeys]);

  const selectedCycles = useMemo(
    () => ranked.filter((row) => selectedKeys.includes(toolKeyOf(row))),
    [ranked, selectedKeys],
  );

  const fleetRunways = useMemo(
    () =>
      buildCycleCoverageRunways(cycles, {
        labelForTool: (toolKey) => toolDisplayName(toolKey),
      }),
    [cycles],
  );

  const runways = useMemo(
    () =>
      buildCycleCoverageRunways(selectedCycles, {
        labelForTool: (toolKey) => toolDisplayName(toolKey),
      }),
    [selectedCycles],
  );

  const domain = runways.calendar;
  const runwayRows = useMemo<RunwayChartRow[]>(
    () =>
      runways.rows.map((row) => ({
        ...row,
        domainSpan: domain.rangeEndMs - domain.rangeStartMs,
        cycleStartMs: utcMs(row.cycleStart),
        cycleEndMs: utcMs(row.cycleEnd),
        coversThroughMs: row.coversThroughDate ? utcMs(row.coversThroughDate) : null,
      })),
    [runways.rows, domain],
  );

  const runwayConfig = useMemo(() => {
    const config: ChartConfig = {
      domainSpan: { label: "Cycle", color: COVERED_BAR_COLOR },
    };
    for (const row of runwayRows) {
      config[row.seriesKey] = { label: row.label, color: COVERED_BAR_COLOR };
    }
    return config;
  }, [runwayRows]);

  const overflowKeys = allKeys.filter((key) => !selectedKeys.includes(key));

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== key);
      }
      if (prev.length >= MAX_VISIBLE) {
        return [...prev.slice(1), key];
      }
      return [...prev, key];
    });
  }

  const todayInDomain =
    domain.todayMs >= domain.rangeStartMs && domain.todayMs <= domain.rangeEndMs;

  const idlePlans = cycles.filter(isIdlePaidCycle).length;
  const seatsCaption = idlePlans > 0
    ? `${idlePlans} of ${cycles.length} paid ${cycles.length === 1 ? "plan" : "plans"} with no use this period`
    : fleetRunways.earliestRunOutDate
    ? `Earliest run-out ${formatShortDate(fleetRunways.earliestRunOutDate)} · ${fleetRunways.coversFullCount}/${fleetRunways.rows.length || 0} on track`
    : fleetRunways.coversFullCount > 0 && fleetRunways.coversFullCount === fleetRunways.rows.length
      ? "All tracked plans on track"
      : "Purchased seats · run-out from allowance pace";

  return (
    <section className={cn("flex h-full min-h-0 flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-6", className)}>
      <div className="w-full shrink-0 lg:w-[12.5rem]">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-medium text-muted-foreground">
            {lens === "commitment" ? "Seat commitment" : "Provider usage"}
          </p>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="How this is calculated"
              >
                <Info className="size-3" strokeWidth={2.25} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
              {lens === "commitment"
                ? `Bar = billed period (full month when monthly). Short ticks inside monthly bars mark weeks. Run-out is when allowance empties at today’s pace. Pick up to ${MAX_VISIBLE} tools.`
                : "Cumulative API / usage cost so far, extrapolated at the current daily average."}
            </TooltipContent>
          </Tooltip>
          {lens === "commitment" && allKeys.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Select tools"
                  className="ml-auto inline-flex h-7 shrink-0 items-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <span className="flex items-center -space-x-2">
                    {(selectedKeys.length > 0 ? selectedKeys : allKeys.slice(0, MAX_VISIBLE)).map(
                      (key, index) => (
                        <span
                          key={key}
                          className="relative inline-flex size-5 items-center justify-center rounded-sm border border-background bg-card shadow-sm"
                          style={{ zIndex: index + 1 }}
                        >
                          <ToolBrandIcon tool={key} size={12} />
                        </span>
                      ),
                    )}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Tools
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allKeys.map((key) => {
                  const checked = selectedKeys.includes(key);
                  const disabled = !checked && selectedKeys.length >= MAX_VISIBLE;
                  return (
                    <DropdownMenuCheckboxItem
                      key={key}
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggleKey(key)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      <span className="flex items-center gap-2">
                        <ToolBrandIcon tool={key} size={14} />
                        {toolDisplayName(key)}
                      </span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
                {overflowKeys.length > 0 && selectedKeys.length >= MAX_VISIBLE ? (
                  <p className="px-2 pb-1.5 pt-1 text-[0.65rem] text-muted-foreground">
                    Deselect one to add another (max {MAX_VISIBLE}).
                  </p>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="mt-2 inline-flex rounded-lg bg-muted p-[3px]">
          <button
            type="button"
            onClick={() => setLens("commitment")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
              lens === "commitment"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Seats
          </button>
          <button
            type="button"
            onClick={() => setLens("usage")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
              lens === "usage"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Provider usage
          </button>
        </div>

        <p className="mt-3 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums sm:text-[2rem]">
          {lens === "commitment"
            ? formatUsd(commitment)
            : formatUsd(usageSeries.projectedSpend)}
        </p>
        <p className={cn("mt-2 text-xs", lens === "commitment" && idlePlans > 0 ? "text-warning" : "text-muted-foreground")}>
          {lens === "commitment" ? seatsCaption : "Projected at current daily pace"}
        </p>

        {lens === "usage" ? (
          <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-primary" />
                Actual usage
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {formatUsd(usageSeries.actualSpend)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-px w-3 border-t border-dashed border-primary" />
                Projected usage
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {formatUsd(usageSeries.projectedSpend)}
              </span>
            </li>
          </ul>
        ) : null}
      </div>

      {lens === "commitment" ? (
        runwayRows.length ? (
          <ChartContainer
            config={runwayConfig}
            className="aspect-auto w-full min-w-0 min-h-0 flex-1"
            style={{ height: CHART_HEIGHT }}
            initialDimension={{ width: 520, height: CHART_HEIGHT }}
          >
            <BarChart
              data={runwayRows}
              layout="vertical"
              margin={{ left: 0, right: isMobile ? 8 : 16, top: 12, bottom: 8 }}
              barCategoryGap="18%"
              accessibilityLayer
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis
                type="number"
                domain={[0, domain.rangeEndMs - domain.rangeStartMs]}
                ticks={domain.tickDates.map((iso) => utcMs(iso) - domain.rangeStartMs)}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(offset) =>
                  formatShortDate(
                    new Date(domain.rangeStartMs + Number(offset)).toISOString().slice(0, 10),
                  )
                }
              />
              <YAxis
                type="category"
                dataKey="label"
                width={isMobile ? 76 : 92}
                tickLine={false}
                axisLine={false}
                tick={(tickProps) => (
                  <ToolAxisTick
                    x={typeof tickProps.x === "number" ? tickProps.x : undefined}
                    y={typeof tickProps.y === "number" ? tickProps.y : undefined}
                    payload={
                      tickProps.payload && typeof tickProps.payload === "object"
                        ? { value: (tickProps.payload as { value?: string | number }).value }
                        : undefined
                    }
                    rows={runwayRows}
                  />
                )}
              />
              {todayInDomain ? (
                <ReferenceLine
                  x={domain.todayMs - domain.rangeStartMs}
                  stroke="var(--foreground)"
                  strokeOpacity={0.55}
                  strokeDasharray="4 4"
                  label={{
                    value: "Today",
                    position: "top",
                    fill: "var(--muted-foreground)",
                    fontSize: 10,
                  }}
                />
              ) : null}
              <ChartTooltip
                cursor={{ fill: "color-mix(in srgb, var(--muted) 55%, transparent)" }}
                content={(props) => <RunwayTooltip {...props} />}
              />
              <Bar
                dataKey="domainSpan"
                isAnimationActive={false}
                shape={(shapeProps) => <RunwayShape {...shapeProps} domain={domain} />}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="flex-1 self-center text-xs text-muted-foreground">
            Run-out dates appear here once tools report plan allowance pace.
          </p>
        )
      ) : usageSeries.points.length ? (
        <ChartContainer
          config={usageChartConfig}
          className="aspect-auto w-full min-w-0 min-h-0 flex-1"
          style={{ height: CHART_HEIGHT }}
          initialDimension={{ width: 520, height: CHART_HEIGHT }}
        >
          <ComposedChart
            data={usageSeries.points.map(({ date, actual, projected }) => ({
              date,
              actual,
              projected,
            }))}
            margin={{ left: 0, right: isMobile ? 4 : 12, top: 16, bottom: 0 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id="projectedActualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-actual)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-actual)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={isMobile ? 40 : 28}
              tickFormatter={(value) => formatShortDate(String(value))}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={isMobile ? 36 : 44}
              tickFormatter={(value) => formatAxisUsd(Number(value))}
            />
            <ChartTooltip content={(props) => <UsageTooltip {...props} />} />
            {usageSeries.todayIndex >= 0 && !usageSeries.complete ? (
              <ReferenceLine
                x={usageSeries.points[usageSeries.todayIndex]!.date}
                stroke="var(--border)"
                strokeDasharray="4 4"
                label={{
                  value: "Today",
                  position: "top",
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="actual"
              name="actual"
              stroke="var(--color-actual)"
              strokeWidth={2}
              fill="url(#projectedActualFill)"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="projected"
              name="projected"
              stroke="var(--color-projected)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      ) : (
        <p className="flex-1 self-center text-xs text-muted-foreground">
          Usage trend will show here once sync collects daily spend.
        </p>
      )}
    </section>
  );
}
