import type { AppPrincipal } from "@/lib/api/app-auth";
import { jsonSafe } from "@/lib/api/app-response";
import { parseAudienceScope } from "@/lib/audience-scope";
import { getOrgActivitySettings } from "@/lib/activity/service";
import { cycleViewPeriodLabel, cycleViewWindows, parseCycleView, reportWindowForCycleView } from "@/lib/dashboard/cycle-view";
import { parseRollingPeriodFromSearch } from "@/lib/dashboard/period-prefs";
import { getDeviceActivityFeed } from "@/lib/queries/activity/device-activity";
import { getTeamAdoption } from "@/lib/queries/activity/adoption";
import { getMeOverview } from "@/lib/queries/me/overview";
import { resolveLinkedDeveloperId } from "@/lib/queries/me/resolve-developer";
import { getPersonalSignalsLedger } from "@/lib/signals/read";
import { listSubscriptions } from "@/lib/tools/subscriptions";
import { getUnseatedUsers } from "@/lib/queries/tools/cost-overview";
import { unassignedSeats } from "@/lib/billing/monthly";
import { canonicalToolKey } from "@/lib/tools/catalog";
import { resolveTeamFilter } from "@/lib/teams";
import { canSeeOrgOverview } from "@/lib/rbac/permissions";
import { reportNow } from "@/lib/report-now";

export type ActivitySearch = {
  view?: string | null;
  days?: string | null;
  from?: string | null;
  to?: string | null;
  scope?: string | null;
  team?: string | null;
};

export async function loadActivityPage(principal: AppPrincipal, search: ActivitySearch = {}) {
  const isDeveloper = principal.role === "user";
  const canSwitchAudience = canSeeOrgOverview(principal.role);
  const scope = canSwitchAudience ? parseAudienceScope(search.scope ?? null) : "team";
  const [settings, subscriptions] = await Promise.all([
    getOrgActivitySettings(principal.orgId),
    listSubscriptions(principal.orgId),
  ]);
  const cycleView = parseCycleView(search.view ?? undefined);
  const rollingPeriod = parseRollingPeriodFromSearch({
    days: search.days ?? undefined,
    from: search.from ?? undefined,
    to: search.to ?? undefined,
  });
  const now = reportNow();
  const reportWindow = reportWindowForCycleView(cycleView, rollingPeriod, subscriptions, now);
  const periodLabel = cycleViewPeriodLabel(cycleView, rollingPeriod);
  const cycleWindows = cycleViewWindows(subscriptions, now);

  if (isDeveloper) {
    const [personal, signalsLedger] = await Promise.all([
      getMeOverview(principal.orgId, principal.userId, "user", { reportWindow }),
      getPersonalSignalsLedger(principal.orgId, principal.userId),
    ]);
    const deviceFeed = settings.teamDeviceActivityEnabled
      ? await getDeviceActivityFeed(principal.orgId, { developerId: personal.developer.id, limit: 50 })
      : { items: [], presenceFallback: false };
    return jsonSafe({
      kind: "personal" as const,
      scope: "you" as const,
      canSwitchAudience: false,
      settings,
      allowPeriodControls: true,
      cycleView,
      rollingPeriod,
      periodLabel,
      cycleWindows,
      personal,
      signalsLedger,
      deviceFeed,
    });
  }

  if (canSwitchAudience && scope === "you") {
    const linkedId = await resolveLinkedDeveloperId(principal.orgId, principal.userId);
    if (!linkedId) {
      return jsonSafe({
        kind: "personal" as const,
        scope: "you" as const,
        canSwitchAudience: true,
        youUnlinked: true,
        settings,
        allowPeriodControls: true,
        cycleView,
        rollingPeriod,
        periodLabel,
        cycleWindows,
        personal: null,
        signalsLedger: [],
        deviceFeed: { items: [], presenceFallback: false },
      });
    }
    const [personal, signalsLedger] = await Promise.all([
      getMeOverview(principal.orgId, principal.userId, principal.role, { reportWindow }),
      getPersonalSignalsLedger(principal.orgId, principal.userId),
    ]);
    const deviceFeed = settings.teamDeviceActivityEnabled
      ? await getDeviceActivityFeed(principal.orgId, { developerId: personal.developer.id, limit: 50 })
      : { items: [], presenceFallback: false };
    return jsonSafe({
      kind: "personal" as const,
      scope: "you" as const,
      canSwitchAudience: true,
      settings,
      allowPeriodControls: true,
      cycleView,
      rollingPeriod,
      periodLabel,
      cycleWindows,
      personal,
      signalsLedger,
      deviceFeed,
    });
  }

  const team = await resolveTeamFilter(principal.orgId, search.team);
  // Assignment state is "now", so it only belongs in windows that reach today; and unassigned
  // seats belong to the workspace, not a team.
  const showUnassigned = !team && reportWindow.to.getTime() >= now.getTime() - 86_400_000;
  const unseated = showUnassigned ? await getUnseatedUsers(principal.orgId, now) : undefined;
  const [adoption, deviceFeed] = await Promise.all([
    getTeamAdoption(principal.orgId, reportWindow, now, {
      developerIds: team?.developerIds,
      unassignedSeats: showUnassigned
        ? unassignedSeats(subscriptions, (plan) => canonicalToolKey(plan.toolKey ?? plan.toolName), unseated)
        : undefined,
    }),
    getDeviceActivityFeed(principal.orgId, { limit: 50 }),
  ]);
  return jsonSafe({
    kind: "organization" as const,
    scope: "team" as const,
    canSwitchAudience,
    allowPeriodControls: true,
    cycleView,
    rollingPeriod,
    periodLabel,
    cycleWindows,
    adoption,
    deviceFeed,
    team: team ? { id: team.teamId, name: team.name } : null,
  });
}
