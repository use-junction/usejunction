import { cn } from "@/lib/utils";
import type { WorkLifecycle } from "@/components/features/work-spend-types";

const labels: Record<string, string> = {
  shipped: "MERGED",
  in_flight: "OPEN",
  stalled: "NOT MOVING",
  merged: "MERGED",
  open: "OPEN",
  closed: "CLOSED",
};

const dots: Record<string, string> = {
  shipped: "bg-primary",
  in_flight: "bg-brand-yellow-dark",
  stalled: "bg-brand-orange",
  merged: "bg-primary",
  open: "bg-brand-yellow-dark",
  closed: "bg-muted-foreground",
};

export function workStateFromPr(state: string | null | undefined, workState?: WorkLifecycle | null, activityAt?: string | null): WorkLifecycle {
  if (workState) return workState;
  const value = state?.toLowerCase() ?? "";
  if (value === "merged") return "shipped";
  if (value === "closed") return "stalled";
  if (activityAt && Date.now() - new Date(activityAt).getTime() > 14 * 86_400_000) return "stalled";
  return "in_flight";
}

export function StateChip({ state, workState, activityAt }: { state?: string | null; workState?: WorkLifecycle | null; activityAt?: string | null }) {
  const lifecycle = workStateFromPr(state, workState, activityAt);
  const key = lifecycle;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", dots[key] ?? "bg-muted-foreground")} aria-hidden />
      {labels[key] ?? labels[state?.toLowerCase() ?? ""] ?? "OPEN"}
    </span>
  );
}
