"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CycleViewPicker } from "@/components/dashboard/cycle-view-picker";
import { WorkSpendKpi } from "@/components/features/work-spend-ui";
import { Panel } from "@/components/panel";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { AddSubscriptionSheet } from "./add-subscription-sheet";
import { ToolLogoTile } from "./tool-brand-icon";
import type { ToolDetailData } from "@/lib/queries/dashboard/tool-detail";
import type { CycleView, CycleViewWindows } from "@/lib/dashboard/cycle-view";
import { DEFAULT_ROLLING_PERIOD, type RollingPeriod } from "@/lib/dashboard/period-prefs";
import { formatCompactNumber, formatMicrosAsCurrency, formatUsd } from "@/lib/format";
import { browserMutationInit, useInvalidateAppData } from "@/lib/api/client";
import { isSecondaryQuotaWindow, quotaRemainingLabel, quotaWindowLabel } from "@/lib/quotas/display";
import { cn } from "@/lib/utils";
import { USAGE_WINDOW_PREFERENCES, usageWindowPreferenceLabel, type UsageWindowPreference } from "@/lib/quotas/usage-window";

type PlanRow = ToolDetailData["plans"][number] & {
  cycleSeatMicros: string | bigint;
  estimatedCycleMicros: string | bigint;
};

type DetailProps = Omit<ToolDetailData, "plans"> & {
  plans: PlanRow[];
};

type Quota = DetailProps["quotas"][number];

function quotaPercent(quota: Quota): number | null {
  if (quota.usedPercent == null || Number.isNaN(quota.usedPercent)) return null;
  return Math.min(100, Math.max(0, quota.usedPercent));
}

/** Plain-language pressure: only the top two bands get colour. */
function quotaTone(percent: number | null) {
  if (percent != null && percent >= 90) return { label: "Near limit", text: "text-brand-orange-dark", bar: "var(--brand-orange)" };
  if (percent != null && percent >= 75) return { label: "Watch", text: "text-brand-yellow-dark", bar: "var(--brand-yellow-dark)" };
  return { label: "OK", text: "text-muted-foreground", bar: "var(--primary)" };
}

/** The window most likely to block someone: highest % among plan windows, ignoring bonuses and grants. */
function tightestWindow(windows: Quota[]): Quota | null {
  let best: Quota | null = null;
  for (const quota of windows) {
    if (isSecondaryQuotaWindow(quota.windowType)) continue;
    const percent = quotaPercent(quota);
    if (percent == null) continue;
    const bestPercent = best ? quotaPercent(best) ?? -1 : -1;
    // On a tie, the overall plan allowance is the one people recognise.
    if (!best || percent > bestPercent || (percent === bestPercent && quota.windowType === "plan")) best = quota;
  }
  return best;
}

/** "Resets in 1d 18h" plus the local date and time, instead of a UTC timestamp. */
function resetCopy(resetAt: Date | string | null, verb = "Resets") {
  if (!resetAt) return null;
  const date = resetAt instanceof Date ? resetAt : new Date(resetAt);
  if (Number.isNaN(date.getTime())) return null;
  const absolute = date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return { relative: `${verb} now`, absolute };
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const relative = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return { relative: `${verb} in ${relative}`, absolute };
}

function QuotaMeter({ quota, percent }: { quota: Quota; percent: number }) {
  return (
    <div
      className="h-1.5 w-full bg-muted"
      role="meter"
      aria-label={`${quotaWindowLabel(quota.windowType)} usage`}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="block h-full" style={{ width: `${percent}%`, background: quotaTone(percent).bar }} />
    </div>
  );
}

const MODEL_PREVIEW = 6;

