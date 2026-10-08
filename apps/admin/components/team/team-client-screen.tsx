"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DeveloperToolInventory } from "@/components/developers/developer-tool-inventory";
import { HubTabList } from "@/components/hub-nav";
import { PageHeader } from "@/components/page-header";
import { InvitePeopleDialog } from "@/components/team/team-connect-panel";
import { TeamGhostRows } from "@/components/team/team-ghost-rows";
import { TeamInvitedPanel, type PendingInvite } from "@/components/team/team-invited-panel";
import { TeamSyncsPanel } from "@/components/team/team-syncs-panel";
import { TeamTeamsPanel } from "@/components/team/team-teams-panel";
import { TeamFilter } from "@/components/team-filter";
import { useSession } from "next-auth/react";
import { canManageSettings, type OrganizationRole } from "@/lib/rbac/permissions";
import { serializeBigInts } from "@/lib/billing/validation";
import {
  cycleViewShortSuffix,
  type CycleView,
} from "@/lib/dashboard/cycle-view";
import type { RollingPeriod } from "@/lib/dashboard/period-prefs";
import type { getPlanUsage } from "@/lib/insights/queries/get-plan-usage";
import type { OrgDeviceSyncStatus } from "@/lib/queries/team/device-syncs";
import type { getDeveloperRoster } from "@/lib/read-models/developers";
import type { listSubscriptions } from "@/lib/tools/subscriptions";
import { userFacingError } from "@/lib/errors/user-facing";
import { useAppPageQuery } from "@/lib/api/client";
import { teamInvitesKey, teamKey, teamSyncsKey, teamUsageKey } from "@/lib/app-pages/query-keys";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";

type TeamView = "active" | "teams" | "invited" | "fleet";

const teamViews: { id: TeamView; label: string }[] = [
  { id: "active", label: "Members" },
  { id: "teams", label: "Teams" },
  { id: "invited", label: "Invited" },
  { id: "fleet", label: "Fleet" },
];

/** `?tab=` keeps the open tab linkable; `syncs` is the old name for Fleet. */
function parseTeamView(value: string | null): TeamView {
  if (value === "invited") return "invited";
  if (value === "teams") return "teams";
  if (value === "fleet" || value === "syncs") return "fleet";
  return "active";
}

type TeamPayload = {
  cycleView: CycleView;
  rollingPeriod: RollingPeriod;
  empty: boolean;
  developers: Awaited<ReturnType<typeof getDeveloperRoster>>["developers"];
  subscriptions: Awaited<ReturnType<typeof listSubscriptions>>;
};

type TeamUsagePayload = {
  planUsage: Awaited<ReturnType<typeof getPlanUsage>>["data"]["developers"];
};

const EMPTY_PLAN_USAGE: TeamUsagePayload["planUsage"] = [];

type TeamInvitesPayload = {
  pendingInvites: PendingInvite[];
};

type TeamSyncsPayload = {
  syncs: OrgDeviceSyncStatus;
};

export default function TeamClientScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const canManage = canManageSettings(session?.user?.role as OrganizationRole | null | undefined);
  const view = parseTeamView(searchParams.get("tab"));
  const dataParams = new URLSearchParams(searchParams.toString());
  dataParams.delete("tab");
  // The team filter narrows the roster client-side; it must not refetch the page data.
  dataParams.delete("team");
  const queryString = dataParams.toString();
  function setView(next: TeamView) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "active") params.delete("tab");
    else params.set("tab", next);
    const search = params.toString();
    router.replace(`${pathname}${search ? `?${search}` : ""}`, { scroll: false });
  }
  const query = useAppPageQuery<TeamPayload>(
    teamKey(queryString),
    `/api/app/team${queryString ? `?${queryString}` : ""}`,
  );
  const usageQuery = useAppPageQuery<TeamUsagePayload>(
    teamUsageKey(queryString),
    `/api/app/team/usage${queryString ? `?${queryString}` : ""}`,
    { enabled: view === "active" },
  );
  const invitesQuery = useAppPageQuery<TeamInvitesPayload>(
    teamInvitesKey,
    "/api/app/team/invites",
    { enabled: view === "invited" },
  );
  const syncsQuery = useAppPageQuery<TeamSyncsPayload>(
    teamSyncsKey,
    "/api/app/team/syncs",
    { enabled: view === "fleet" },
  );
  useAppQueryErrorToast(usageQuery.error, {
    enabled: view === "active" && Boolean(query.data),
    message: usageQuery.error ? userFacingError(usageQuery.error.message, "Could not load plan usage.") : undefined,
    retry: () => void usageQuery.refetch(),
  });
  useAppQueryErrorToast(invitesQuery.error, {
    enabled: view === "invited" && Boolean(query.data),
    retry: () => void invitesQuery.refetch(),
  });
  useAppQueryErrorToast(syncsQuery.error, {
    enabled: view === "fleet" && Boolean(query.data),
    retry: () => void syncsQuery.refetch(),
  });

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  if (!query.data) return <AppPageSkeleton />;
  const {
    cycleView,
    rollingPeriod,
    empty,
    subscriptions,
  } = query.data;
  const periodSuffix = cycleViewShortSuffix(cycleView, rollingPeriod);
  const initial = serializeBigInts({
    developers: query.data.developers,
    subscriptions,
  }) as unknown as {
    developers: Parameters<typeof DeveloperToolInventory>[0]["initialDevelopers"];
    subscriptions: Parameters<typeof DeveloperToolInventory>[0]["initialSubscriptions"];
  };

  return (
    <>
      <PageHeader
        title="People."
        description="Who's here, which team they're on, and whether their machine reports."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view === "active" ? <TeamFilter /> : null}
            <InvitePeopleDialog />
          </div>
        }
      >
        <HubTabList
          items={teamViews}
          value={view}
          onChange={(id) => setView(id as TeamView)}
          className="border-b border-border"
          aria-label="Team views"
        />
      </PageHeader>

      {empty && view === "active" ? (
        <div className="mb-10 flex flex-col gap-3 bg-brand-yellow-pale p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="inline-flex w-fit items-center bg-brand-yellow px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-brand-yellow-dark">
              Insight
            </span>
            <p className="max-w-2xl text-sm leading-6 text-foreground">
              One link for the team. Paste it in Slack — anyone with the invite can join and install the agent.
            </p>
          </div>
        </div>
      ) : null}

      {view === "active" ? (
        <DeveloperToolInventory
          initialDevelopers={initial.developers}
          initialSubscriptions={initial.subscriptions}
          initialPlanUsage={usageQuery.data?.planUsage ?? EMPTY_PLAN_USAGE}
          planUsageLoading={usageQuery.isPending}
          planUsageError={usageQuery.error?.message ?? null}
          retryPlanUsage={() => void usageQuery.refetch()}
          periodSuffix={periodSuffix}
          ghostRows={empty ? <TeamGhostRows /> : undefined}
        />
      ) : view === "teams" ? (
        <TeamTeamsPanel canManage={canManage} />
      ) : view === "invited" ? (
        invitesQuery.isPending && !invitesQuery.data ? (
          <AppPageSkeleton />
        ) : (
          <TeamInvitedPanel initialInvites={invitesQuery.data?.pendingInvites ?? []} />
        )
      ) : syncsQuery.isPending && !syncsQuery.data ? (
        <AppPageSkeleton />
      ) : syncsQuery.data ? (
        <TeamSyncsPanel syncs={syncsQuery.data.syncs} />
      ) : (
        <AppPageSkeleton />
      )}
    </>
  );
}
