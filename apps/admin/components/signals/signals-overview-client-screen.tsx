"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowUpRight } from "lucide-react";
import { AudienceScopeSwitcher } from "@/components/audience-scope-switcher";
import { CycleViewPicker } from "@/components/dashboard/cycle-view-picker";
import { Panel } from "@/components/panel";
import { MemberWorkSessionList } from "@/components/developers/member-work-session-list";
import { SignalsPageHeader } from "@/components/signals/signals-page-header";
import { SignalsDisabledEmptyState } from "@/components/signals/signals-disabled-empty-state";
import { SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { flowDisplayLabel } from "@/components/signals/flow-segment";
import { ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { AudienceScope } from "@/lib/audience-scope";
import {
  type CycleView,
  type CycleViewWindows,
} from "@/lib/dashboard/cycle-view";
import type { RollingPeriod } from "@/lib/dashboard/period-prefs";
import type { getWorkOverview } from "@/lib/signals";
import { useAppPageQuery } from "@/lib/api/client";
import { signalsOverviewKey } from "@/lib/app-pages/query-keys";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";

const SignalsTrendChart = dynamic(() => import("@/components/signals/signals-trend-chart").then((mod) => mod.SignalsTrendChart), { ssr: false });

type SignalsOverviewPayload = {
  scope: AudienceScope;
  canSwitchAudience: boolean;
  youUnlinked?: boolean;
  cycleView: CycleView;
  rollingPeriod: RollingPeriod;
  cycleWindows?: CycleViewWindows;
  periodLabel: string;
  work: Awaited<ReturnType<typeof getWorkOverview>>["data"];
};

export default function SignalsOverviewClientScreen() {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const query = useAppPageQuery<SignalsOverviewPayload>(
    signalsOverviewKey(queryString),
    `/api/app/signals/overview${queryString ? `?${queryString}` : ""}`,
  );
  useAppQueryErrorToast(query.error && query.data ? query.error : null, { retry: () => void query.refetch() });

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  if (!query.data) return <AppPageSkeleton />;
  const { scope, cycleView, rollingPeriod, cycleWindows, periodLabel, work, youUnlinked } = query.data;
  const isYou = scope === "you";
  const topTool = work.topTools[0] ?? null;
  const activityHref = isYou ? "/signals/activity?scope=you" : "/signals/activity";

  return (
    <>
      <SignalsPageHeader title="Where is the work?">
        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-end sm:gap-6">
          {work.enabled ? (
            <CycleViewPicker
              view={cycleView}
              period={rollingPeriod}
              basePath="/signals"
              cycleWindows={cycleWindows}
            />
          ) : null}
          <AudienceScopeSwitcher className="sm:w-auto" />
        </div>
      </SignalsPageHeader>

      {youUnlinked ? (
        <Empty className="min-h-0 gap-1 border border-border p-6 md:p-8">
          <EmptyDescription>Link a developer profile to see your Signals work.</EmptyDescription>
        </Empty>
      ) : !work.enabled ? (
        <SignalsDisabledEmptyState />
      ) : (
        <>
          <div className="grid items-start gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
            <SignalsKpi
              label="Work sessions"
              hero
              className="pl-5"
              value={work.sessions.toLocaleString()}
              sub={periodLabel}
            />
            <SignalsKpi
              label={isYou ? "Active" : "Active people"}
              className="sm:border-l sm:border-border sm:pl-8"
              value={work.activePeople.toLocaleString()}
              sub={
                isYou
                  ? work.activePeople ? "you had work" : "no work yet"
                  : work.activePeople === 1
                    ? "person with work"
                    : "people with work"
              }
            />
            <SignalsKpi
              label="Models seen"
              className="xl:border-l xl:border-border xl:pl-8"
              value={work.models ? work.models.toLocaleString() : "—"}
              sub={work.models ? "distinct models" : "No models yet"}
            />
            <SignalsKpi
              label="Top tool"
              className="sm:border-l sm:border-border sm:pl-8"
              value={
                topTool ? (
                  <span className="inline-flex items-center gap-2">
                    <ToolLogoTile tool={topTool.tool} size="sm" light />
                    <span className="truncate text-2xl sm:text-3xl">
                      {flowDisplayLabel(topTool.tool, "ai")}
                    </span>
                  </span>
                ) : (
                  "—"
                )
              }
              sub={
                topTool ? (
                  <span className="flex flex-col gap-1.5">
                    <span>
                      {topTool.sessions} session{topTool.sessions === 1 ? "" : "s"} ·{" "}
                      {topTool.sharePercent}%
                    </span>
                    <Link
                      href={activityHref}
                      className="inline-flex w-fit items-center gap-0.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Open Activity
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </span>
                ) : (
                  "No tools yet"
                )
              }
            />
          </div>

          <div className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel as="section">
              <SignalsSectionHeader
                title="Daily trend."
                description="Work sessions by day in this window."
                bordered={false}
              />
              <SignalsTrendChart data={work.trend} />
            </Panel>
            <Panel as="section">
              <SignalsSectionHeader
                title="Top tools."
                description="Where coding-tool work concentrates."
                bordered={false}
                action={
                  <Link
                    href={activityHref}
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    All activity
                  </Link>
                }
              />
              {work.topTools.length ? (
                <ul className="space-y-4">
                  {work.topTools.slice(0, 5).map((tool) => (
                    <li key={tool.tool} className="flex items-center gap-3">
                      <ToolLogoTile tool={tool.tool} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-sm font-medium">
                            {flowDisplayLabel(tool.tool, "ai")}
                          </p>
                          <p className="text-sm font-medium tabular-nums">{tool.sessions}</p>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full bg-muted">
                          <div
                            className="h-full bg-primary/80"
                            style={{ width: `${Math.max(Math.min(tool.sharePercent, 100), 0)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tool.people} {tool.people === 1 ? "person" : "people"} · {tool.sharePercent}% of
                          sessions
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                  <EmptyDescription>No tool sessions yet.</EmptyDescription>
                </Empty>
              )}
            </Panel>
          </div>

          <Panel as="section" className="mt-10">
            <SignalsSectionHeader
              title="Recent work."
              description="Asks, change summaries, and file activity from local AI tools."
              bordered={false}
              action={
                <Link
                  href={activityHref}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  All activity
                </Link>
              }
            />
            {work.recent.length ? (
              <MemberWorkSessionList
                sessions={work.recent}
                density="table"
                fromTeam={false}
                showPerson={!isYou}
                maxHeightClass="max-h-[28rem]"
              />
            ) : (
              <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
                <EmptyDescription>No extracted work in this window yet.</EmptyDescription>
              </Empty>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
