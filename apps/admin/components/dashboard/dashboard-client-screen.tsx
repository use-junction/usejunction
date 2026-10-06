"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowUpRight, Info } from "lucide-react";
import { ConnectMachineBanner } from "@/components/dashboard/connect-machine-banner";
import { ConnectionRepairBanner } from "@/components/dashboard/connection-repair-banner";
import { CycleUtilizationBar } from "@/components/dashboard/cycle-utilization-bar";
import { CycleViewPicker } from "@/components/dashboard/cycle-view-picker";
import { LocalSyncPanel } from "@/components/dashboard/local-sync-panel";
import { DashboardSetupPanel } from "@/components/dashboard/setup-panel";
import { TopModelsPanel } from "@/components/dashboard/top-models-panel";
import { AudienceScopeSwitcher } from "@/components/audience-scope-switcher";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { AudienceScope } from "@/lib/audience-scope";
import {
  verdictLabel,
  verdictToneClass,
  type PlanVerdictCode,
} from "@/lib/billing/plan-utilization-policy";
import {
  rollingPeriodLabel,
  DEFAULT_ROLLING_PERIOD,
  type RollingPeriod,
} from "@/lib/dashboard/period-prefs";
import {
  cycleViewPeriodLabel,
  type CycleView,
  type CycleViewWindows,
} from "@/lib/dashboard/cycle-view";
import { usageCostBreakdownSub } from "@/lib/dashboard/usage-cost-breakdown";
import { personalPlanCardsToCycles } from "@/lib/dashboard/personal-cycles";
import { buildMemberPlanBoard } from "@/lib/quotas/plan-board";
import { usageWindowFamily } from "@/lib/quotas/usage-window";
import { canonicalToolKey, toolDisplayName } from "@/lib/tools/catalog";
import { formatCompactNumber, formatShortDate, formatUsd } from "@/lib/format";
import { billingCadenceLabel } from "@/lib/billing/cycles";
import { cn } from "@/lib/utils";
import type { OrgOverviewV1 } from "@/lib/insights";
import { billingSeatLabel, estimatedUsageLabel, estimatedUsageWindowTooltip } from "@/lib/insights/billing-copy";
import type { getMeOverview } from "@/lib/queries/me/overview";
import type { RemoteSyncPanelContext } from "@/lib/sync/remote-sync-context";
import { useAppPageQuery, useAppQuery } from "@/lib/api/client";
import { dashboardKey, dashboardMetricsKey, dashboardShellKey, workspaceContextKey } from "@/lib/app-pages/query-keys";
import type { WorkspaceContextPayload } from "@/lib/app-pages/workspace-context";
import { mergeOrgOverviewShellMetrics } from "@/lib/app-pages/dashboard-merge";
import type { OrgOverviewMetricsData, OrgOverviewShellData } from "@/lib/insights";
import { AppPageError, isBlockingAppQueryError, useAppQueryErrorToast, useErrorMessageToast } from "@/components/app-data-state";
import {
  DashboardPageLoading,
  DashboardPeriodRefreshing,
} from "@/components/dashboard/dashboard-period-refreshing";
import { SubscriptionUpgradedBanner } from "@/components/saas-billing/subscription-upgraded-banner";
import { ProviderAnalyticsPanel } from "@/components/dashboard/provider-analytics-panel";

const AiCodingPanel = dynamic(() => import("@/components/dashboard/ai-coding-panel").then((mod) => mod.AiCodingPanel), { ssr: false });
const OverviewChart = dynamic(() => import("@/components/dashboard/overview-chart").then((mod) => mod.OverviewChart), { ssr: false });
const ProjectedMonthlySpend = dynamic(
  () => import("@/components/dashboard/projected-monthly-spend").then((mod) => mod.ProjectedMonthlySpend),
  { ssr: false },
);
const CoverageVsNeedSection = dynamic(
  () =>
    import("@/components/dashboard/coverage-vs-need-section").then((mod) => mod.CoverageVsNeedSection),
  { ssr: false },
);

function Delta({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null) return null;
  const good = inverse ? value <= 0 : value >= 0;
  return (
    <span className={cn("text-xs font-medium tabular-nums", good ? "text-success" : "text-destructive")}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(0)}%
    </span>
  );
}

function formatPricePerMillionTokens(cost: number, tokens: number) {
  if (tokens <= 0) return "—";
  return formatUsd((cost * 1_000_000) / tokens);
}

function formatEstSpendPerDay(cost: number, rangeDays: number) {
  if (rangeDays <= 0) return "—";
  return formatUsd(cost / rangeDays);
}

