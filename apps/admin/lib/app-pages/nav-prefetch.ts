import type { QueryClient } from "@tanstack/react-query";
import { appFetch } from "@/lib/api/client";
import {
  activityKey,
  dashboardShellKey,
  workSpendKey,
  myDataKey,
  overviewKey,
  teamKey,
  toolsKey,
} from "@/lib/app-pages/query-keys";

/**
 * Top-level sidebar destinations only — never prefetch inner routes like
 * `/tools/:toolKey` or `/team/:developerId`.
 */
const NAV_PREFETCH_TARGETS: Record<string, { queryKey: readonly unknown[]; url: string }> = {
  "/overview": { queryKey: overviewKey(), url: "/api/app/overview" },
  "/dashboard": { queryKey: dashboardShellKey, url: "/api/app/dashboard?slice=shell" },
  "/team": { queryKey: teamKey(), url: "/api/app/team" },
  "/tools": { queryKey: toolsKey(), url: "/api/app/tools" },
  "/activity": { queryKey: activityKey(), url: "/api/app/activity" },
  "/work-spend": { queryKey: workSpendKey(), url: "/api/app/work-spend" },
  "/me/data": { queryKey: myDataKey, url: "/api/app/me/data" },
};

const NAV_PREFETCH_STALE_TIME = 5 * 60 * 1000;

/** Warm the React Query cache for a primary nav destination after a deliberate hover. */
export function prefetchNavPage(queryClient: QueryClient, href: string) {
  const target = NAV_PREFETCH_TARGETS[href];
  if (!target) return;

  const state = queryClient.getQueryState(target.queryKey);
  const isFresh = state?.dataUpdatedAt
    ? Date.now() - state.dataUpdatedAt < NAV_PREFETCH_STALE_TIME
    : false;
  if (isFresh || state?.fetchStatus === "fetching") return;

  void queryClient.prefetchQuery({
    queryKey: target.queryKey,
    queryFn: () => appFetch(target.url),
    staleTime: NAV_PREFETCH_STALE_TIME,
  });
}