export function ToolProviderDetail({
  data,
  scope = "org",
  cycleView = "current_cycles",
  period = DEFAULT_ROLLING_PERIOD,
  periodLabel = "current billing cycles",
  periodBasePath,
  cycleWindows,
}: {
  data: DetailProps;
  scope?: "org" | "self";
  cycleView?: CycleView;
  period?: RollingPeriod;
  periodLabel?: string;
  periodSuffix?: string;
  periodBasePath?: string;
  cycleWindows?: CycleViewWindows;
}) {
  const router = useRouter();
  const invalidateAppData = useInvalidateAppData();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [modelView, setModelView] = useState<"model" | "person">("model");
  const [showAllModels, setShowAllModels] = useState(false);
  const basePath = periodBasePath ?? `/tools/${data.toolKey}`;
  const isSelf = scope === "self";

  async function refresh() {
    await invalidateAppData();
    router.refresh();
  }

  async function updateSeats(plan: PlanRow, nextCapacity: number) {
    if (nextCapacity < plan.assignedSeats) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/tools/subscriptions/${plan.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seatCapacity: nextCapacity }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Could not update seats");
    else await refresh();
    setSaving(false);
  }

  async function updateUsageWindow(plan: PlanRow, usageWindowPreference: UsageWindowPreference) {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/tools/subscriptions/${plan.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usageWindowPreference }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Could not update usage window");
    else await refresh();
    setSaving(false);
  }

  async function removePlan() {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/tools/subscriptions/${deleteTarget.id}`, browserMutationInit("DELETE"));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? "Could not remove plan");
      setSaving(false);
      return;
    }
    setDeleteTarget(null);
    await refresh();
    setSaving(false);
  }

  async function applyDetected(developerId: string) {
    setApplyingId(developerId);
    setError(null);
    const response = await fetch(`/api/tools/${data.toolKey}/apply-detected`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ developerId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Could not apply detected plan");
    else await refresh();
    setApplyingId(null);
  }

  const peopleByDeveloperId = new Map<string, (typeof data.people)[number]>();
  for (const person of data.people) peopleByDeveloperId.set(person.developerId, person);

  // One row per person: combine all their quota windows, and fold in plan assignment.
  type QuotaGroup = {
    key: string;
    developerId: string | null;
    developerName: string;
    deviceHostname: string | null;
    windows: typeof data.quotas;
  };
  const quotaGroupMap = new Map<string, QuotaGroup>();
  for (const quota of data.quotas) {
    const key = quota.developerId ?? quota.developerName ?? `device:${quota.deviceHostname ?? "org"}`;
    const existing = quotaGroupMap.get(key);
    if (existing) {
      existing.windows.push(quota);
    } else {
      quotaGroupMap.set(key, {
        key,
        developerId: quota.developerId,
        developerName: quota.developerName ?? "Unassigned device",
        deviceHostname: quota.deviceHostname,
        windows: [quota],
      });
    }
  }
  // People with an assignment but no quota windows still appear so the assignment is visible.
  for (const person of data.people) {
    if (quotaGroupMap.has(person.developerId)) continue;
    if (person.coverage === "install_only") continue;
    if (!person.assignment) continue;
    quotaGroupMap.set(person.developerId, {
      key: person.developerId,
      developerId: person.developerId,
      developerName: person.name,
      deviceHostname: person.deviceHostname,
      windows: [],
    });
  }
  // Detected installs / reported plans / usage-only people with no quota or seat yet —
  // otherwise a second Claude user shows in Models ($0.016) and disappears here.
  for (const person of data.people) {
    if (quotaGroupMap.has(person.developerId)) continue;
    if (person.coverage === "install_only") continue;
    if (!person.detected && !person.vendorPlan && !person.assignment) {
      const hasModelUsage = data.modelsByDeveloper.some(
        (row) => row.developerId === person.developerId && (row.requests > 0 || row.cost > 0),
      );
      if (!hasModelUsage) continue;
    }
    quotaGroupMap.set(person.developerId, {
      key: person.developerId,
      developerId: person.developerId,
      developerName: person.name,
      deviceHostname: person.deviceHostname,
      windows: [],
    });
  }
  // Belt-and-suspenders: model rows whose developer never made it into people.
  for (const row of data.modelsByDeveloper) {
    if (!row.developerId || quotaGroupMap.has(row.developerId)) continue;
    if (!(row.requests > 0 || row.cost > 0)) continue;
    quotaGroupMap.set(row.developerId, {
      key: row.developerId,
      developerId: row.developerId,
      developerName: row.developerName,
      deviceHostname: peopleByDeveloperId.get(row.developerId)?.deviceHostname ?? null,
      windows: [],
    });
  }
  // Worst first: whoever is closest to a limit leads; people with nothing reported sink.
  const quotaGroups = Array.from(quotaGroupMap.values())
    .map((group) => {
      const tightest = tightestWindow(group.windows);
      return { ...group, tightest, tightestPercent: tightest ? quotaPercent(tightest) : null };
    })
    .sort((a, b) => (b.tightestPercent ?? -1) - (a.tightestPercent ?? -1) || a.developerName.localeCompare(b.developerName));
  const peopleReporting = quotaGroups.filter((group) => group.windows.length > 0).length;
  const closest = quotaGroups.find((group) => group.tightest) ?? null;
  const closestReset = closest?.tightest ? resetCopy(closest.tightest.resetAt) : null;

  const seatMicros = data.plans.reduce((sum, plan) => sum + BigInt(plan.estimatedCycleMicros), 0n);
  const seatDollars = Number(seatMicros) / 1_000_000;
  const valueMultiple = seatDollars > 0 ? data.kpis.usageCost / seatDollars : null;

  const modelTotals = data.modelsByDeveloper.reduce(
    (acc, row) => {
      acc.requests += row.requests;
      acc.tokens += row.tokens;
      acc.cost += row.cost;
      return acc;
    },
    { requests: 0, tokens: 0, cost: 0 },
  );
  const byModel = Array.from(
    data.modelsByDeveloper
      .reduce((map, row) => {
        const entry = map.get(row.model) ?? { key: row.model, label: row.model, requests: 0, tokens: 0, cost: 0, people: new Set<string>() };
        entry.requests += row.requests;
        entry.tokens += row.tokens;
        entry.cost += row.cost;
        entry.people.add(row.developerId);
        return map.set(row.model, entry);
      }, new Map<string, { key: string; label: string; requests: number; tokens: number; cost: number; people: Set<string> }>())
      .values(),
  ).sort((a, b) => b.cost - a.cost || b.requests - a.requests);
  const byPerson = Array.from(
    data.modelsByDeveloper
      .reduce((map, row) => {
        const entry = map.get(row.developerId) ?? { key: row.developerId, label: row.developerName, requests: 0, tokens: 0, cost: 0, top: row };
        entry.requests += row.requests;
        entry.tokens += row.tokens;
        entry.cost += row.cost;
        if (row.cost > entry.top.cost) entry.top = row;
        return map.set(row.developerId, entry);
      }, new Map<string, { key: string; label: string; requests: number; tokens: number; cost: number; top: (typeof data.modelsByDeveloper)[number] }>())
      .values(),
  ).sort((a, b) => b.cost - a.cost);
  const personView = modelView === "person" && !isSelf;
  const modelRows = personView
    ? byPerson.map((row) => ({ key: row.key, label: row.label, requests: row.requests, tokens: row.tokens, cost: row.cost, detail: `mostly ${row.top.model}` }))
    : byModel.map((row) => ({ key: row.key, label: row.label, requests: row.requests, tokens: row.tokens, cost: row.cost, detail: isSelf ? null : `${row.people.size} ${row.people.size === 1 ? "person" : "people"}` }));
  const visibleModelRows = showAllModels ? modelRows : modelRows.slice(0, MODEL_PREVIEW);
  const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  function toggleExpanded(key: string) {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const planFor = (developerId: string | null) => {
    const person = developerId ? peopleByDeveloperId.get(developerId) ?? null : null;
    if (person?.assignment) return { person, name: person.assignment.planName, source: person.assignment.source === "detected" ? "Detected plan" : "Assigned plan" };
    if (person?.vendorPlan) return { person, name: person.vendorPlan, source: "Reported plan" };
    if (person?.detected) return { person, name: null, source: "Plan unknown" };
    return { person, name: null, source: "No plan signal" };
  };
  const selfPlan = isSelf ? planFor(quotaGroups[0]?.developerId ?? data.people[0]?.developerId ?? null) : null;

  const closestCell = (
    <WorkSpendKpi
      label="Closest to a limit"
      accent={isSelf}
      compactMobile
      className="h-full px-4 sm:px-5"
      value={closest?.tightest && closest.tightestPercent != null
        ? <span className={cn((closest.tightestPercent ?? 0) >= 75 && quotaTone(closest.tightestPercent).text)}>{Math.round(closest.tightestPercent)}%</span>
        : "—"}
      sub={closest?.tightest ? (
        <span title={closestReset?.absolute}>
          {isSelf ? "" : `${closest.developerName} · `}{quotaWindowLabel(closest.tightest.windowType)}{closestReset ? ` · ${closestReset.relative.toLowerCase()}` : ""}
        </span>
      ) : "No limits reported yet"}
    />
  );
  const usageCell = (
    <WorkSpendKpi
      label="Usage at API prices"
      compactMobile
      className="h-full px-4 sm:px-5"
      value={formatUsd(data.kpis.usageCost)}
      sub={
        <span title="What this usage would cost at the vendor's API rates. It is not what you are billed.">
          {valueMultiple && valueMultiple >= 1.5 ? `${Math.round(valueMultiple)}× what you pay · ` : ""}not a bill · {periodLabel}
        </span>
      }
    />
  );

  return (
    <>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/tools" prefetch={false}>{isSelf ? "My tools" : "Tools"}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{data.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-4">
          <ToolLogoTile tool={data.toolKey} size="lg" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.15rem]">{data.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSelf ? "Your limits and the models you use." : "What you pay, who's near a limit, and where the usage goes."}
            </p>
          </div>
        </div>
        <CycleViewPicker view={cycleView} period={period} basePath={basePath} cycleWindows={cycleWindows} />
      </div>

      <Panel padded={false} className="overflow-hidden">
        <div className="-mb-px -mr-px grid grid-cols-2 lg:grid-cols-4 [&>*]:border-b [&>*]:border-r">
          {isSelf ? (
            <>
              {closestCell}
              {usageCell}
              <WorkSpendKpi
                label="Requests"
                compactMobile
                className="h-full px-4 sm:px-5"
                value={formatCompactNumber(data.kpis.requests)}
                sub={`${formatCompactNumber(data.kpis.tokens)} tokens · ${periodLabel}`}
              />
              <WorkSpendKpi
                label="Your plan"
                compactMobile
                className="h-full px-4 sm:px-5"
                value={<span className="text-2xl">{selfPlan?.name ?? "Unknown"}</span>}
                sub={selfPlan?.source}
              />
            </>
          ) : (
            <>
              <WorkSpendKpi
                label="You pay"
                accent
                compactMobile
                className="h-full px-4 sm:px-5"
                value={seatMicros > 0n ? <span className="whitespace-nowrap">{formatMicrosAsCurrency(seatMicros)}<span className="ml-1 text-base font-normal text-muted-foreground">/ cycle</span></span> : "—"}
                sub={data.kpis.seatsPurchased
                  ? `${data.kpis.seatsAssigned} of ${data.kpis.seatsPurchased} ${data.kpis.seatsPurchased === 1 ? "seat" : "seats"} assigned${data.kpis.seatsFree ? ` · ${data.kpis.seatsFree} free` : ""}`
                  : "No plan recorded yet"}
              />
              {usageCell}
              <WorkSpendKpi
                label="People"
                compactMobile
                className="h-full px-4 sm:px-5"
                value={data.kpis.people}
                sub={`${peopleReporting} reporting limits · ${data.kpis.devices} ${data.kpis.devices === 1 ? "device" : "devices"}${data.kpis.peopleInstallOnly ? ` · ${data.kpis.peopleInstallOnly} installed, unused` : ""}`}
              />
              {closestCell}
            </>
          )}
        </div>
      </Panel>

      {error ? (
        <Alert variant="destructive" className="mt-8 rounded-none">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="mt-12">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{isSelf ? "Your limits." : "Limits."}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSelf ? "Your tightest allowance right now, from your machine." : "Each person's tightest allowance right now, closest to the limit first."}
            </p>
          </div>
          {quotaGroups.length && !isSelf ? (
            <p className="text-xs text-muted-foreground">{peopleReporting} of {quotaGroups.length} reporting</p>
          ) : null}
        </div>
        {quotaGroups.length ? (
          <Panel padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{isSelf ? "Plan" : "Person"}</th>
                  <th className="px-4 py-2.5 font-medium">Tightest limit</th>
                  <th className="w-40 px-4 py-2.5 font-medium">Resets</th>
                  <th className="w-28 px-4 py-2.5 text-right font-medium"><span className="sr-only">Other limits</span></th>
                </tr>
              </thead>
              <tbody>
                {quotaGroups.map((group) => {
                  const { person, name: planName, source } = planFor(group.developerId);
                  const tight = group.tightest;
                  const percent = group.tightestPercent;
                  const tone = quotaTone(percent);
                  const reset = tight ? resetCopy(tight.resetAt) : null;
                  const others = group.windows.filter((quota) => quota !== tight);
                  const open = expanded.has(group.key);
                  return (
                    <Fragment key={group.key}>
                      <tr className={cn("align-top", open ? "" : "border-b last:border-b-0")}>
                        <td className="px-4 py-3">
                          {isSelf ? null : <p className="font-medium">{group.developerName}</p>}
                          <p className={cn("text-xs text-muted-foreground", isSelf && "text-sm text-foreground")}>
                            {planName ? <span className="font-medium text-foreground">{planName}</span> : null}
                            {planName ? " · " : ""}{source}
                            {group.deviceHostname && !isSelf ? <span className="block truncate">{group.deviceHostname}</span> : null}
                          </p>
                          {person?.planMismatch && person.mappedCatalogPlanKey && !isSelf ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="bg-brand-orange-pale px-1.5 py-0.5 text-brand-orange-dark">
                                Reports {person.mappedCatalogPlanKey}, assigned {person.assignment?.catalogPlanKey ?? "another plan"}
                              </span>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={applyingId === person.developerId}
                                onClick={() => void applyDetected(person.developerId)}
                              >
                                {applyingId === person.developerId ? <Loader2 className="size-3 animate-spin" /> : "Use detected plan"}
                              </Button>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {tight && percent != null ? (
                            <div className="max-w-sm">
                              <div className="flex items-baseline justify-between gap-3">
                                <span>{quotaWindowLabel(tight.windowType)}</span>
                                <span className="tabular-nums">
                                  <span className="font-semibold">{Math.round(percent)}%</span>
                                  <span className={cn("ml-2 text-xs", tone.text)}>{tone.label}</span>
                                </span>
                              </div>
                              <div className="mt-1.5"><QuotaMeter quota={tight} percent={percent} /></div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {group.windows.length
                                ? "Only balances reported"
                                : planName
                                  ? "No live limits yet. They appear once the tool is signed in on this machine."
                                  : "No limits reported yet"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {reset ? <span title={reset.absolute}>{reset.relative}<span className="block text-muted-foreground">{reset.absolute}</span></span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {others.length ? (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => toggleExpanded(group.key)}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              {others.length} more
                              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-b bg-muted/20 last:border-b-0">
                          <td />
                          <td colSpan={3} className="px-4 pb-3 pt-1">
                            <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                              {others.map((quota) => {
                                const otherPercent = quotaPercent(quota);
                                const secondary = isSecondaryQuotaWindow(quota.windowType);
                                const otherReset = resetCopy(quota.resetAt, secondary ? "Expires" : "Resets");
                                return (
                                  <li key={`${quota.windowType}-${quota.deviceHostname ?? "org"}`} className="text-xs">
                                    <div className="flex items-baseline justify-between gap-3">
                                      <span className="text-foreground">{quotaWindowLabel(quota.windowType)}</span>
                                      <span className="tabular-nums text-foreground">
                                        {otherPercent != null ? `${Math.round(otherPercent)}%` : quotaRemainingLabel(quota.creditsRemaining, quota.windowType) ?? "—"}
                                      </span>
                                    </div>
                                    {otherPercent != null ? <div className="mt-1"><QuotaMeter quota={quota} percent={otherPercent} /></div> : null}
                                    {otherReset ? <p className="mt-1 text-muted-foreground" title={otherReset.absolute}>{otherReset.relative}</p> : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        ) : (
          <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
            <EmptyDescription>No limits yet. They appear after the agent reports.</EmptyDescription>
          </Empty>
        )}
      </section>

      <section className="mt-12">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{isSelf ? "Your models." : "Models."}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {byModel.length
                ? `${byModel.length} ${byModel.length === 1 ? "model" : "models"} · ${modelTotals.requests.toLocaleString()} requests · ${formatUsd(modelTotals.cost)} at API prices · ${periodLabel}`
                : `Where the usage went · ${periodLabel}`}
            </p>
          </div>
          {!isSelf && byPerson.length > 1 ? (
            <div role="group" aria-label="Group models" className="flex gap-3 text-sm">
              {(["model", "person"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={modelView === view}
                  onClick={() => { setModelView(view); setShowAllModels(false); }}
                  className={modelView === view ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
                >
                  {view === "model" ? "By model" : "By person"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {modelRows.length ? (
          <Panel padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{personView ? "Person" : "Model"}</th>
                  <th className="w-1/4 px-4 py-2.5 font-medium">Share of cost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Requests</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Tokens</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Per request</th>
                </tr>
              </thead>
              <tbody>
                {visibleModelRows.map((row) => {
                  const costShare = share(row.cost, modelTotals.cost);
                  const requestShare = share(row.requests, modelTotals.requests);
                  const pricey = !personView && costShare >= 0.15 && costShare >= requestShare * 2;
                  return (
                    <tr key={row.key} className="border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className={cn("font-medium", !personView && "font-mono text-[13px]")}>{row.label}</span>
                        {row.detail ? <span className="block text-[11px] text-muted-foreground">{row.detail}</span> : null}
                        {pricey ? (
                          <span className="mt-0.5 block text-[11px] text-brand-orange-dark">{pct(costShare)} of cost from {pct(requestShare)} of requests</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 bg-muted" aria-hidden>
                            <div className="h-full" style={{ width: `${costShare * 100}%`, background: pricey ? "var(--brand-orange)" : "var(--primary)" }} />
                          </div>
                          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{pct(costShare)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.requests.toLocaleString()}</td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{formatCompactNumber(row.tokens)}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatUsd(row.cost)}</td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell">
                        {row.requests ? formatUsd(row.cost / row.requests) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {modelRows.length > MODEL_PREVIEW ? (
              <button
                type="button"
                onClick={() => setShowAllModels((value) => !value)}
                className="w-full border-t px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              >
                {showAllModels ? "Show fewer" : `Show all ${modelRows.length}`}
              </button>
            ) : null}
          </Panel>
        ) : (
          <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
            <EmptyDescription>No model usage reported for this period yet.</EmptyDescription>
          </Empty>
        )}
      </section>

      {!isSelf ? (
      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Plans and seats.</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              What you&apos;ve recorded buying. Changes here update UseJunction&apos;s records, not your {data.name} account.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add plan
          </Button>
        </div>

        {data.plans.length ? (
          <Panel padded={false} className="divide-y">
            {data.plans.map((plan) => (
              <div key={plan.id} className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{plan.name}</p>
                      {plan.priceSource === "detected" && <Badge variant="outline">Detected</Badge>}
                      {plan.customPrice && <Badge variant="outline">Custom price</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatMicrosAsCurrency(plan.cycleSeatMicros)} per seat / cycle ·{" "}
                      <span className="capitalize">{plan.billingCadence}</span> billing
                    </p>
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      Limit to track
                      <select
                        value={plan.usageWindowPreference as UsageWindowPreference}
                        disabled={saving}
                        onChange={(event) => void updateUsageWindow(plan, event.target.value as UsageWindowPreference)}
                        className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
                      >
                        {Array.from(new Set([
                          ...USAGE_WINDOW_PREFERENCES,
                          plan.usageWindowPreference,
                        ])).map((preference) => (
                          <option key={preference} value={preference}>
                            {usageWindowPreferenceLabel(preference)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {plan.priceSource === "detected" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Auto-synced from device usage. Update when the vendor plan differs.
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${plan.name}`}
                    disabled={saving}
                    onClick={() => setDeleteTarget(plan)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {plan.assignedSeats} assigned · {plan.availableSeats} available
                    </p>
                    <p className="text-xs text-muted-foreground">{plan.seatCapacity} purchased seats</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Remove a seat"
                      disabled={saving || plan.seatCapacity <= Math.max(1, plan.assignedSeats)}
                      onClick={() => void updateSeats(plan, plan.seatCapacity - 1)}
                    >
                      −
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{plan.seatCapacity}</span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Add a seat"
                      disabled={saving}
                      onClick={() => void updateSeats(plan, plan.seatCapacity + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        ) : (
          <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
            <EmptyDescription>
              No company plans for this tool yet. Add one, or connect a machine to auto-sync.
            </EmptyDescription>
          </Empty>
        )}
      </section>
      ) : null}

      {!isSelf ? (
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md gap-5">
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              {(deleteTarget?.assignedSeats ?? 0) > 0
                ? `This removes the plan and unassigns ${deleteTarget?.assignedSeats} developer ${(deleteTarget?.assignedSeats ?? 0) === 1 ? "seat" : "seats"}.`
                : "This removes the plan from your company tools."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void removePlan()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}

      {!isSelf ? (
      <AddSubscriptionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        initialToolKey={data.toolKey}
        onCreated={refresh}
      />
      ) : null}
    </>
  );
}
