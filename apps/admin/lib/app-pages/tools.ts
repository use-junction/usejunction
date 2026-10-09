import type { AppPrincipal } from "@/lib/api/app-auth";
import { jsonSafe } from "@/lib/api/app-response";
import { getOrgActivitySettings } from "@/lib/activity/service";
import { parseCycleView, cycleViewWindows, reportWindowForCycleView } from "@/lib/dashboard/cycle-view";
import { parseRollingPeriodFromSearch } from "@/lib/dashboard/period-prefs";
import { getRemoteSyncPanelContext } from "@/lib/sync/remote-sync-context";
import { getMeOverview } from "@/lib/queries/me/overview";
import { getDashboardTools } from "@/lib/queries/dashboard/tools";
import { listSubscriptions } from "@/lib/tools/subscriptions";
import { reportNow } from "@/lib/report-now";
import { getCostOverview } from "@/lib/queries/tools/cost-overview";
import { resolveTeamFilter } from "@/lib/teams";

export type ToolsSearch = {
  view?: string | null;
  days?: string | null;
  from?: string | null;
  to?: string | null;
  team?: string | null;
};

export async function loadToolsPage(principal: AppPrincipal, search: ToolsSearch = {}) {
  if (principal.role === "user") {
    const [personal, syncContext, settings] = await Promise.all([
      getMeOverview(principal.orgId, principal.userId, principal.role, { includeOrgPlanSync: false }),
      getRemoteSyncPanelContext(principal.orgId, principal.userId, "you"),
      getOrgActivitySettings(principal.orgId),
    ]);
    return jsonSafe({
      kind: "personal" as const,
      personal,
      syncContext,
      canBrowseTools: settings.teamToolsBrowseEnabled,
    });
  }

  const raw = {
    view: search.view ?? undefined,
    days: search.days ?? undefined,
    from: search.from ?? undefined,
    to: search.to ?? undefined,
  };
  const cycleView = parseCycleView(raw.view);
  const rollingPeriod = parseRollingPeriodFromSearch(raw);
  const subscriptionsPromise = listSubscriptions(principal.orgId);
  const syncPromise = getRemoteSyncPanelContext(principal.orgId, principal.userId, "team");
  const subscriptions = await subscriptionsPromise;
  const now = reportNow();
  const reportWindow = reportWindowForCycleView(cycleView, rollingPeriod, subscriptions, now);
  const cycleWindows = cycleViewWindows(subscriptions, now);
  const team = await resolveTeamFilter(principal.orgId, search.team);
  const [result, syncContext, costOverview] = await Promise.all([
    getDashboardTools(principal.orgId, reportWindow)
      .then((data) => ({ data, error: null as string | null }))
      .catch(() => ({ data: null, error: "Failed to load tools." })),
    syncPromise,
    getCostOverview(principal.orgId, subscriptions, now, { developerIds: team?.developerIds }).catch(() => null),
  ]);
  return jsonSafe({
    kind: "organization" as const,
    cycleView,
    rollingPeriod,
    cycleWindows,
    detected: result.data,
    subscriptions,
    error: result.error,
    syncContext,
    costOverview,
    team: team ? { id: team.teamId, name: team.name } : null,
  });
}
