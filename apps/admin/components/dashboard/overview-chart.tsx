"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";

type Point = {
  date: string;
  previousDate: string;
  requests: number;
  cost: number;
  previousRequests: number;
  previousCost: number;
};

const chartConfig = {
  requests: { label: "Current period", color: "var(--primary)" },
  previousRequests: { label: "Previous period", color: "var(--text-muted)" },
} satisfies ChartConfig;

/** "Oct 3", matching dates everywhere else in the app. */
function formatShortDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return date;
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function OverviewTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as Point | undefined;

  if (!active || !point) {
    return null;
  }

  return (
    <div className="grid min-w-[12rem] items-start gap-2 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <TooltipRow
        color="var(--color-requests)"
        label="Current period"
        date={formatShortDate(point.date)}
        value={point.requests}
      />
      <TooltipRow
        color="var(--color-previousRequests)"
        label="Previous period"
        date={formatShortDate(point.previousDate)}
        value={point.previousRequests}
      />
    </div>
  );
}

function TooltipRow({
  color,
  label,
  date,
  value,
}: {
  color: string;
  label: string;
  date: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1 text-muted-foreground">
        {label} · {date}
      </div>
      <span className="font-mono font-medium tabular-nums text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

export function OverviewChart({ data }: { data: Point[] }) {
  const isMobile = useIsMobile();

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full sm:h-[260px]">
      <AreaChart data={data} margin={{ left: 0, right: isMobile ? 0 : 8, top: 12, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={isMobile ? 42 : 24}
          tickFormatter={(value) => formatShortDate(String(value))}
        />
        <YAxis tickLine={false} axisLine={false} width={isMobile ? 28 : 34} allowDecimals={false} />
        <ChartTooltip content={OverviewTooltip} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="previousRequests"
          name="previousRequests"
          stroke="var(--color-previousRequests)"
          fill="transparent"
          strokeDasharray="5 5"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="requests"
          name="requests"
          stroke="var(--color-requests)"
          fill="var(--color-requests)"
          fillOpacity={0.12}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
