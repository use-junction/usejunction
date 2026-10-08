import { verdictLabel, verdictToneClass, type PlanVerdict, type PlanVerdictCode } from "@/lib/billing/plan-utilization-policy";
import { ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { cn } from "@/lib/utils";

export type RosterPlanUsagePlan = {
  toolName: string;
  toolKey: string | null;
  planName: string;
  primaryRatio: number | null;
  verdict: PlanVerdict;
};

function barTone(ratio: number | null, code: PlanVerdictCode) {
  if (ratio == null) return "bg-muted";
  if (code === "LIMIT_EXCEEDED") return "bg-destructive";
  if (code === "NEAR_LIMIT") return "bg-warning";
  if (code === "LIGHT_USE") return "bg-primary/50";
  return "bg-primary/80";
}

const VERDICT_RANK: Record<PlanVerdictCode, number> = {
  LIMIT_EXCEEDED: 5,
  NEAR_LIMIT: 4,
  DATA_STALE: 3,
  UNKNOWN: 2,
  LIGHT_USE: 1,
  HEALTHY: 0,
};

export function aggregateRosterPlanUsage(plans: RosterPlanUsagePlan[]) {
  const withSignal = plans.filter((plan) => plan.primaryRatio != null);
  const avgRatio =
    withSignal.length > 0
      ? withSignal.reduce((sum, plan) => sum + (plan.primaryRatio ?? 0), 0) / withSignal.length
      : null;
  const verdict =
    plans.reduce<RosterPlanUsagePlan | null>((worst, plan) => {
      if (!worst) return plan;
      return VERDICT_RANK[plan.verdict.code] > VERDICT_RANK[worst.verdict.code] ? plan : worst;
    }, null)?.verdict ?? plans[0]?.verdict;

  return { avgRatio, verdict, withSignal };
}

export function RosterPlanUsage({ plans }: { plans: RosterPlanUsagePlan[] }) {
  if (!plans.length) return null;

  const { avgRatio, verdict, withSignal } = aggregateRosterPlanUsage(plans);
  const avgPercent = avgRatio != null ? avgRatio * 100 : null;
  // "Within allowance" at 0% reads as fine; for a paid seat it means nobody used it.
  const unused = withSignal.length > 0 && withSignal.every((plan) => (plan.primaryRatio ?? 0) <= 0);
  const statusLabel = unused ? "No use yet" : verdict ? verdictLabel(verdict.code) : null;
  const meterLabel =
    avgPercent != null
      ? `Average plan use ${avgPercent.toFixed(0)} percent${statusLabel ? `, ${statusLabel}` : ""}`
      : "Plan use waiting for quota signal";

  const aggregatePercent =
    avgPercent != null && !unused ? Math.min(100, Math.max(4, avgPercent)) : 0;

  return (
    <div className="mt-2.5 max-w-md">
      <div className="flex items-center gap-3">
        <div
          className="h-1.5 min-w-0 flex-1 overflow-hidden bg-muted"
          role="meter"
          aria-label={meterLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={avgPercent != null ? Math.round(avgPercent) : undefined}
          title={meterLabel}
        >
          <div
            className={cn(
              "h-full transition-[width]",
              barTone(avgRatio, verdict?.code ?? "UNKNOWN"),
            )}
            style={{ width: `${aggregatePercent}%` }}
          />
        </div>
        {avgPercent != null ? (
          <p className={cn("shrink-0 text-xs font-semibold tabular-nums", unused ? "text-warning" : verdictToneClass(verdict?.code ?? "UNKNOWN"))}>
            {avgPercent.toFixed(0)}%
          </p>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {withSignal.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Plan use · avg across {withSignal.length} {withSignal.length === 1 ? "plan" : "plans"}
            {unused ? (
              <>
                {" · "}
                <span className="font-medium text-warning">{statusLabel}</span>
              </>
            ) : statusLabel ? ` · ${statusLabel}` : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Plan use · waiting for quota signal</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {plans.map((plan) => (
            <span
              key={`${plan.toolName}-${plan.planName}-chip`}
              className="inline-flex items-center gap-1 rounded-sm bg-muted/60 py-0.5 pr-1.5 pl-0.5 text-[0.65rem] text-muted-foreground"
              title={plan.planName}
            >
              <ToolLogoTile
                tool={plan.toolKey ?? plan.toolName}
                size="sm"
                className="size-4 border-0 shadow-none"
              />
              {plan.primaryRatio != null ? `${(plan.primaryRatio * 100).toFixed(0)}%` : "—"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
