"use client";

import { WorkSpendKpi, WorkSpendMeter, WORK_STATE_COLORS, WORK_STATE_LABELS, microsSharePct } from "@/components/features/work-spend-ui";
import type { WorkSpendPayload, WorkStateItem } from "@/components/features/work-spend-types";
import { formatMicrosAsCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function WorkSpendStates({
  data,
  selected,
  onSelect,
}: {
  data: WorkSpendPayload;
  selected: "shipped" | "in_flight" | "stalled" | null;
  onSelect: (state: "shipped" | "in_flight" | "stalled" | null) => void;
  onItem?: (item: WorkStateItem) => void;
}) {
  const allocated = data.coverage.attributedMicros;
  const cards = [
    { key: "shipped" as const, label: WORK_STATE_LABELS.shipped, bucket: data.states.shipped, color: WORK_STATE_COLORS.shipped, sub: null as string | null },
    { key: "in_flight" as const, label: WORK_STATE_LABELS.in_flight, bucket: data.states.inFlight, color: WORK_STATE_COLORS.in_flight, sub: null },
    { key: "stalled" as const, label: WORK_STATE_LABELS.stalled, bucket: data.states.stalled, color: WORK_STATE_COLORS.stalled, sub: "Closed without merging, or no updates for 14 days" },
  ];

  return (
    <section aria-label="Where the work stands" className="relative grid h-full min-h-[17.5rem] grid-cols-2 grid-rows-2">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-[1] w-px -translate-x-1/2 bg-border-strong" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-px -translate-y-1/2 bg-border-strong" />
      <WorkSpendKpi
        label="On work"
        value={data.allocationCurrent ? formatMicrosAsCurrency(allocated) : "Updating"}
        hero
        accent
        compactMobile
        className="h-full px-3 sm:px-4"
        sub={`${data.workCount} ${data.workCount === 1 ? "item" : "items"} · ${Math.round(data.coverage.attributedPct)}% of recorded · last ${data.days} days`}
      />
      {cards.map((card) => {
        const share = microsSharePct(card.bucket.micros, allocated);
        const active = selected === card.key;
        return (
          <button
            key={card.key}
            type="button"
            aria-pressed={active}
            aria-label={`${card.label} · ${card.bucket.count}`}
            onClick={() => onSelect(active ? null : card.key)}
            className={cn("h-full text-left focus-visible:outline focus-visible:outline-ring", active && "bg-muted/40")}
          >
            <WorkSpendKpi
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0" style={{ background: card.color }} aria-hidden />
                  {card.label}
                </span>
              }
              value={data.allocationCurrent ? formatMicrosAsCurrency(card.bucket.micros) : "Updating"}
              compactMobile
              className="h-full px-3 sm:px-4"
              sub={card.sub ?? `${card.bucket.count} ${card.bucket.count === 1 ? "item" : "items"} · ${share}% of spend on work · last ${data.days} days`}
              footer={
                <WorkSpendMeter
                  size="sm"
                  value={share}
                  color={card.color}
                  label={`${card.label} share of spend on work`}
                />
              }
            />
          </button>
        );
      })}
    </section>
  );
}