function estSpendPerDayTooltip(view: CycleView) {
  const base = "Verified plus estimated usage divided by the number of days in this view.";
  if (view === "current_cycles") {
    return `${base} For current cycles, the day count is the union of each active plan's billing cycle — from the earliest cycle start to the latest cycle end — not the length of a single plan.`;
  }
  if (view === "previous_cycles") {
    return `${base} For previous cycles, the day count spans the same union across your plans' prior billing cycles.`;
  }
  return `${base} Uses the exact number of days in your selected date range.`;
}

function KpiInfoTooltip({ content }: { content: string }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="How this is calculated"
        >
          <Info className="size-3" strokeWidth={2.25} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function EstimatedUsageInfoTooltip({
  reportWindowLabel,
  usageWindow,
}: {
  reportWindowLabel: string;
  usageWindow: NonNullable<OrgOverviewV1["subscriptionCycles"][number]["usageWindow"]>;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground"
          aria-label={estimatedUsageLabel()}
        >
          <Info className="size-3" strokeWidth={2.25} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-64 text-xs leading-relaxed">
        {estimatedUsageWindowTooltip(usageWindow.label, reportWindowLabel)}
      </TooltipContent>
    </Tooltip>
  );
}

function hasDifferentUsageWindow(row: OrgOverviewV1["subscriptionCycles"][number], view: CycleView) {
  if (!row.usageWindow || view === "previous_cycles") return false;
  if (view === "last_30_days") return true;
  return usageWindowFamily(row.usageWindow.windowType) !== "monthly";
}

function verifiedEstimatedWindowSub(view: CycleView) {
  if (view === "last_30_days") return "verified + estimated · selected window";
  if (view === "previous_cycles") return "verified + estimated · previous cycles";
  return "verified + estimated · current cycles";
}

function Kpi({
  label,
  value,
  delta,
  inverse,
  accent,
  sub,
  hero,
  compactMobile,
  className,
  action,
}: {
  label: string;
  value: string;
  delta?: number | null;
  inverse?: boolean;
  accent?: boolean;
  sub?: string;
  hero?: boolean;
  compactMobile?: boolean;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <SignalsKpi
      label={label}
      value={value}
      sub={sub}
      hero={hero}
      accent={accent}
      compactMobile={compactMobile}
      className={className}
      action={action}
      footer={delta != null ? <Delta value={delta} inverse={inverse} /> : undefined}
    />
  );
}

const cycleViewLabels: Record<CycleView, string> = {
  current_cycles: "Current cycles",
  previous_cycles: "Previous cycles",
  last_30_days: "Last 30 days",
};

function sectionTitleForView(view: CycleView, period: RollingPeriod) {
  if (view === "last_30_days") return rollingPeriodLabel(period);
  return cycleViewLabels[view];
}


function orgCycleSummary(cycles: OrgOverviewV1["subscriptionCycles"]) {
  const withSignal = cycles.filter((row) => row.utilizationPercent != null);
  const avgUtilization =
    withSignal.length > 0
      ? withSignal.reduce((sum, row) => sum + (row.utilizationPercent ?? 0), 0) / withSignal.length
      : null;
  const nearLimit = cycles.filter((row) => row.verdictCode === "NEAR_LIMIT").length;
  const overQuota = cycles.filter((row) => row.verdictCode === "LIMIT_EXCEEDED").length;
  const withinAllowance = cycles.filter(
    (row) => row.verdictCode === "LIGHT_USE" || row.verdictCode === "HEALTHY",
  ).length;
  return { avgUtilization, nearLimit, overQuota, withinAllowance, withSignal: withSignal.length };
}

function fleetVerdictCode(cycles: OrgOverviewV1["subscriptionCycles"]): PlanVerdictCode | null {
  const { nearLimit, overQuota, withinAllowance, withSignal } = orgCycleSummary(cycles);
  if (withSignal === 0) return null;
  if (overQuota > 0) return "LIMIT_EXCEEDED";
  if (nearLimit > 0) return "NEAR_LIMIT";
  if (withinAllowance === withSignal) return "HEALTHY";
  return "HEALTHY";
}

function fleetStatusBadge(cycles: OrgOverviewV1["subscriptionCycles"]) {
  const { nearLimit, overQuota, withinAllowance, withSignal } = orgCycleSummary(cycles);
  if (withSignal === 0) return null;
  if (overQuota > 0) {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 font-normal text-destructive">
        {overQuota === withSignal ? "Over quota" : `${overQuota} over quota`}
      </Badge>
    );
  }
  if (nearLimit > 0) {
    return (
      <Badge
        variant="outline"
        className="border-warning/40 bg-warning/10 font-normal text-warning"
      >
        {nearLimit === 1 ? "1 near limit" : `${nearLimit} near limit`}
      </Badge>
    );
  }
  if (withinAllowance === withSignal) {
    return (
      <Badge variant="outline" className="border-primary/30 bg-primary/10 font-normal text-primary">
        Within allowance
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-primary/30 bg-primary/10 font-normal text-primary">
      On track
    </Badge>
  );
}

function CycleSectionHeader({
  view,
  period,
  cycles,
  bordered = false,
}: {
  view: CycleView;
  period: RollingPeriod;
  cycles: OrgOverviewV1["subscriptionCycles"];
  bordered?: boolean;
}) {
  const { avgUtilization } = orgCycleSummary(cycles);
  const title = sectionTitleForView(view, period);
  return (
    <div className={cn("mb-4", bordered && "border-b pb-4")}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}.</h2>
        <div className="ml-auto flex min-w-[12rem] max-w-sm flex-1 flex-wrap items-center justify-end gap-3">
          {avgUtilization != null ? (
            <CycleUtilizationBar
              percent={avgUtilization}
              displayPercent={Math.min(100, Math.max(0, avgUtilization))}
              verdictCode={fleetVerdictCode(cycles)}
              label={title}
              size="lg"
            />
          ) : null}
          {fleetStatusBadge(cycles)}
        </div>
      </div>
    </div>
  );
}

