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
  const onItems = BigInt(data.states.shipped.micros) + BigInt(data.states.inFlight.micros) + BigInt(data.states.stalled.micros);
  const outsideItems = BigInt(allocated) > onItems ? BigInt(allocated) - onItems : 0n;
  const recorded = `${Math.round(data.coverage.attributedPct)}% of recorded AI spend`;
  const heroSub = data.workCount === 0
    ? BigInt(allocated) > 0n
      ? `${recorded} · on repository commits, not yet on a PR or issue`
      : "No PRs or issues in this period"
    : [
      `${data.workCount} ${data.workCount === 1 ? "item" : "items"}`,
      recorded,
      outsideItems > 0n ? `${formatMicrosAsCurrency(outsideItems)} on commits outside a PR or issue` : null,
    ].filter(Boolean).join(" · ");
  const cards = [
    { key: "shipped" as const, label: WORK_STATE_LABELS.shipped, bucket: data.states.shipped, color: WORK_STATE_COLORS.shipped, hint: undefined as string | undefined },
    { key: "in_flight" as const, label: WORK_STATE_LABELS.in_flight, bucket: data.states.inFlight, color: WORK_STATE_COLORS.in_flight, hint: undefined },
    { key: "stalled" as const, label: WORK_STATE_LABELS.stalled, bucket: data.states.stalled, color: WORK_STATE_COLORS.stalled, hint: "Closed without merging, or no updates for 14 days" },
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
        sub={heroSub}
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
            title={card.hint}
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
              sub={`${card.bucket.count} ${card.bucket.count === 1 ? "item" : "items"} · ${share}%`}
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
