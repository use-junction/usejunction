"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Metrics body skeleton — matches org/personal KPI + list layout. */
export function DashboardMetricsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading period">
      <div className="grid grid-cols-2 items-stretch gap-y-5 sm:gap-y-8 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className={
              index === 0
                ? "space-y-3"
                : "space-y-3 border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
            }
          >
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-36 max-w-full" />
          </div>
        ))}
      </div>

      <div className="mt-10 space-y-5 border-t border-border/60 pt-6">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-md" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}

/**
 * First paint / cold load: keep the real page title (and optional chrome)
 * while metrics skeleton in. No overlay, no "crunching" copy.
 */
export function DashboardPageLoading({
  title = "What's reporting?",
  description,
  actions,
  children,
  showSyncPlaceholder = false,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Audience switcher / extra header content. */
  children?: ReactNode;
  showSyncPlaceholder?: boolean;
}) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions}>
        {children}
      </PageHeader>
      {showSyncPlaceholder ? (
        <div className="mb-8 flex items-center justify-between gap-2 sm:gap-4" aria-hidden>
          <Skeleton className="h-4 w-48 max-w-[60%]" />
          <Skeleton className="h-8 w-24" />
        </div>
      ) : null}
      <DashboardMetricsSkeleton />
    </>
  );
}

/**
 * On filter/period change, swap metrics for a skeleton instead of showing
 * dimmed stale numbers. Header / sync / picker stay outside this wrapper.
 */
export function DashboardPeriodRefreshing({
  refreshing,
  children,
}: {
  refreshing: boolean;
  children: ReactNode;
}) {
  if (refreshing) return <DashboardMetricsSkeleton />;
  return children;
}
