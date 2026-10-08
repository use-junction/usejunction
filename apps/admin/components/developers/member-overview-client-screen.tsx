"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import { MemberPlanBoard } from "@/components/developers/member-plan-board";
import { MemberWorkSessionList } from "@/components/developers/member-work-session-list";
import { SignalsKpi } from "@/components/signals/signals-ui";
import { useMemberClientData } from "@/components/developers/member-client-layout";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { buildMemberPlanBoard, planBoardLeadLabel } from "@/lib/quotas/plan-board";
import type { WorkActivitySession } from "@/lib/signals/queries/get-work-activity";
import { canonicalToolKey, toolDisplayName } from "@/lib/tools/catalog";
import { signalsProductEnabled } from "@/lib/region";

export default function MemberOverviewClientScreen() {
  const searchParams = useSearchParams();
  const { developerId, personal, selectedPeriodLabel, cycleView, work, workExtractionEnabled, toolsUsedLast30d } =
    useMemberClientData();
  const usedTools = new Set(toolsUsedLast30d ?? []);
  const workData = work ?? { enabled: false, sessions: [] };
  const recentWorkSessions = workData.sessions.slice(0, 4);
  const queryString = searchParams.toString();
  const periodQs = queryString ? `?${queryString}` : "";

  const inputTokens = Number(BigInt(personal.usage30d.inputTokens));
  const outputTokens = Number(BigInt(personal.usage30d.outputTokens));
  const cacheTokens =
    Number(BigInt(personal.usage30d.cacheReadTokens)) +
    Number(BigInt(personal.usage30d.cacheWriteTokens));
  const tokens = inputTokens + outputTokens;
  const verified = personal.usage30d.verifiedUsageCost;
  const estimated = personal.usage30d.estimatedApiCost;

  const accounts = personal.developer.devices.flatMap((device) => device.accounts);
  const quotaSnapshots = personal.developer.devices.flatMap((device) =>
    device.quotas.map((quota) => ({
      toolName: quota.toolName,
      windowType: quota.windowType,
      usedPercent: quota.usedPercent,
      creditsRemaining: quota.creditsRemaining,
      resetAt: quota.resetAt,
      source: quota.source,
      updatedAt: quota.updatedAt,
      developerId,
    })),
  );
  const planCards = buildMemberPlanBoard({
    snapshots: quotaSnapshots,
    accounts,
    vendorSeats: personal.developer.vendorSeats,
    toolsUsage: personal.toolsUsage30d,
    planSeats: personal.planSeats,
    cycleView,
  });
  const planKpi = planBoardLeadLabel(planCards);

  const workSessionsByTool: Record<string, WorkActivitySession[]> = {};
  for (const session of workData.sessions) {
    const key = canonicalToolKey(session.toolName) || session.toolName;
    const list = workSessionsByTool[key] ?? [];
    list.push(session);
    workSessionsByTool[key] = list;
  }

  return (
    <>
      <div className="grid items-stretch gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <SignalsKpi
          label="Verified usage"
          value={formatUsd(verified)}
          sub={selectedPeriodLabel}
          className="pl-4"
        />
        <SignalsKpi
          label="Estimated API value"
          value={formatUsd(estimated)}
          sub="when vendor cost is missing"
          className="border-l border-border pl-8"
        />
        <SignalsKpi
          label="Tokens"
          value={formatCompactNumber(tokens)}
          sub={`in ${formatCompactNumber(inputTokens)} · out ${formatCompactNumber(outputTokens)} · cache ${formatCompactNumber(cacheTokens)}`}
          accent
          className="pl-8"
        />
        <SignalsKpi
          label="Plan pace"
          value={planKpi.value}
          sub={planKpi.sub}
          className="border-l border-border pl-8"
        />
      </div>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Seats.</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paid seats assigned to {personal.developer.name} · use in the last 30 days, the same window as Cost.
          </p>
        </div>
        {personal.planSeats.length ? (
          <ul className="divide-y divide-border border-y border-border">
            {personal.planSeats.map((seat, index) => {
              const used = usedTools.has(seat.toolKey);
              return (
                <li key={`${seat.toolKey}-${seat.planName}-${index}`}>
                  <Link
                    href={`/tools/${encodeURIComponent(seat.toolKey)}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm transition-colors hover:bg-muted/30"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ToolBrandIcon tool={seat.toolKey} size={18} />
                      <span className="min-w-0">
                        <span className="block font-medium">{toolDisplayName(seat.toolKey)}</span>
                        <span className="block text-xs text-muted-foreground">{seat.planName}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-4">
                      <span className={used ? "text-xs text-muted-foreground" : "text-xs font-medium text-warning"}>
                        {used ? "Used in the last 30 days" : "No use in 30 days"}
                      </span>
                      <span className="tabular-nums">
                        {seat.monthlySeatCost > 0 ? `${formatUsd(seat.monthlySeatCost)}/mo` : "Free"}
                      </span>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border p-4 text-sm text-muted-foreground">
            No paid seats assigned. Assign one from a tool&apos;s page under Cost.
          </p>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Plans.</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Billing cycle, accounted usage, and burn pace by product · {selectedPeriodLabel}.
          </p>
        </div>
        {planCards.length ? (
          <MemberPlanBoard cards={planCards} workSessionsByTool={workSessionsByTool} />
        ) : (
          <p className="border p-4 text-sm text-muted-foreground">
            No plan limits or tool usage reported in this period yet.
          </p>
        )}
      </section>

      {signalsProductEnabled() ? (
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Recent work.</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              What AI is being used for · {selectedPeriodLabel} · no prompts.
            </p>
          </div>
          <Link
            href={`/team/${developerId}/work${periodQs}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            All work
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
        {workExtractionEnabled ? (
          <MemberWorkSessionList
            sessions={recentWorkSessions}
            emptyMessage="No extracted work sessions in this period."
            maxHeightClass="max-h-none"
            density="teaser"
            fromTeam
          />
        ) : (
          <p className="border p-4 text-sm text-muted-foreground">Work extraction is off.</p>
        )}
      </section>
      ) : null}
    </>
  );
}