function cycleWindowLabel(row: OrgOverviewV1["subscriptionCycles"][number], view: CycleView) {
  const cadence = billingCadenceLabel(row.billingCadence, row.billingCycle.totalDays);
  const billed = `${formatShortDate(row.billingCycle.cycleStart)} – ${formatShortDate(row.billingCycle.cycleEnd)}`;
  const plan = row.planCount > 1 ? `${row.planCount} plans` : row.planNames[0] ?? "Plan";

  // Managers care what they are billed for — not usage-window internals.
  if (view === "current_cycles" || view === "previous_cycles") {
    return `${plan} · ${cadence} · ${billed}`;
  }
  if (view === "last_30_days") {
    return `${plan} · ${cadence} · ${formatShortDate(row.windowFrom)} – ${formatShortDate(row.windowTo)}`;
  }
  return billed;
}

function PersonalHome({
  data,
  audienceSwitcher,
  allowPeriodControls,
  cycleView,
  rollingPeriod,
  cycleWindows,
  refreshing = false,
}: {
  data: Awaited<ReturnType<typeof getMeOverview>>;
  audienceSwitcher?: ReactNode;
  allowPeriodControls: boolean;
  cycleView: CycleView;
  rollingPeriod: RollingPeriod;
  cycleWindows?: CycleViewWindows;
  refreshing?: boolean;
}) {
  const usage = data.usage30d;
  const usageCost = data.kpis.verifiedUsageCost + data.kpis.estimatedApiCost;
  const empty = !data.developer.devices.length;
  const accounts = data.developer.devices.flatMap((device) => device.accounts);
  const quotaSnapshots = data.developer.devices.flatMap((device) =>
    device.quotas.map((quota) => ({
      toolName: quota.toolName,
      deviceId: quota.deviceId,
      windowType: quota.windowType,
      usedPercent: quota.usedPercent,
      creditsRemaining: quota.creditsRemaining,
      resetAt: quota.resetAt,
      source: quota.source,
      updatedAt: quota.updatedAt,
      developerId: data.developer.id,
    })),
  );
  const planCards = buildMemberPlanBoard({
    snapshots: quotaSnapshots,
    accounts,
    vendorSeats: data.developer.vendorSeats,
    toolsUsage: data.toolsUsage30d,
    planSeats: data.planSeats,
    cycleView,
    usageWindowPreferences: data.developer.usageWindowPreferences,
    quotaHistory: data.developer.quotaHistory,
  });
  const seatCostByTool: Record<string, number> = {};
  for (const seat of data.planSeats) {
    const key = canonicalToolKey(seat.toolName) || seat.toolName;
    seatCostByTool[key] = (seatCostByTool[key] ?? 0) + (seat.cycleSeatCost ?? 0);
  }
  const personalCycles = personalPlanCardsToCycles(planCards, seatCostByTool);
  const topModels = data.modelUsage30d
    .filter((row) => row.metricKind === "usage" && row.requests > 0)
    .map((row) => ({
      toolName: row.toolName,
      model: row.model,
      requests: row.requests,
      tokens:
        row.inputTokens +
        row.outputTokens +
        row.cacheReadTokens +
        row.cacheWriteTokens +
        row.reasoningTokens,
      cost: row.cost,
    }));
  const periodLabel = cycleViewPeriodLabel(cycleView, rollingPeriod);

  return (
    <>
      <ConnectionRepairBanner scope="you" recoveryDevices={data.sync.recoveryDevices} />
      <ConnectMachineBanner show={empty} />
      <PageHeader
        title={empty ? "Nothing reporting yet." : "What's reporting?"}
        description={
          empty ? "Connect a machine to see your plans, usage, and traffic." : undefined
        }
        actions={
          !empty && allowPeriodControls ? (
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              <CycleViewPicker
                view={cycleView}
                period={rollingPeriod}
                basePath="/dashboard"
                cycleWindows={cycleWindows}
              />
              <LocalSyncPanel
                scope="you"
                compact
                lastSeenAt={data.sync.lastSeenAt}
                lastUsageSyncAt={data.sync.lastUsageSyncAt}
                lastAccountSyncAt={data.sync.lastAccountSyncAt}
                dashboardReady={data.sync.dashboardReady}
                dirtyDayCount={data.sync.dirtyDayCount}
                staleDeviceCount={data.sync.staleDeviceCount}
              />
            </div>
          ) : null
        }
      >
        {audienceSwitcher}
      </PageHeader>

      {empty ? (
        <DashboardSetupPanel canInvite={false} />
      ) : (
        <>
          <DashboardPeriodRefreshing refreshing={refreshing}>
            <>
          <div className="grid grid-cols-2 items-stretch gap-y-5 sm:gap-y-8 xl:grid-cols-4">
            <Kpi
              label="Subscription commitment"
              value={formatUsd(data.kpis.subscriptionCommitment)}
              hero
              accent
              compactMobile
              sub={
                cycleView === "last_30_days"
                  ? "your seats · selected window"
                  : cycleView === "previous_cycles"
                    ? "your seats · previous cycle"
                    : "your seats · current cycle"
              }
            />
            <Kpi
              label="Estimated usage"
              value={formatUsd(usageCost)}
              inverse
              compactMobile
              className="border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
              sub={usageCostBreakdownSub(usage.verifiedUsageCost, usage.estimatedApiCost)}
            />
            <Kpi
              label="Est. spend/day"
              value={formatEstSpendPerDay(usageCost, data.observation.rangeDays)}
              compactMobile
              className="border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
              sub={`${data.observation.rangeDays} days · ${periodLabel}`}
              action={<KpiInfoTooltip content={estSpendPerDayTooltip(cycleView)} />}
            />
            <Kpi
              label="Price per 1M tokens"
              value={formatPricePerMillionTokens(usageCost, data.kpis.tokens)}
              compactMobile
              className="border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
              sub={verifiedEstimatedWindowSub(cycleView)}
            />
          </div>

          <section className="mt-10">
            <div className="grid gap-4 xl:grid-cols-[7fr_3fr]">
              <Panel as="section" className="min-w-0">
                <CycleSectionHeader
                  view={cycleView}
                  period={rollingPeriod}
                  cycles={personalCycles}
                  bordered={false}
                />
                <p className="-mt-4 mb-3 text-xs text-muted-foreground">
                  Plan usage consumed per tool.
                </p>
                {personalCycles.length ? (
                  <CoverageVsNeedSection
                    cycles={personalCycles}
                    cycleWindowLabel={(row) => cycleWindowLabel(row, cycleView)}
                    billingSeatLabel={billingSeatLabel}
                  />
                ) : (
                  <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                    <EmptyDescription>No plan windows yet. Connect a machine to report quotas.</EmptyDescription>
                  </Empty>
                )}
              </Panel>

              <div className="relative min-h-0 max-xl:min-h-[22rem]">
                <Panel
                  as="section"
                  className="flex min-h-0 flex-col overflow-hidden max-xl:max-h-[28rem] xl:absolute xl:inset-0"
                >
                  <TopModelsPanel
                    models={topModels}
                    periodLabel={periodLabel}
                    audience="you"
                  />
                </Panel>
              </div>
            </div>
          </section>

          <Panel className="mt-10">
            <AiCodingPanel metrics={data.aiCoding30d} models={data.modelUsage30d} embedded />
          </Panel>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Panel as="section">
              <SignalsSectionHeader
                title="Device."
                bordered={false}
                action={
                  <Link href="/tools" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Tools
                  </Link>
                }
              />
              <ul>
                {data.developer.devices.map((device) => {
                  const toolCount = new Set(device.tools.map((tool) => canonicalToolKey(tool.toolName))).size;
                  return (
                    <li key={device.id} className="flex items-center justify-between gap-3 py-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{device.hostname}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {device.os} · {toolCount} {toolCount === 1 ? "tool" : "tools"}
                        </p>
                      </div>
                      <Badge variant="outline" className="font-mono text-[0.65rem] uppercase tracking-[0.08em]">
                        agent {device.agentVersion || "—"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel as="section">
              <SignalsSectionHeader title="Your tools." bordered={false} />
              {data.toolsUsage30d.length ? (
                <ul>
                  {data.toolsUsage30d.map((tool) => (
                    <li key={canonicalToolKey(tool.toolName)} className="flex items-center justify-between gap-3 py-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{toolDisplayName(tool.toolName)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tool.tokens > 0 ? `${formatCompactNumber(tool.tokens)} tokens` : "Detected on your machine"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium tabular-nums">{formatCompactNumber(tool.requests)}</p>
                        {tool.cost > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">{formatUsd(tool.cost)}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                  <EmptyDescription>No tools detected yet. Connect a machine to report inventory.</EmptyDescription>
                </Empty>
              )}
            </Panel>
          </div>
            </>
            </DashboardPeriodRefreshing>
        </>
      )}
    </>
  );
}

type PersonalDashboardPayload = {
  kind: "personal";
  scope: AudienceScope;
  canSwitchAudience: boolean;
  youUnlinked?: boolean;
  allowPeriodControls: boolean;
  cycleView: CycleView;
  rollingPeriod: RollingPeriod;
  periodLabel: string;
  cycleWindows?: CycleViewWindows;
  personal: Awaited<ReturnType<typeof getMeOverview>> | null;
  needsPersonalConnect?: boolean;
  syncContext?: RemoteSyncPanelContext | null;
};

type OrgDashboardShellPayload = {
  kind: "organization";
  slice: "shell";
  scope: "team";
  canSwitchAudience: boolean;
  shell: OrgOverviewShellData;
  needsPersonalConnect: boolean;
  syncPanel: RemoteSyncPanelContext | null;
};

type OrgDashboardMetricsPayload = {
  kind: "organization";
  slice: "metrics";
  scope: "team";
  canSwitchAudience: boolean;
  cycleView: CycleView;
  rollingPeriod: RollingPeriod;
  cycleWindows?: CycleViewWindows;
  overview: OrgOverviewMetricsData | null;
  error: string | null;
};

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const scopeParam = searchParams.get("scope");

  const workspaceQuery = useAppQuery<WorkspaceContextPayload>(
    workspaceContextKey,
    "/api/app/workspace-context",
  );
  const role = workspaceQuery.data?.current?.role;
  const workspaceReady = workspaceQuery.data?.current != null;
  const isPersonalDashboard = workspaceReady && (role === "user" || scopeParam === "you");
  const isOrgDashboard = workspaceReady && !isPersonalDashboard;

  const billing = workspaceQuery.data?.billing;
  const isTeamPlan =
    billing?.effectivePlan === "team" || billing?.effectivePlan === "enterprise";

  const personalQuery = useAppPageQuery<PersonalDashboardPayload>(
    dashboardKey(queryString),
    `/api/app/dashboard${queryString ? `?${queryString}` : ""}`,
    { enabled: isPersonalDashboard },
  );

  const shellQuery = useAppQuery<OrgDashboardShellPayload>(
    dashboardShellKey,
    "/api/app/dashboard?slice=shell",
    { enabled: isOrgDashboard, staleTime: 5 * 60 * 1000 },
  );

  const metricsParams = new URLSearchParams(searchParams.toString());
  metricsParams.set("slice", "metrics");
  const metricsQueryString = metricsParams.toString();
  const metricsQuery = useAppPageQuery<OrgDashboardMetricsPayload>(
    dashboardMetricsKey(metricsQueryString),
    `/api/app/dashboard?${metricsQueryString}`,
    { enabled: isOrgDashboard },
  );

  useAppQueryErrorToast(
    isPersonalDashboard && personalQuery.error && personalQuery.data ? personalQuery.error : null,
    { retry: () => void personalQuery.refetch() },
  );
  useAppQueryErrorToast(
    isOrgDashboard && shellQuery.error && shellQuery.data ? shellQuery.error : null,
    { retry: () => void shellQuery.refetch() },
  );
  useAppQueryErrorToast(
    isOrgDashboard && metricsQuery.error && metricsQuery.data ? metricsQuery.error : null,
    { retry: () => void metricsQuery.refetch() },
  );
  useErrorMessageToast(isOrgDashboard ? metricsQuery.data?.error ?? null : null, {
    enabled: isOrgDashboard,
    retry: () => void metricsQuery.refetch(),
  });

  if (!workspaceReady) {
    return <DashboardPageLoading showSyncPlaceholder />;
  }

  if (isPersonalDashboard) {
    const query = personalQuery;
    if (query.isPending && !query.data) {
      return <DashboardPageLoading showSyncPlaceholder />;
    }
    if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
      return <AppPageError error={query.error} retry={() => void query.refetch()} />;
    }
    if (!query.data) {
      return <DashboardPageLoading showSyncPlaceholder />;
    }

    const switcher = query.data.canSwitchAudience ? <AudienceScopeSwitcher /> : null;

    if (query.data.youUnlinked || !query.data.personal) {
      return (
        <>
          <ConnectionRepairBanner scope="you" recoveryDevices={query.data.syncContext?.recoveryDevices} />
          <ConnectMachineBanner show={query.data.needsPersonalConnect ?? true} />
          <PageHeader
            title="Your numbers."
            description="Link a developer profile and connect a machine to see personal usage here."
          >
            {switcher}
          </PageHeader>
          {query.data.syncContext ? (
            <div className="mb-8">
              <LocalSyncPanel
                scope="you"
                lastSeenAt={query.data.syncContext.lastSeenAt}
                lastUsageSyncAt={query.data.syncContext.lastUsageSyncAt}
                lastAccountSyncAt={query.data.syncContext.lastAccountSyncAt}
                dashboardReady={query.data.syncContext.dashboardReady}
                dirtyDayCount={query.data.syncContext.dirtyDayCount}
                staleDeviceCount={query.data.syncContext.staleDeviceCount}
              />
            </div>
          ) : null}
          <DashboardSetupPanel canInvite={false} />
        </>
      );
    }

    return (
      <PersonalHome
        data={query.data.personal}
        audienceSwitcher={switcher}
        allowPeriodControls={query.data.allowPeriodControls}
        cycleView={query.data.cycleView}
        rollingPeriod={query.data.rollingPeriod}
        cycleWindows={query.data.cycleWindows}
        refreshing={personalQuery.isFetching && personalQuery.isPlaceholderData}
      />
    );
  }

  const shellPending = shellQuery.isPending && !shellQuery.data;
  const metricsPending = metricsQuery.isPending && !metricsQuery.data;

  if (isBlockingAppQueryError(shellQuery.error, Boolean(shellQuery.data))) {
    return <AppPageError error={shellQuery.error} retry={() => void shellQuery.refetch()} />;
  }
  if (isBlockingAppQueryError(metricsQuery.error, Boolean(metricsQuery.data))) {
    return <AppPageError error={metricsQuery.error} retry={() => void metricsQuery.refetch()} />;
  }

  // Cold load: keep the real title (and shell chrome once available) while metrics load.
  if (shellPending || (metricsPending && !shellQuery.data)) {
    return (
      <DashboardPageLoading showSyncPlaceholder>
        {role && role !== "user" ? <AudienceScopeSwitcher /> : null}
      </DashboardPageLoading>
    );
  }

  if (!shellQuery.data) {
    return (
      <DashboardPageLoading showSyncPlaceholder>
        {role && role !== "user" ? <AudienceScopeSwitcher /> : null}
      </DashboardPageLoading>
    );
  }

  const switcher = shellQuery.data.canSwitchAudience ? <AudienceScopeSwitcher /> : null;
  const { needsPersonalConnect, syncPanel, shell } = shellQuery.data;
  const cycleView = metricsQuery.data?.cycleView ?? "last_30_days";
  const rollingPeriod = metricsQuery.data?.rollingPeriod ?? DEFAULT_ROLLING_PERIOD;
  const cycleWindows = metricsQuery.data?.cycleWindows;
  const error = metricsQuery.data?.error ?? null;
  const metricsOverview = metricsQuery.data?.overview ?? null;
  const data =
    metricsOverview && shell ? mergeOrgOverviewShellMetrics(shell, metricsOverview) : null;
  const empty = data && !data.hasActivity && data.coverage.devices === 0;
  // Period / filter change only — keep sealed numbers visible on background refetch.
  const metricsRefreshing =
    metricsPending || (metricsQuery.isFetching && metricsQuery.isPlaceholderData);
  const notifications = data?.attention ?? [];
  const periodLabel = cycleViewPeriodLabel(cycleView, rollingPeriod);

  return (
    <>
      <ConnectionRepairBanner scope="team" recoveryDevices={syncPanel?.recoveryDevices} />
      <SubscriptionUpgradedBanner isTeam={isTeamPlan} />
      <ConnectMachineBanner show={needsPersonalConnect} />
      <PageHeader
        title={empty ? "Nothing reporting yet." : "What's reporting?"}
        description={
          empty
            ? "Connect a machine, then invite people. Metrics show up as soon as the first request lands."
            : undefined
        }
        actions={
          syncPanel || (!empty && (data || metricsRefreshing)) ? (
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              {!empty && (data || metricsRefreshing) ? (
                <CycleViewPicker
                  view={cycleView}
                  period={rollingPeriod}
                  cycleWindows={cycleWindows}
                />
              ) : null}
              {syncPanel ? (
                <LocalSyncPanel
                  scope="team"
                  compact
                  lastSeenAt={syncPanel.lastSeenAt}
                  lastUsageSyncAt={syncPanel.lastUsageSyncAt}
                  lastAccountSyncAt={syncPanel.lastAccountSyncAt}
                  dashboardReady={syncPanel.dashboardReady}
                  dirtyDayCount={syncPanel.dirtyDayCount}
                  staleDeviceCount={syncPanel.staleDeviceCount}
                />
              ) : null}
            </div>
          ) : null
        }
      >
        {switcher}
      </PageHeader>

      <DashboardPeriodRefreshing refreshing={metricsRefreshing && !error && !empty}>
      {empty ? (
        <DashboardSetupPanel />
      ) : data ? (
        <>
          <div className="grid items-stretch gap-6 xl:grid-cols-[1.45fr_1fr]">
            <Panel as="section" className="flex min-h-[17.5rem] min-w-0 flex-col">
              <ProjectedMonthlySpend
                trend={data.trend}
                commitment={data.kpis.actualSpend.value}
                cycles={data.subscriptionCycles}
                className="min-h-0 flex-1"
              />
            </Panel>
            <div className="relative grid h-full min-h-[17.5rem] grid-cols-2 grid-rows-2">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-1/2 z-[1] w-px -translate-x-1/2 bg-border-strong"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-px -translate-y-1/2 bg-border-strong"
              />
              <Kpi
                label="People"
                value={String(data.coverage.developers)}
                hero
                compactMobile
                className="h-full px-3 sm:px-4"
                sub={`${data.coverage.activeDevelopers} active · ${cycleViewPeriodLabel(data.cycleView, rollingPeriod)}`}
              />
              <Kpi
                label="Estimated usage"
                value={formatUsd(data.kpis.verifiedUsageCost.value + data.kpis.estimatedApiCost.value)}
                delta={data.kpis.verifiedUsageCost.deltaPercent}
                inverse
                compactMobile
                className="h-full px-3 sm:px-4"
                sub={usageCostBreakdownSub(
                  data.kpis.verifiedUsageCost.value,
                  data.kpis.estimatedApiCost.value,
                )}
              />
              <Kpi
                label="Est. spend/day"
                value={formatEstSpendPerDay(
                  data.kpis.verifiedUsageCost.value + data.kpis.estimatedApiCost.value,
                  data.observation.rangeDays,
                )}
                compactMobile
                className="h-full px-3 sm:px-4"
                sub={`${data.observation.rangeDays} days · ${cycleViewPeriodLabel(data.cycleView, rollingPeriod)}`}
                action={<KpiInfoTooltip content={estSpendPerDayTooltip(data.cycleView)} />}
              />
              <Kpi
                label="Price per 1M tokens"
                value={formatPricePerMillionTokens(
                  data.kpis.verifiedUsageCost.value + data.kpis.estimatedApiCost.value,
                  data.kpis.tokens.value,
                )}
                compactMobile
                className="h-full px-3 sm:px-4"
                sub={verifiedEstimatedWindowSub(data.cycleView)}
              />
            </div>
          </div>

          {/* <ProviderAnalyticsPanel cards={data.providerCards} /> */}

          <div className="mt-10 grid gap-4 xl:grid-cols-[7fr_3fr]">
            <Panel as="section" className="min-w-0">
              <CycleSectionHeader
                view={data.cycleView}
                period={rollingPeriod}
                cycles={data.subscriptionCycles}
                bordered={false}
              />
              <p className="-mt-4 mb-3 text-xs text-muted-foreground">
                Plan usage consumed per tool, aggregated across seats.
              </p>
              {data.subscriptionCycles.length ? (
                <CoverageVsNeedSection
                  cycles={data.subscriptionCycles}
                  cycleWindowLabel={(row) => cycleWindowLabel(row, data.cycleView)}
                  billingSeatLabel={billingSeatLabel}
                />
              ) : (
                <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                  <EmptyDescription>Add subscriptions to see cycle utilization.</EmptyDescription>
                </Empty>
              )}
            </Panel>

            {/* Absolute fill keeps this column height-locked to Current cycles on xl+. */}
            <div className="relative min-h-0 max-xl:min-h-[22rem]">
              <Panel
                as="section"
                className="flex min-h-0 flex-col overflow-hidden max-xl:max-h-[28rem] xl:absolute xl:inset-0"
              >
                <TopModelsPanel models={data.models ?? []} periodLabel={periodLabel} />
              </Panel>
            </div>
          </div>

          <div className="mt-10 grid items-start gap-6 lg:grid-cols-[70fr_40fr]">
            <Panel as="section" className="min-w-0">
              <SignalsSectionHeader title="Requests." bordered={false} />
              <OverviewChart data={data.trend} />
            </Panel>

            <Panel as="section" className="min-w-0">
              <SignalsSectionHeader title="Notifications." bordered={false} />
              {notifications.length ? (
                <ul>
                  {notifications.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="flex items-start gap-3 py-3 transition-colors hover:bg-muted/30"
                      >
                        <span
                          className={cn(
                            "mt-1 size-2 shrink-0 rounded-full",
                            item.severity === "error" ? "bg-destructive" : "bg-warning",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {item.detail}
                          </span>
                        </span>
                        <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                  <EmptyDescription>No notifications right now.</EmptyDescription>
                </Empty>
              )}
            </Panel>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Panel as="section">
              <SignalsSectionHeader
                title="Spend by tool."
                bordered={false}
                action={
                  <Link href="/tools" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    All tools
                  </Link>
                }
              />
              {data.tools.length ? (
                <ul>
                  {data.tools.map((tool) => (
                    <li key={tool.name} className="flex items-start justify-between gap-3 py-5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <ToolBrandIcon tool={tool.name} size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium leading-5">{toolDisplayName(tool.name)}</p>
                          <p className="mt-1 text-xs leading-4 text-muted-foreground">{tool.activeDevelopers} active</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium leading-5 tabular-nums">{formatUsd(tool.cost)}</p>
                        <p className="mt-1 text-xs leading-4 text-muted-foreground">{formatCompactNumber(tool.requests)} req</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                  <EmptyDescription>No tools detected yet.</EmptyDescription>
                </Empty>
              )}
            </Panel>

            <Panel as="section">
              <SignalsSectionHeader
                title="Spend by person."
                bordered={false}
                action={
                  <Link href="/team" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    All people
                  </Link>
                }
              />
              {data.people?.length ? (
                <ul>
                  {data.people.map((person) => {
                    const maxCost = data.people[0]?.cost ?? 0;
                    const pct = maxCost > 0 ? Math.min(100, (person.cost / maxCost) * 100) : 0;
                    return (
                      <li key={person.id}>
                        <Link
                          href={`/team/${person.id}`}
                          prefetch={false}
                          className="flex items-center gap-3 py-5 transition-colors hover:bg-muted/30"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-sm font-medium">{person.name}</p>
                              <p className="shrink-0 text-sm font-medium tabular-nums">{formatUsd(person.cost)}</p>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden bg-muted">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              {formatCompactNumber(person.requests)} requests
                            </p>
                          </div>
                          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                  <EmptyDescription>No people spend in this window.</EmptyDescription>
                </Empty>
              )}
            </Panel>
          </div>

          {data.failures.length > 0 && (
            <Panel as="section" className="mt-10">
              <SignalsSectionHeader title="Failed requests." bordered={false} />
              <ul>
                {data.failures.map((failure) => (
                  <li key={failure.id} className="flex flex-wrap items-center gap-3 py-5">
                    <span className="size-2 rounded-full bg-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {failure.tool} · {failure.model}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {failure.developer} · {new Date(failure.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[0.65rem] uppercase tracking-[0.08em] text-destructive">
                      {failure.status}
                    </Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">{failure.latencyMs}ms</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      ) : null}
      </DashboardPeriodRefreshing>
    </>
  );
}
