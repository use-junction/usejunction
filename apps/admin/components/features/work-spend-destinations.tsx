"use client";

import { useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useAppQuery } from "@/lib/api/client";
import { formatMicrosAsCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StateChip } from "@/components/ui/state-chip";
import { WORK_STATE_COLORS, WORK_STATE_LABELS, microsSharePct } from "@/components/features/work-spend-ui";
import { WorkSpendSheet } from "./work-spend-sheet";
import type { WorkFeedItem, WorkFeedPage, WorkLifecycle, WorkSpendPayload } from "./work-spend-types";

const TOP_COUNT = 5;
const currency = (verified: string, estimated: string) => formatMicrosAsCurrency((BigInt(verified) + BigInt(estimated)).toString());

function projectLine(row: WorkFeedItem) {
  const link = row.projectLinks[0];
  if (!link) return "Not on a project";
  return link.status ? `${link.projectTitle} · ${link.status}` : link.projectTitle;
}

export function WorkSpendDestinations({
  data, workState, projectId, developerId, onExplore, onSync, selectedItem, onSelectedItem,
}: {
  data: WorkSpendPayload;
  workState: WorkLifecycle | null;
  projectId: string | null;
  developerId: string | null;
  onExplore: () => void;
  onSync: () => void;
  selectedItem: WorkFeedItem | null;
  onSelectedItem: (item: WorkFeedItem | null) => void;
}) {
  const params = new URLSearchParams({ days: String(data.days), sort: "cost" });
  if (workState) params.set("workState", workState);
  if (projectId) params.set("projectId", projectId);
  if (developerId) params.set("developerId", developerId);
  const workUrl = `/api/app/work-spend/work?${params}`;
  const work = useAppQuery<WorkFeedPage>(["app", "work-spend-destinations", workUrl], workUrl);
  const openedBy = useRef<HTMLButtonElement | null>(null);
  const [local, setLocal] = useState<WorkFeedItem | null>(null);
  const selected = selectedItem ?? local;
  const rows = work.data?.items ?? [];
  const shown = rows.slice(0, TOP_COUNT);
  const count = work.data?.totalCount ?? 0;
  const allocated = data.coverage.attributedMicros;
  const projectTitle = projectId === "__none__" ? "Not on a project" : data.projects.selected.find((project) => project.id === projectId)?.title;
  const personName = developerId
    ? data.attention.developers.find((developer) => developer.id === developerId)?.name ?? "This person"
    : null;
  const description = [
    workState ? `${WORK_STATE_LABELS[workState]} work` : `Highest spend on work · last ${data.days} days`,
    projectTitle,
    personName,
  ].filter(Boolean).join(" · ");

  return <section aria-label="Work that received the most AI cost" className="flex h-full min-h-0 flex-col">
    <div className="mb-3 flex min-w-0 shrink-0 items-baseline justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Biggest items.</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <button type="button" onClick={onExplore} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">See all work <ArrowRight className="size-3.5" aria-hidden /></button>
    </div>
    {!data.allocationCurrent ? <div role="status" className="py-8 text-sm"><p className="font-medium">Cost rankings need refreshing</p><p className="mt-1 text-muted-foreground">Sync GitHub to recalculate work allocations.</p><Button variant="outline" size="sm" className="mt-3" onClick={onSync}>Sync now</Button></div> : null}
    {data.allocationCurrent && work.isPending ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading work…</p> : null}
    {data.allocationCurrent && work.error ? <p role="alert" className="py-8 text-sm text-destructive">Couldn’t load this ranking. <Button variant="ghost" size="sm" onClick={() => void work.refetch()}>Retry</Button></p> : null}
    {data.allocationCurrent && !work.isPending && !work.error && !rows.length ? <div className="py-8 text-sm"><p className="font-medium">No work in this period</p><p className="mt-1 text-muted-foreground">Try the longer date range or sync GitHub.</p></div> : null}
    {data.allocationCurrent && !work.isPending && !work.error && shown.length ? (
      <ul className="uj-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {shown.map((row) => {
          const amount = currency(row.verifiedMicros, row.estimatedMicros);
          const share = microsSharePct((BigInt(row.verifiedMicros) + BigInt(row.estimatedMicros)).toString(), allocated);
          const color = WORK_STATE_COLORS[row.workState ?? "in_flight"];
          return (
            <li key={row.id} className="border-b border-border/60 last:border-b-0">
              <button type="button" aria-label={`${row.title}, ${amount}`} onClick={(event) => { openedBy.current = event.currentTarget; setLocal(row); onSelectedItem(row); }} className="flex w-full items-start gap-3 py-3 text-left hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring">
                <span className="mt-0.5 size-5 shrink-0" style={{ background: color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{row.title}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{amount}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">{row.repository.fullName}</span>
                    <StateChip state={row.state} workState={row.workState} activityAt={row.activityAt} />
                    {row.originalTitle ? <span className="font-mono text-muted-foreground/80">{row.originalTitle}</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{projectLine(row)} · {share}% of spend on work · last {data.days} days{row.commitCount > 0 ? ` · ${row.commitCount} ${row.commitCount === 1 ? "commit" : "commits"}` : ""}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : null}
    <p className="mt-3 text-xs text-muted-foreground">{count} {count === 1 ? "work item" : "work items"}{count > TOP_COUNT ? ` · top ${TOP_COUNT} shown` : ""}</p>
    <WorkSpendSheet item={selected} days={data.days} allocationCurrent={data.allocationCurrent} onClose={() => { setLocal(null); onSelectedItem(null); }} onReturnFocus={() => openedBy.current?.focus()} />
  </section>;
}
