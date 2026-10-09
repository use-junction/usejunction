"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { barColorForVerdict } from "@/components/dashboard/cycle-utilization-bar";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import { formatShortDate, formatUsd } from "@/lib/format";
import { canonicalToolKey, findCatalogTool, toolDisplayName } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";
import type { OrgOverviewV1 } from "@/lib/insights";
import type { PlanVerdictCode } from "@/lib/billing/plan-utilization-policy";
import { verdictLabel, verdictToneClass } from "@/lib/billing/plan-utilization-policy";
import { IDLE_CYCLE_LABEL, isIdlePaidCycle } from "@/lib/dashboard/idle-cycles";

type CycleRow = OrgOverviewV1["subscriptionCycles"][number];

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function allowanceLabel(code: PlanVerdictCode | null) {
  if (code == null || code === "UNKNOWN") return null;
  return verdictLabel(code);
}

function cycleBoundsLabel(row: CycleRow) {
  const start = formatShortDate(row.billingCycle.cycleStart);
  const end = formatShortDate(row.billingCycle.cycleEnd);
  return `${start} – ${end}`;
}

function AccountedCost({
  verified,
  estimated,
}: {
  verified: number;
  estimated: number;
}) {
  if (verified <= 0 && estimated <= 0) {
    return <p className="text-sm font-semibold tabular-nums">—</p>;
  }

  return (
    <div className="text-right">
      <p className="text-sm font-semibold tabular-nums">
        {formatUsd(verified)}
      </p>
      <p className="mt-0.5 text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
        Accounted
      </p>
      {estimated > 0 ? (
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          Est. {formatUsd(estimated)}
        </p>
      ) : null}
    </div>
  );
}

export function CoverageVsNeedSection({
  cycles,
  cycleWindowLabel,
  billingSeatLabel,
}: {
  cycles: CycleRow[];
  cycleWindowLabel: (row: CycleRow) => string;
  billingSeatLabel: (cycleSpend: number) => string;
}) {
  const rows = useMemo(
    () =>
      [...cycles]
        .map((row) => {
          const toolKey = canonicalToolKey(row.toolKey ?? row.toolName);
          const consumed = row.utilizationPercent;
          const display =
            row.utilizationDisplayPercent != null
              ? clampPercent(row.utilizationDisplayPercent)
              : consumed != null
                ? clampPercent(consumed)
                : null;
          return {
            row,
            toolKey,
            color: barColorForVerdict(row.verdictCode),
            consumed,
            display,
            label: toolDisplayName(toolKey),
            href: findCatalogTool(toolKey) ? `/tools/${toolKey}` : null,
            allowance: allowanceLabel(row.verdictCode),
            idle: isIdlePaidCycle(row),
          };
        })
        .sort((a, b) => (b.consumed ?? -1) - (a.consumed ?? -1)),
    [cycles],
  );

  if (!cycles.length) return null;

  return (
    <ul className="divide-y divide-border">
      {rows.map(({ row, toolKey, color, consumed, display, label, href, allowance, idle }) => {
        const known = consumed != null && display != null;
        const body = (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ToolBrandIcon tool={toolKey} size={20} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {cycleWindowLabel(row)}
                    {row.cycleSpend > 0 ? ` · ${billingSeatLabel(row.cycleSpend)}` : null}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-1.5">
                <AccountedCost
                  verified={row.verifiedUsageCost}
                  estimated={row.estimatedApiCost}
                />
                {href ? (
                  <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </div>
            </div>

            {known ? (
              <div className="mt-2">
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.7rem] leading-snug text-muted-foreground">
                  <span>
                    <span className="font-medium tabular-nums text-foreground">
                      {Math.round(consumed)}%
                    </span>{" "}
                    consumed
                  </span>
                  <span className="tabular-nums">{cycleBoundsLabel(row)}</span>
                </div>
                <div
                  className="h-3.5 w-full overflow-hidden bg-muted"
                  role="img"
                  aria-label={`${label}: ${Math.round(consumed)}% consumed`}
                >
                  {display > 0 ? (
                    <div
                      className="h-full"
                      style={{ width: `${display}%`, backgroundColor: color }}
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No plan-quota signal yet — consumed % appears after usage limits report.
              </p>
            )}

            {idle ? (
              <div className="mt-1.5 flex justify-end">
                <p className="text-xs font-medium text-warning">{IDLE_CYCLE_LABEL} · paid seat idle</p>
              </div>
            ) : allowance ? (
              <div className="mt-1.5 flex justify-end">
                <p className={cn("text-xs font-medium", verdictToneClass(row.verdictCode ?? "UNKNOWN"))}>
                  {allowance}
                </p>
              </div>
            ) : null}
          </>
        );

        return (
          <li key={row.id}>
            {href ? (
              <Link
                href={href}
                prefetch={false}
                className="block py-3 transition-colors hover:bg-muted/30"
              >
                {body}
              </Link>
            ) : (
              <div className="py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
