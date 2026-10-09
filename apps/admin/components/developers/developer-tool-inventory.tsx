"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { BarChart3, ChevronDown, ChevronUp, Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useErrorMessageToast } from "@/components/app-data-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SignalsKpi } from "@/components/signals/signals-ui";
import { CycleUtilizationBar } from "@/components/dashboard/cycle-utilization-bar";
import { cn } from "@/lib/utils";
import { AddSubscriptionSheet } from "@/components/tools/add-subscription-sheet";
import { Panel } from "@/components/panel";
import {
  aggregateRosterPlanUsage,
  RosterPlanUsage,
  type RosterPlanUsagePlan,
} from "@/components/developers/roster-plan-usage";
import { ROLE_LABELS, roleDisplayLabel, roleUpdateSuccessMessage } from "@/components/developers/member-role-select";
import { SubscriptionChoices } from "@/components/developers/member-plans-panel";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCompactNumber } from "@/lib/format";
import { userFacingError } from "@/lib/errors/user-facing";
import {
  ASSIGNABLE_ROLES,
  canManageSettings,
  type OrganizationRole,
} from "@/lib/rbac/permissions";
import type { PlanUsageDeveloperRow } from "@/lib/insights/contracts/plan-usage.v1";
import { countActiveDevices } from "@/lib/devices/presence";
import { browserMutationInit, useAppQuery, useInvalidateAppData } from "@/lib/api/client";
import { teamsKey } from "@/lib/app-pages/query-keys";
import type { TeamSummary } from "@/lib/teams";
import { Input } from "@/components/ui/input";

const NO_TEAM = "none";

type Subscription = {
  id: string;
  toolKey: string | null;
  name: string;
  tier: string | null;
  seatCapacity: number;
  assignedSeats: number;
  availableSeats: number;
  billingCadence: string;
  cycleSeatMicros: string;
  estimatedCycleMicros: string;
};
type Developer = {
  id: string;
  name: string;
  email: string;
  authUserId: string | null;
  teamId?: string | null;
  role: string;
  requests: number;
  devices: Array<{
    id: string;
    hostname?: string;
    status?: string;
    lastSeenAt?: string;
    toolInstallations: Array<{ toolName: string }>;
  }>;
  toolEvidence: Array<{ toolName: string }>;
};

const utcToday = () => new Date().toISOString().slice(0, 10);

type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function asAssignableRole(role: string): AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role)
    ? (role as AssignableRole)
    : "user";
}

function planUsageMap(rows: PlanUsageDeveloperRow[]) {
  return new Map(rows.map((developer) => [developer.developerId, developer]));
}

