"use client";

import { useAppQuery } from "@/lib/api/client";
import { GitHubProjectsBadge, GitHubProjectsButtonLabel } from "@/components/features/integration-provider-logos";
import { formatMicrosAsCurrency } from "@/lib/format";
import { ProjectToolConnectDialog } from "@/components/features/project-tool-connect-dialog";
import { WORK_STATE_COLORS, WORK_STATE_LABELS } from "@/components/features/work-spend-ui";
import type { WorkLifecycle, WorkSpendDistribution, WorkSpendPayload } from "@/components/features/work-spend-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_PROJECTS = 6;
const SEGMENTS: Array<{ key: WorkLifecycle; field: "shippedMicros" | "inFlightMicros" | "stalledMicros" }> = [
  { key: "shipped", field: "shippedMicros" },
  { key: "in_flight", field: "inFlightMicros" },
  { key: "stalled", field: "stalledMicros" },
];

type ChartRow = {
  id: string;
  title: string;
  workCount: number | null;
  total: string;
  shippedMicros: string;
  inFlightMicros: string;
  stalledMicros: string;
  muted?: boolean;
};

function toRow(project: WorkSpendDistribution["projects"][number]): ChartRow {
  return {
    id: project.id,
    title: project.title,
    workCount: project.workCount,
    total: (BigInt(project.verifiedMicros) + BigInt(project.estimatedMicros)).toString(),
    shippedMicros: project.shippedMicros,
    inFlightMicros: project.inFlightMicros,
    stalledMicros: project.stalledMicros,
  };
}

