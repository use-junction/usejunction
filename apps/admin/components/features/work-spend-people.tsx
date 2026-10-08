"use client";

import { Users } from "lucide-react";
import { useAppQuery } from "@/lib/api/client";
import { formatMicrosAsCurrency } from "@/lib/format";
import { TREND_SERIES_COLORS, microsSharePct } from "@/components/features/work-spend-ui";
import type { WorkSpendPayload, WorkSpendPeople } from "@/components/features/work-spend-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_PEOPLE = 8;

export function WorkSpendPeoplePanel({
  data,
  selectedDeveloperId,
  onSelect,
  onAuthors,
}: {
  data: WorkSpendPayload;
  selectedDeveloperId: string | null;
  onSelect: (developerId: string | null) => void;
  onAuthors: () => void;
}) {
  const query = useAppQuery<WorkSpendPeople>(
    ["app", "work-spend-people", data.days],
    `/api/app/work-spend/people?days=${data.days}`,
  );
  const unmatched = data.attention.unmappedAuthors.length;
  const people = (query.data?.people ?? []).slice(0, MAX_PEOPLE);

  return (
    <section aria-label="Spend by person" className="min-w-0">
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Spend by person.</h2>
      {query.isPending ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">Loading people…</p>
      ) : query.error ? (
        <p role="alert" className="py-8 text-sm text-destructive">Couldn’t load spend by person. <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Retry</Button></p>
      ) : !people.length ? (
        <div className="border bg-muted/30 px-4 py-5">
          <p className="text-sm font-medium">
            {unmatched ? "Match GitHub authors to see spend by person." : "No spend by person in this period."}
          </p>
          {unmatched ? (
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={onAuthors}>
                <Users className="size-4" aria-hidden />Match authors ({unmatched})
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 min-[1400px]:grid-cols-3">
          {people.map((row, index) => {
            const total = (BigInt(row.verifiedMicros) + BigInt(row.estimatedMicros)).toString();
            const share = microsSharePct(total, data.coverage.attributedMicros);
            const color = TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1];
            const active = selectedDeveloperId === row.id;
            return (
              <li key={row.id} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${row.name} · ${formatMicrosAsCurrency(total)}`}
                  onClick={() => onSelect(active ? null : row.id)}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-1 border border-border/70 bg-card px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-ring",
                    active ? "border-foreground bg-muted/40" : "hover:border-foreground/40",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0" style={{ background: color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
                  </span>
                  <span className="text-base font-semibold tabular-nums">{formatMicrosAsCurrency(total)}</span>
                  <span className="text-[0.7rem] text-muted-foreground">
                    {share}% · {row.workCount} {row.workCount === 1 ? "item" : "items"}
                    {BigInt(row.estimatedMicros) > 0n ? " · estimated" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
