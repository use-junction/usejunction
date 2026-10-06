"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceShell } from "@/components/workspace-shell";
import { AppPageError, isBlockingAppQueryError } from "@/components/app-data-state";
import { LegalAcceptanceGate } from "@/components/legal/legal-acceptance-gate";
import { TimezoneReporter } from "@/components/timezone-reporter";
import { NewCollectionBanner } from "@/components/new-collection-banner";
import { activateWorkspace, AppApiError, useAppQuery } from "@/lib/api/client";
import { workspaceContextKey } from "@/lib/app-pages/query-keys";
import type { OrgBillingStatus } from "@/lib/saas-billing/status";
import { canSeeOrgOverview, type OrganizationRole } from "@/lib/rbac/permissions";
import { signalsProductEnabled } from "@/lib/region";

type WorkspaceSyncState = {
  deviceCount: number;
  activeDeviceCount: number;
  toolCount: number;
  lastSeenAt: string | null;
  lastUsageSyncAt: string | null;
  lastAccountSyncAt: string | null;
  lastToolsSyncAt: string | null;
  lastQuotasSyncAt: string | null;
  dataWatermark: string;
  presenceWatermark: string;
  dashboardReady?: boolean;
  dirtyDayCount?: number;
};

type WorkspaceContext = {
  organizations: Array<{ id: string; name: string; color: string | null; role: OrganizationRole }>;
  current: {
    id: string;
    name: string;
    color: string | null;
    role: OrganizationRole;
    onboardingCompleted: boolean;
  } | null;
  billing: OrgBillingStatus | null;
  sync?: WorkspaceSyncState;
  sessionWorkspaceSyncRequired: boolean;
};

function WorkspaceClientLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, status: sessionStatus, update: updateSession } = useSession();
  const pathname = usePathname();
  const queryString = useSearchParams().toString();
  const lastDataWatermark = useRef<string | null>(null);
  const lastPresenceWatermark = useRef<string | null>(null);
  const contextQuery = useAppQuery<WorkspaceContext>(
    workspaceContextKey,
    "/api/app/workspace-context",
    {
      // Keep polling while a device is enrolled so later agent heartbeats
      // advance the sync watermark and refresh dashboard metrics without a
      // hard reload.
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data?.current?.onboardingCompleted) return false;
        const syncState = data.sync;
        if (!syncState || syncState.deviceCount <= 0) return false;
        // Poll faster while history rematerialize is still draining so the
        // dashboard does not sit on a stale "Last synced" / $0 view.
        if (syncState.dashboardReady === false || (syncState.dirtyDayCount ?? 0) > 0) {
          return 15_000;
        }
        return 30_000;
      },
    },
  );
  const syncStarted = useRef(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncInFlight, setSyncInFlight] = useState(false);

  useEffect(() => {
    if (sessionStatus !== "unauthenticated") return;
    queryClient.clear();
    const from = `${pathname}${queryString ? `?${queryString}` : ""}`;
    router.replace(`/login?from=${encodeURIComponent(from)}`);
  }, [pathname, queryClient, queryString, router, sessionStatus]);

  useEffect(() => {
    if (!contextQuery.data) return;
    if (!contextQuery.data.current || !contextQuery.data.current.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [contextQuery.data, router]);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") return;
    if (!signalsProductEnabled()) {
      if (pathname === "/signals" || pathname.startsWith("/signals/")) {
        router.replace("/dashboard");
        return;
      }
      const workMatch = pathname.match(/^\/team\/([^/]+)\/work\/?$/);
      if (workMatch) {
        router.replace(`/team/${workMatch[1]}`);
        return;
      }
    }
    const current = contextQuery.data?.current;
    if (!current || canSeeOrgOverview(current.role)) return;
    if (
      pathname === "/team" ||
      pathname.startsWith("/team/") ||
      pathname === "/signals" ||
      pathname.startsWith("/signals/") ||
      pathname === "/features" ||
      pathname.startsWith("/features/") ||
      pathname === "/work-spend" ||
      pathname.startsWith("/work-spend/")
    ) {
      router.replace("/dashboard");
    }
  }, [contextQuery.data?.current, pathname, router, sessionStatus]);

  useEffect(() => {
    const context = contextQuery.data;
    if (!context?.sessionWorkspaceSyncRequired || !context.current || syncStarted.current) return;
    const orgId = context.current.id;
    syncStarted.current = true;
    setSyncInFlight(true);
    void activateWorkspace(orgId)
      .then(async () => {
        await updateSession({ user: { orgId } });
        await queryClient.invalidateQueries({ queryKey: workspaceContextKey });
      })
      .catch(() => {
        syncStarted.current = false;
        setSyncFailed(true);
      })
      .finally(() => {
        setSyncInFlight(false);
      });
  }, [contextQuery.data, queryClient, updateSession]);

  useEffect(() => {
    const syncState = contextQuery.data?.sync;
    if (!syncState) return;

    if (lastDataWatermark.current === null) {
      lastDataWatermark.current = syncState.dataWatermark;
      lastPresenceWatermark.current = syncState.presenceWatermark;
      return;
    }
    if (lastDataWatermark.current !== syncState.dataWatermark) {
      lastDataWatermark.current = syncState.dataWatermark;
      // Agent data ingest advanced — expire data-backed pages, but keep
      // workspace-context (already fresh). Do not cancel in-flight prefetches.
      void queryClient.invalidateQueries(
        {
          predicate: (query) =>
            query.queryKey[0] === "app" && query.queryKey[1] !== "workspace-context",
        },
        { cancelRefetch: false },
      );
    }
    if (lastPresenceWatermark.current !== syncState.presenceWatermark) {
      lastPresenceWatermark.current = syncState.presenceWatermark;
      // Heartbeats affect liveness surfaces only; analytics caches remain warm.
      void queryClient.invalidateQueries(
        {
          predicate: (query) =>
            query.queryKey[0] === "app" &&
            (
              query.queryKey[1] === "activity" ||
              (
                query.queryKey[1] === "team" &&
                (
                  query.queryKey[2] === "syncs" ||
                  (query.queryKey.length === 3 && query.queryKey[2] !== "invites")
                )
              )
            ),
        },
        { cancelRefetch: false },
      );
    }
  }, [
    contextQuery.data?.sync?.dataWatermark,
    contextQuery.data?.sync?.presenceWatermark,
    queryClient,
  ]);

  const context = contextQuery.data;
  const current = context?.current ?? null;
  const migrationPending = Boolean(
    syncInFlight || (context?.sessionWorkspaceSyncRequired && current && !syncFailed),
  );
  const contextLoading =
    sessionStatus === "loading" || (contextQuery.isPending && !context);

  const contextError = contextQuery.error ?? (syncFailed
    ? new AppApiError(500, "WORKSPACE_SESSION_SYNC_FAILED", "Could not sync your workspace session.")
    : null);
  const blockingContextError = isBlockingAppQueryError(contextError, Boolean(context));
  const shellLoading = contextLoading || migrationPending;

  return (
    <WorkspaceShell
      organizations={context?.organizations ?? []}
      currentOrgId={current?.id ?? session?.user?.orgId ?? null}
      role={current?.role ?? null}
      name={session?.user?.name}
      email={session?.user?.email}
      image={session?.user?.image}
      billing={context?.billing ?? null}
      loading={shellLoading}
    >
      <TimezoneReporter />
      <LegalAcceptanceGate>
      {shellLoading ? null : blockingContextError ? (
        <AppPageError
          error={contextError}
          retry={() => {
            syncStarted.current = false;
            setSyncFailed(false);
            void contextQuery.refetch();
          }}
        />
      ) : (
        <>
          {context?.sync?.deviceCount ? <NewCollectionBanner refreshKey={context.sync.dataWatermark} /> : null}
          {children}
        </>
      )}
      </LegalAcceptanceGate>
    </WorkspaceShell>
  );
}

export function WorkspaceClientLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceClientLayoutInner>{children}</WorkspaceClientLayoutInner>;
}
