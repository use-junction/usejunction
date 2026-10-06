"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { DeveloperToolInventory } from "@/components/developers/developer-tool-inventory";
import { HubTabList } from "@/components/hub-nav";
import { PageHeader } from "@/components/page-header";
import { InvitePeopleDialog } from "@/components/team/team-connect-panel";
import { TeamInvitedPanel, type PendingInvite } from "@/components/team/team-invited-panel";
import { TeamSyncsPanel } from "@/components/team/team-syncs-panel";
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

type TeamView = "active" | "invited" | "syncs";

const teamViews: { id: TeamView; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "invited", label: "Invited" },
  { id: "syncs", label: "Syncs" },
];

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
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [view, setView] = useState<TeamView>("active");
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
    { enabled: view === "syncs" },
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
    enabled: view === "syncs" && Boolean(query.data),
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
      <PageHeader title="Who's here?" actions={<InvitePeopleDialog />}>
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
        />
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