export function WorkSpendProjects({
  data,
  selectedProjectId,
  selectedWorkState,
  onSelect,
  onOpen,
}: {
  data: WorkSpendPayload;
  selectedProjectId: string | null;
  selectedWorkState: WorkLifecycle | null;
  onSelect: (projectId: string | null, workState: WorkLifecycle | null) => void;
  onOpen: (projectId: string) => void;
}) {
  const query = useAppQuery<WorkSpendDistribution>(
    ["app", "work-spend-distribution", data.days],
    `/api/app/work-spend/distribution?days=${data.days}`,
    { enabled: data.projects.selected.length > 0 },
  );
  const needsAccess = ["permission_required", "partial"].includes(data.projects.state);
  const connected = data.projects.selected.length > 0;
  const approveUrl = data.connections.find((row) => row.accountType === "Organization")?.approveUrl ?? data.connection.approveUrl;

  const rows: ChartRow[] = [];
  if (query.data) {
    for (const project of query.data.projects.slice(0, MAX_PROJECTS)) rows.push(toRow(project));
    if (BigInt(query.data.withoutProjectMicros) > 0n) {
      rows.push({
        id: "__none__",
        title: "Not on a project",
        workCount: null,
        total: query.data.withoutProjectMicros,
        shippedMicros: query.data.withoutShippedMicros,
        inFlightMicros: query.data.withoutInFlightMicros,
        stalledMicros: query.data.withoutStalledMicros,
        muted: true,
      });
    }
  }
  const overlap = query.data && BigInt(query.data.overlappingMicros) > 0n ? query.data.overlappingMicros : null;

  return (
    <section aria-label="Spend by project" className="min-w-0">
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Spend by project.</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">Every board's AI cost, split by whether the work merged, is still open, or is not moving. Select an amount to filter.</p>
        </div>
        <GitHubProjectsBadge />
      </div>
      {!connected ? (
        <div className="border bg-muted/30 px-4 py-5">
          <p className="text-sm font-medium">Connect GitHub Projects to see where spend landed.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.projects.state === "personal_account"
              ? "Organization Projects need a GitHub organization installation."
              : needsAccess
                ? "Projects read access needs approval. Repository work is still available."
                : "Board names and item status sit next to the work they match."}
          </p>
          <div className="mt-3">
            <ProjectToolConnectDialog approveUrl={approveUrl} appPermissionsUrl={data.connection.appPermissionsUrl}>
              <Button type="button" variant="outline" size="sm" className="rounded-none">
                <GitHubProjectsButtonLabel>{needsAccess ? "Review GitHub Projects access" : "Connect GitHub Projects"}</GitHubProjectsButtonLabel>
              </Button>
            </ProjectToolConnectDialog>
          </div>
        </div>
      ) : query.isPending ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">Loading project spend…</p>
      ) : query.error ? (
        <p role="alert" className="py-8 text-sm text-destructive">Couldn’t load spend by project. <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Retry</Button></p>
      ) : !rows.length ? (
        <p className="py-8 text-sm text-muted-foreground">No project spend in this period. Sync GitHub Projects after work lands on a board.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <caption className="sr-only">AI cost by project board, split by work outcome. Select an amount to filter the work list.</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-2 pr-3 text-left font-medium">Project</th>
                {SEGMENTS.map((segment) => (
                  <th key={segment.key} scope="col" className="whitespace-nowrap pb-2 pl-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span className="size-2 shrink-0" style={{ background: WORK_STATE_COLORS[segment.key] }} aria-hidden />
                      {WORK_STATE_LABELS[segment.key]}
                    </span>
                  </th>
                ))}
                <th scope="col" className="whitespace-nowrap pb-2 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const totalActive = selectedProjectId === row.id && !selectedWorkState;
                return (
                  <tr key={row.id} className="border-t border-border/60">
                    <th scope="row" className="min-w-0 py-3 pr-3 text-left align-top">
                      {row.muted ? (
                        <p className="truncate font-medium text-muted-foreground">{row.title}</p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpen(row.id)}
                          className="block w-full truncate text-left font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring"
                        >
                          {row.title}
                        </button>
                      )}
                      <p className="mt-0.5 text-[0.7rem] font-normal text-muted-foreground">
                        {row.muted ? "Outside the selected boards" : `GitHub Project · ${row.workCount ?? 0} ${(row.workCount ?? 0) === 1 ? "item" : "items"}`}
                      </p>
                    </th>
                    {SEGMENTS.map((segment) => {
                      const value = row[segment.field];
                      if (BigInt(value) <= 0n) return <td key={segment.key} className="whitespace-nowrap py-3 pl-3 text-right tabular-nums text-muted-foreground/50">—</td>;
                      const active = selectedProjectId === row.id && selectedWorkState === segment.key;
                      return (
                        <td key={segment.key} className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">
                          <button
                            type="button"
                            aria-pressed={active}
                            aria-label={`${row.title} · ${WORK_STATE_LABELS[segment.key]} · ${formatMicrosAsCurrency(value)}`}
                            onClick={() => onSelect(active ? null : row.id, active ? null : segment.key)}
                            className={cn("underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring", active && "bg-muted/60 font-semibold")}
                          >
                            {formatMicrosAsCurrency(value)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap py-3 pl-3 text-right font-semibold tabular-nums">
                      <button
                        type="button"
                        aria-pressed={totalActive}
                        aria-label={`${row.title} · Total · ${formatMicrosAsCurrency(row.total)}`}
                        onClick={() => onSelect(totalActive ? null : row.id, null)}
                        className={cn("underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring", totalActive && "bg-muted/60")}
                      >
                        {formatMicrosAsCurrency(row.total)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <th scope="row" className="py-3 pr-3 text-left">Listed boards</th>
                {SEGMENTS.map((segment) => (
                  <td key={segment.key} className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">
                    {formatMicrosAsCurrency(rows.reduce((sum, row) => sum + BigInt(row[segment.field]), 0n).toString())}
                  </td>
                ))}
                <td className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">
                  {formatMicrosAsCurrency(rows.reduce((sum, row) => sum + BigInt(row.total), 0n).toString())}
                </td>
              </tr>
            </tfoot>
          </table>
          {overlap ? (
            <p className="mt-3 text-xs text-muted-foreground">The same work can sit on two projects, so these rows can add up to more than spend on work ({formatMicrosAsCurrency(overlap)} on more than one project).</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
