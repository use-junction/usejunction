"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LocalSyncPanel } from "@/components/dashboard/local-sync-panel";
import { ConnectionRepairBanner } from "@/components/dashboard/connection-repair-banner";
import { DashboardPeriodRefreshing } from "@/components/dashboard/dashboard-period-refreshing";
import { ToolProviderDetail } from "@/components/tools/tool-provider-detail";
import Link from "next/link";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { toolDisplayName } from "@/lib/tools/catalog";
import {
  cycleViewPeriodLabel,
  cycleViewShortSuffix,
  type CycleView,
  type CycleViewWindows,
} from "@/lib/dashboard/cycle-view";
import type { RollingPeriod } from "@/lib/dashboard/period-prefs";
import type { getToolDetail } from "@/lib/queries/dashboard/tool-detail";
import type { RemoteSyncPanelContext } from "@/lib/sync/remote-sync-context";
import { useAppPageQuery, useAppQuery } from "@/lib/api/client";
import { toolDetailMetricsKey, toolDetailShellKey } from "@/lib/app-pages/query-keys";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";

type ToolDetailShellPayload = {
  kind: "organization" | "personal";
  slice: "shell";
  rawToolKey: string;
  toolKey: string;
  syncContext: RemoteSyncPanelContext | null;
};

type ToolDetailMetricsPayload = {
  kind: "organization" | "personal";
  slice: "metrics";
  rawToolKey: string;
  toolKey: string;
  cycleView: CycleView;
  rollingPeriod: RollingPeriod;
  cycleWindows?: CycleViewWindows;
  detail: NonNullable<Awaited<ReturnType<typeof getToolDetail>>> & {
    plans: Array<
      NonNullable<Awaited<ReturnType<typeof getToolDetail>>>["plans"][number] & {
        cycleSeatMicros: string;
        estimatedCycleMicros: string;
      }
    >;
  };
};

export default function ToolDetailClientScreen() {
  const routeParams = useParams<{ toolKey: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawToolKey = routeParams.toolKey;
  const queryString = searchParams.toString();
  const metricsParams = new URLSearchParams(searchParams.toString());
  metricsParams.set("slice", "metrics");
  const metricsQueryString = metricsParams.toString();

  const shellQuery = useAppQuery<ToolDetailShellPayload>(
    toolDetailShellKey(rawToolKey),
    `/api/app/tools/${encodeURIComponent(rawToolKey)}?slice=shell`,
    { staleTime: 5 * 60 * 1000 },
  );
  const metricsQuery = useAppPageQuery<ToolDetailMetricsPayload>(
    toolDetailMetricsKey(rawToolKey, queryString),
    `/api/app/tools/${encodeURIComponent(rawToolKey)}?${metricsQueryString}`,
  );

  useEffect(() => {
    const toolKey = shellQuery.data?.toolKey ?? metricsQuery.data?.toolKey;
    if (toolKey && toolKey !== rawToolKey) {
      router.replace(`/tools/${toolKey}${queryString ? `?${queryString}` : ""}`);
    }
  }, [metricsQuery.data?.toolKey, queryString, rawToolKey, router, shellQuery.data?.toolKey]);

  useAppQueryErrorToast(shellQuery.error && shellQuery.data ? shellQuery.error : null, {
    retry: () => void shellQuery.refetch(),
  });
  useAppQueryErrorToast(metricsQuery.error && metricsQuery.data ? metricsQuery.error : null, {
    retry: () => void metricsQuery.refetch(),
  });

  const shellPending = shellQuery.isPending && !shellQuery.data;
  const metricsPending = metricsQuery.isPending && !metricsQuery.data;

  if (shellPending && metricsPending) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(shellQuery.error, Boolean(shellQuery.data))) {
    return <AppPageError error={shellQuery.error} retry={() => void shellQuery.refetch()} />;
  }
  if (isBlockingAppQueryError(metricsQuery.error, Boolean(metricsQuery.data))) {
    return <AppPageError error={metricsQuery.error} retry={() => void metricsQuery.refetch()} />;
  }

  const shell = shellQuery.data;
  const metrics = metricsQuery.data;
  if (!shell && !metrics) return <AppPageSkeleton />;

  const kind = shell?.kind ?? metrics?.kind ?? "organization";
  const toolKey = shell?.toolKey ?? metrics?.toolKey ?? rawToolKey;
  const syncContext = shell?.syncContext ?? null;
  const scope = kind === "personal" ? "self" : "org";
  const metricsRefreshing =
    metricsPending || (metricsQuery.isFetching && metricsQuery.isPlaceholderData);

  return (
    <>
      {syncContext?.deviceCount ? (
        <ConnectionRepairBanner
          scope={kind === "personal" ? "you" : "team"}
          recoveryDevices={syncContext.recoveryDevices}
        />
      ) : null}
      {/* Breadcrumb and sync status sit outside the refreshing area so they stay put while a period loads. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/tools" prefetch={false}>{kind === "personal" ? "My tools" : "Cost"}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{metrics?.detail.name ?? toolDisplayName(toolKey)}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {syncContext?.deviceCount ? (
          <LocalSyncPanel
            scope={kind === "personal" ? "you" : "team"}
            compact
            lastSeenAt={syncContext.lastSeenAt}
            lastUsageSyncAt={syncContext.lastUsageSyncAt}
            lastAccountSyncAt={syncContext.lastAccountSyncAt}
            dashboardReady={syncContext.dashboardReady}
            dirtyDayCount={syncContext.dirtyDayCount}
            staleDeviceCount={syncContext.staleDeviceCount}
          />
        ) : null}
      </div>
      <DashboardPeriodRefreshing refreshing={metricsRefreshing}>
        {metrics ? (
          <ToolProviderDetail
            data={metrics.detail}
            scope={scope}
            cycleView={metrics.cycleView}
            period={metrics.rollingPeriod}
            periodLabel={cycleViewPeriodLabel(metrics.cycleView, metrics.rollingPeriod)}
            periodSuffix={cycleViewShortSuffix(metrics.cycleView, metrics.rollingPeriod)}
            periodBasePath={`/tools/${toolKey}`}
            cycleWindows={metrics.cycleWindows}
            showBreadcrumb={false}
          />
        ) : (
          <AppPageSkeleton />
        )}
      </DashboardPeriodRefreshing>
    </>
  );
}