export function DeveloperToolInventory({
  showSummary = true,
  initialDevelopers,
  initialSubscriptions,
  initialPlanUsage,
  planUsageLoading = false,
  planUsageError = null,
  retryPlanUsage,
  periodSuffix = "30d",
  ghostRows,
}: {
  showSummary?: boolean;
  /** Faded sample rows under the roster while no machine reports yet. */
  ghostRows?: ReactNode;
  initialDevelopers: Developer[];
  initialSubscriptions: Subscription[];
  initialPlanUsage?: PlanUsageDeveloperRow[];
  planUsageLoading?: boolean;
  planUsageError?: string | null;
  retryPlanUsage?: () => void;
  periodSuffix?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const teamFilter = searchParams.get("team");
  const { data: session } = useSession();
  const canAssignRoles = canManageSettings(session?.user?.role as OrganizationRole | null | undefined);
  const invalidateAppData = useInvalidateAppData();
  const [developers, setDevelopers] = useState<Developer[]>(initialDevelopers);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(initialSubscriptions);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [addSubscriptionOpen, setAddSubscriptionOpen] = useState(false);
  const [planUsageByDeveloper, setPlanUsageByDeveloper] = useState(() => planUsageMap(initialPlanUsage ?? []));
  const [search, setSearch] = useState("");
  const teamsQuery = useAppQuery<{ teams: TeamSummary[] }>(teamsKey, "/api/app/teams", { staleTime: 60_000 });
  const teams = useMemo(() => teamsQuery.data?.teams ?? [], [teamsQuery.data]);
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const canManageTeams = canAssignRoles && teams.length > 0;

  useErrorMessageToast(error);
  useErrorMessageToast(planUsageError, { retry: retryPlanUsage });
  useEffect(() => {
    setDevelopers(initialDevelopers);
    setSubscriptions(initialSubscriptions);
    setPlanUsageByDeveloper(planUsageMap(initialPlanUsage ?? []));
  }, [initialDevelopers, initialSubscriptions, initialPlanUsage]);

  const canBulkAssign = developers.length > 1 && subscriptions.some((subscription) => subscription.availableSeats > 0);
  const canSelect = canBulkAssign || (canManageTeams && developers.length > 1);
  const visibleDevelopers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return developers.filter((developer) => {
      if (teamFilter === NO_TEAM && developer.teamId) return false;
      if (teamFilter && teamFilter !== NO_TEAM && developer.teamId !== teamFilter) return false;
      if (!needle) return true;
      return developer.name.toLowerCase().includes(needle) || developer.email.toLowerCase().includes(needle);
    });
  }, [developers, search, teamFilter]);

  const summary = useMemo(() => {
    const devices = developers.flatMap((developer) => developer.devices);
    const { active: activeMachines, total: enrolledMachines } = countActiveDevices(devices);

    const peopleWithPlans = developers.filter((developer) => {
      const usage = planUsageByDeveloper.get(developer.id);
      return (usage?.plans.length ?? 0) > 0;
    }).length;
    const planCoveragePercent =
      developers.length > 0 ? Math.round((peopleWithPlans / developers.length) * 100) : null;

    const allPlans: RosterPlanUsagePlan[] = [...planUsageByDeveloper.values()].flatMap((row) =>
      row.plans.map((plan) => ({
        toolName: plan.toolName,
        toolKey: plan.toolKey,
        planName: plan.planName,
        primaryRatio: plan.primaryRatio,
        verdict: plan.verdict,
      })),
    );
    const teamUsage = aggregateRosterPlanUsage(allPlans);
    const avgPercent = teamUsage.avgRatio != null ? teamUsage.avgRatio * 100 : null;

    return {
      activeMachines,
      enrolledMachines,
      memberCount: developers.length,
      peopleWithPlans,
      planCoveragePercent,
      avgPercent,
      teamUsage,
    };
  }, [developers, planUsageByDeveloper]);

  async function assignBulk(subscription: Subscription) {
    const ids = [...selected];
    setSaving(`bulk:${subscription.id}`);
    setError(null);
    const response = await fetch("/api/billing/assignments/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        developerIds: ids,
        assignment: {
          planTemplateId: subscription.id,
          startDate: utcToday(),
          seatCount: 1,
          seatStatus: "active",
        },
      }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Could not assign subscription");
    else {
      setSelected(new Set());
      setBulkOpen(false);
      await invalidateAppData();
      router.refresh();
    }
    setSaving(null);
  }

  async function moveToTeam(developerIds: string[], teamId: string | null) {
    setSaving(`team:${developerIds.join(",")}`);
    setError(null);
    const response = await fetch("/api/app/teams/members", browserMutationInit("POST", { developerIds, teamId }));
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setSaving(null);
    if (!response.ok) {
      setError(userFacingError(body.error, "Could not change the team."));
      return;
    }
    setDevelopers((current) => current.map((developer) => (developerIds.includes(developer.id) ? { ...developer, teamId } : developer)));
    setSelected(new Set());
    toast.success(teamId ? `Moved to ${teamById.get(teamId)?.name ?? "team"}.` : "Removed from team.");
    await invalidateAppData();
  }

  async function changeRole(developerId: string, role: AssignableRole) {
    const memberName = developers.find((developer) => developer.id === developerId)?.name;
    setSaving(`role:${developerId}`);
    setError(null);
    const response = await fetch(`/api/developers/${developerId}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(userFacingError(body.error, "Could not update role."));
      setSaving(null);
      return;
    }
    const nextRole = body.role ?? role;
    setDevelopers((current) =>
      current.map((developer) =>
        developer.id === developerId ? { ...developer, role: nextRole } : developer,
      ),
    );
    setSaving(null);
    toast.success(roleUpdateSuccessMessage(nextRole, memberName));
    await invalidateAppData();
    router.refresh();
  }

  return (
    <div className="space-y-10">
      {showSummary ? (
        <div className="grid grid-cols-2 items-stretch gap-y-5 sm:gap-y-8 xl:grid-cols-4">
          <SignalsKpi
            label="Active machines"
            hero
            accent
            compactMobile
            value={
              summary.enrolledMachines > 0
                ? `${summary.activeMachines}/${summary.enrolledMachines}`
                : "0"
            }
            sub={
              summary.enrolledMachines > 0
                ? "heartbeat in last 45m · enrolled"
                : "no machines enrolled yet"
            }
          />
          <SignalsKpi
            label="Members"
            compactMobile
            className="border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
            value={summary.memberCount}
            sub="on the roster"
          />
          <SignalsKpi
            label="Plan coverage"
            compactMobile
            className="border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
            value={
              planUsageLoading
                ? "…"
                : summary.memberCount > 0
                ? `${summary.peopleWithPlans}/${summary.memberCount}`
                : "0"
            }
            sub={
              planUsageLoading
                ? "loading plan usage"
                : planUsageError
                  ? "plan usage unavailable"
                  : summary.planCoveragePercent != null
                ? `${summary.planCoveragePercent}% with an assigned plan`
                : "invite people, then assign plans"
            }
          />
          <SignalsKpi
            label="Plan usage"
            compactMobile
            className="border-l-2 border-border-strong pl-3 pr-2 sm:pl-4 sm:pr-3"
            value={planUsageLoading ? "…" : summary.avgPercent != null ? `${summary.avgPercent.toFixed(0)}%` : "—"}
            sub={
              planUsageLoading
                ? "loading plan usage"
                : planUsageError
                  ? "plan usage unavailable"
                  : summary.teamUsage.withSignal.length > 0
                ? `avg across ${summary.teamUsage.withSignal.length} ${
                    summary.teamUsage.withSignal.length === 1 ? "plan" : "plans"
                  }`
                : "waiting for quota signal"
            }
            footer={
              !planUsageLoading && !planUsageError ? (
                <CycleUtilizationBar
                  percent={summary.avgPercent}
                  displayPercent={summary.avgPercent}
                  verdictCode={summary.teamUsage.verdict?.code ?? null}
                  label="Team"
                />
              ) : null
            }
          />
        </div>
      ) : null}

      <Panel as="section" padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-muted/25 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Members.</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {developers.length
                ? `${visibleDevelopers.length === developers.length ? developers.length : `${visibleDevelopers.length} of ${developers.length}`} on the roster · open anyone for plans, their device, and usage`
                : "Invite people, then assign plans from their profile."}
            </p>
          </div>
          {developers.length > 5 ? (
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Search people</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or email"
                className="h-9 rounded-none pl-8 text-sm"
              />
            </label>
          ) : null}
        </div>

        <div>
          {canSelect && selected.size > 0 ? (
            <div className="mx-5 mt-4 mb-1 flex flex-wrap items-center gap-3 bg-muted/40 px-4 py-3">
              <div className="mr-auto flex items-center gap-2 text-sm font-medium">
                <Users className="size-4" />
                {selected.size} selected
              </div>
              {canManageTeams ? (
                <Select onValueChange={(value) => void moveToTeam([...selected], value === NO_TEAM ? null : value)} disabled={Boolean(saving)}>
                  <SelectTrigger className="h-8 w-[160px] rounded-none" aria-label="Move selected people to a team">
                    <SelectValue placeholder="Move to team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                    <SelectItem value={NO_TEAM}>No team</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {canBulkAssign ? (
              <div className="relative">
                <Button size="sm" className="rounded-none" onClick={() => setBulkOpen(!bulkOpen)}>
                  Assign plan {bulkOpen ? <ChevronUp /> : <ChevronDown />}
                </Button>
                {bulkOpen ? (
                  <div className="absolute right-0 top-10 z-20 w-80 border bg-popover p-2 shadow-lg">
                    <SubscriptionChoices
                      subscriptions={subscriptions.filter((subscription) => subscription.availableSeats > 0)}
                      requested={selected.size}
                      saving={saving}
                      onSelect={assignBulk}
                      onAddSubscription={() => setAddSubscriptionOpen(true)}
                    />
                  </div>
                ) : null}
              </div>
              ) : null}
              <Button variant="ghost" size="sm" className="rounded-none" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {!developers.length ? (
            <Empty className="min-h-0 gap-1 border-0 px-5 py-6 md:px-5 md:py-6">
              <EmptyDescription>Invite people, then open their profile to assign plans.</EmptyDescription>
            </Empty>
          ) : !visibleDevelopers.length ? (
            <Empty className="min-h-0 gap-1 border-0 px-5 py-6 md:px-5 md:py-6">
              <EmptyDescription>Nobody matches this search or team.</EmptyDescription>
            </Empty>
          ) : (
            <ul className="divide-y">
              {visibleDevelopers.map((developer) => {
                const machineCount = developer.devices.length;
                const meta = [
                  machineCount
                    ? `${machineCount} ${machineCount === 1 ? "machine" : "machines"}`
                    : "No machines",
                  developer.requests > 0 ? `${formatCompactNumber(developer.requests)} requests · ${periodSuffix}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const planUsage = planUsageByDeveloper.get(developer.id);
                const rosterPlans: RosterPlanUsagePlan[] =
                  planUsage?.plans.map((plan) => ({
                    toolName: plan.toolName,
                    toolKey: plan.toolKey,
                    planName: plan.planName,
                    primaryRatio: plan.primaryRatio,
                    verdict: plan.verdict,
                  })) ?? [];
                const savingRole = saving === `role:${developer.id}`;
                const currentRole = asAssignableRole(developer.role);
                const roleLocked = developer.role === "owner";

                return (
                  <li
                    key={developer.id}
                    className="group transition-colors hover:bg-muted/40 has-[:focus-visible]:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-start gap-3 px-5 py-5">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${developer.name}`}
                          checked={selected.has(developer.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              event.target.checked ? next.add(developer.id) : next.delete(developer.id);
                              return next;
                            })
                          }
                          className="mt-1 size-4 shrink-0 rounded border-input accent-primary"
                        />
                      ) : null}
                      <Link
                        href={`/team/${developer.id}`}
                        prefetch={false}
                        className="grid min-w-0 flex-1 gap-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-start"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium tracking-tight transition-colors group-hover:text-foreground">
                            {developer.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{developer.email}</p>
                          {developer.teamId && teamById.get(developer.teamId) && !canManageTeams ? (
                            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="size-2" style={{ background: teamById.get(developer.teamId)?.color ?? "var(--muted-foreground)" }} aria-hidden />
                              {teamById.get(developer.teamId)?.name}
                            </p>
                          ) : null}
                          {meta ? <p className="mt-1.5 text-xs text-muted-foreground">{meta}</p> : null}
                          {rosterPlans.length ? <RosterPlanUsage plans={rosterPlans} /> : null}
                        </div>

                        <span
                          aria-hidden
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "pointer-events-none shrink-0 self-start rounded-none transition-colors group-hover:border-foreground/25 group-hover:bg-background",
                          )}
                        >
                          <BarChart3 className="transition-transform group-hover:scale-110" />
                          See Usage
                        </span>
                      </Link>
                      {canAssignRoles && !roleLocked ? (
                        <Select
                          value={currentRole}
                          onValueChange={(next) => void changeRole(developer.id, next as AssignableRole)}
                          disabled={Boolean(saving)}
                        >
                          <SelectTrigger
                            className="h-8 w-[148px] shrink-0 self-start rounded-none"
                            aria-label={`Role for ${developer.name}`}
                          >
                            {savingRole ? <Loader2 className="size-3.5 animate-spin" /> : <SelectValue />}
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((item) => (
                              <SelectItem key={item} value={item}>
                                {ROLE_LABELS[item]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="shrink-0 self-start font-normal">
                          {roleDisplayLabel(developer.role)}
                        </Badge>
                      )}
                      {canManageTeams ? (
                        <Select
                          value={developer.teamId && teamById.has(developer.teamId) ? developer.teamId : NO_TEAM}
                          onValueChange={(value) => void moveToTeam([developer.id], value === NO_TEAM ? null : value)}
                          disabled={Boolean(saving)}
                        >
                          <SelectTrigger className="h-8 w-[148px] shrink-0 self-start rounded-none" aria-label={`Team for ${developer.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {teams.map((team) => (
                              <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                            ))}
                            <SelectItem value={NO_TEAM}>No team</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {ghostRows}
        </div>
      </Panel>

      <AddSubscriptionSheet
        open={addSubscriptionOpen}
        onOpenChange={setAddSubscriptionOpen}
        onCreated={() => {
          void invalidateAppData();
          router.refresh();
        }}
      />
    </div>
  );
}
