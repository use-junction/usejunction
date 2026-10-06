"use client";

import * as React from "react";
import { ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { MemberWorkSessionList } from "@/components/developers/member-work-session-list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { billingCadenceLabel } from "@/lib/billing/cycles";
import { paceVerdictLabel, type QuotaPaceCode } from "@/lib/quotas/pace";
import type {
  MemberPlanBillingCycle,
  MemberPlanBoardCard,
  MemberPlanWindow,
} from "@/lib/quotas/plan-board";
import type { WorkActivitySession } from "@/lib/signals/queries/get-work-activity";
import { formatCompactNumber, formatRelativeTime, formatShortDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { signalsProductEnabled } from "@/lib/region";

function toneForPace(code: QuotaPaceCode) {
  switch (code) {
    case "EXCESS":
    case "ALREADY_EXCEEDED":
      return "text-destructive";
    case "ON_TRACK":
      return "text-primary";
    case "UNDER":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function barTone(code: QuotaPaceCode, usedPercent: number | null) {
  if (usedPercent != null && usedPercent >= 100) return "bg-destructive";
  if (code === "EXCESS" || code === "ALREADY_EXCEEDED") return "bg-destructive";
  if (code === "ON_TRACK") return "bg-primary";
  if (code === "UNKNOWN") return "bg-muted-foreground/35";
  return "bg-foreground/70";
}

function resetShortDate(window: MemberPlanWindow): string | null {
  if (!window.resetsAt) return null;
  const label = formatShortDate(window.resetsAt);
  return label === "unknown" ? null : label;
}

function billingCycleLabel(cycle: MemberPlanBillingCycle | null): string | null {
  if (!cycle) return null;
  const start = formatShortDate(cycle.cycleStart);
  const end = formatShortDate(cycle.cycleEnd);
  if (start === "unknown" || end === "unknown") return null;
  return `${start} – ${end}`;
}

function billingCycleDetail(cycle: MemberPlanBillingCycle | null): string | null {
  if (!cycle) return null;
  const range = billingCycleLabel(cycle);
  if (!range) return null;
  const cadence = billingCadenceLabel(cycle.billingCadence, cycle.totalDays);
  return `${cadence} · ${range}`;
}

function windowUsageLabel(window: MemberPlanWindow): string {
  const used = window.usedPercent;
  const reset = resetShortDate(window);
  if (used == null) return reset ?? "—";
  const percent = `${Math.round(used)}%`;
  return reset ? `${percent} ${reset}` : percent;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground/80">{label}</p>
      <p className="mt-0.5 text-sm tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function TokenBreakdown({
  input,
  output,
  cache,
}: {
  input: number;
  output: number;
  cache: number;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground/80">
        Tokens
      </p>
      <p className="mt-0.5 text-sm tabular-nums text-foreground">
        {formatCompactNumber(input + output)}
      </p>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        in {formatCompactNumber(input)} · out {formatCompactNumber(output)} · cache{" "}
        {formatCompactNumber(cache)}
      </p>
    </div>
  );
}

function AccountedUsageStats({
  usage,
}: {
  usage: NonNullable<MemberPlanBoardCard["usage"]>;
}) {
  const verified = usage.verifiedUsageCost;
  const estimated = usage.estimatedApiCost;
  if (verified <= 0 && estimated <= 0) return null;

  return (
    <>
      <Stat
        label="Accounted"
        value={verified > 0 ? formatUsd(verified) : "$0.00"}
      />
      {estimated > 0 ? <Stat label="Estimated" value={formatUsd(estimated)} /> : null}
    </>
  );
}

function WindowMeter({
  window,
  code,
  summary,
}: {
  window: MemberPlanWindow;
  code: QuotaPaceCode;
  summary?: string | null;
}) {
  const used = window.usedPercent;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{window.windowLabel}</p>
        <p className={cn("text-sm font-semibold tabular-nums", toneForPace(code))}>
          {windowUsageLabel(window)}
        </p>
      </div>
      <div className="mt-2 h-1.5 w-full bg-muted">
        <div
          className={cn("h-full", barTone(code, used))}
          style={{ width: `${used != null ? Math.min(100, Math.max(2, used)) : 0}%` }}
        />
      </div>
      {summary ? <p className="mt-1.5 text-xs text-muted-foreground">{summary}</p> : null}
    </div>
  );
}

function PlanCardButton({
  card,
  workSessions,
}: {
  card: MemberPlanBoardCard;
  workSessions: WorkActivitySession[];
}) {
  const [open, setOpen] = React.useState(false);
  const used = card.pace.usedPercent;
  const expected = card.pace.expectedPercent;
  const width = used == null ? 0 : Math.min(100, Math.max(2, used));
  const mark = expected == null ? null : Math.min(100, Math.max(0, expected));
  const cycleRange = billingCycleLabel(card.billingCycle);
  const cycleDetail = billingCycleDetail(card.billingCycle);
  const tokens = card.usage?.tokens ?? 0;
  const cacheTokens = (card.usage?.cacheReadTokens ?? 0) + (card.usage?.cacheWriteTokens ?? 0);
  const hasAccounted =
    card.usage != null &&
    (card.usage.verifiedUsageCost > 0 || card.usage.estimatedApiCost > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-card p-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ToolLogoTile tool={card.toolName} size="md" light className="shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">{card.toolLabel}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {card.planName || card.primary?.windowLabel || "Plan"}
              </p>
              {cycleDetail ? (
                <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">
                  {cycleDetail}
                </p>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn("text-2xl font-semibold tabular-nums", toneForPace(card.pace.code))}>
              {used != null ? `${Math.round(used)}%` : "—"}
            </p>
            {cycleRange ? (
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{cycleRange}</p>
            ) : null}
            <p className={cn("mt-0.5 text-[0.7rem] font-medium", toneForPace(card.pace.code))}>
              {paceVerdictLabel(card.pace.code)}
            </p>
          </div>
        </div>

        {used != null ? (
          <div className="relative mt-4 h-1.5 w-full bg-muted">
            <div
              className={cn("h-full transition-[width]", barTone(card.pace.code, used))}
              style={{ width: `${width}%` }}
            />
            {mark != null ? (
              <span
                aria-hidden
                className="absolute top-[-2px] h-[calc(100%+4px)] w-px bg-foreground/45"
                style={{ left: `${mark}%` }}
              />
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
          {card.usage && (tokens > 0 || cacheTokens > 0) ? (
            <TokenBreakdown
              input={card.usage.inputTokens}
              output={card.usage.outputTokens}
              cache={cacheTokens}
            />
          ) : null}
          {hasAccounted && card.usage ? <AccountedUsageStats usage={card.usage} /> : null}
          {card.promotions.map((promo) => (
            <Stat
              key={promo.quotaKey}
              label={promo.windowLabel}
              value={promo.remainingLabel ?? promo.signal}
            />
          ))}
        </div>
      </button>

      <DialogContent className="max-h-[calc(100vh-2rem)] min-w-0 max-w-2xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ToolLogoTile tool={card.toolName} size="md" light />
            <div>
              <DialogTitle className="text-lg">{card.toolLabel}</DialogTitle>
              <DialogDescription>
                {[card.planName, card.primary?.windowLabel, cycleDetail]
                  .filter(Boolean)
                  .join(" · ") || "Plan usage and recent work"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            {card.primary ? (
              <WindowMeter window={card.primary} code={card.pace.code} summary={card.pace.summary} />
            ) : (
              <p className="text-sm text-muted-foreground">No live plan window reported.</p>
            )}
            {card.otherWindows
              .filter((window) => window.usedPercent != null)
              .map((window) => (
                <WindowMeter key={window.quotaKey} window={window} code="ON_TRACK" />
              ))}
          </section>

          <section className="flex flex-wrap gap-x-8 gap-y-4">
            {card.usage && (tokens > 0 || cacheTokens > 0) ? (
              <TokenBreakdown
                input={card.usage.inputTokens}
                output={card.usage.outputTokens}
                cache={cacheTokens}
              />
            ) : null}
            {hasAccounted && card.usage ? <AccountedUsageStats usage={card.usage} /> : null}
            {card.usage && card.usage.requests > 0 ? (
              <Stat label="Calls" value={formatCompactNumber(card.usage.requests)} />
            ) : null}
            {card.promotions.map((promo) => (
              <Stat
                key={promo.quotaKey}
                label={promo.windowLabel}
                value={promo.remainingLabel ?? promo.signal}
              />
            ))}
          </section>

          {card.quotaSyncedAt ? (
            <p className="text-xs text-muted-foreground">
              Quota synced {formatRelativeTime(card.quotaSyncedAt)}
            </p>
          ) : null}

          {signalsProductEnabled() ? (
          <section className="min-w-0">
            <p className="mb-3 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
              Recent work
            </p>
            {workSessions.length ? (
              <MemberWorkSessionList
                sessions={workSessions.slice(0, 12)}
                emptyMessage="No extracted work in this period."
                maxHeightClass="max-h-[22rem]"
                density="teaser"
                fromTeam
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No extracted work for {card.toolLabel} in this period.
              </p>
            )}
          </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MemberPlanBoard({
  cards,
  workSessionsByTool,
}: {
  cards: MemberPlanBoardCard[];
  workSessionsByTool?: Record<string, WorkActivitySession[]>;
}) {
  if (!cards.length) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {cards.map((card) => (
        <PlanCardButton
          key={card.toolKey}
          card={card}
          workSessions={workSessionsByTool?.[card.toolKey] ?? []}
        />
      ))}
    </div>
  );
}
