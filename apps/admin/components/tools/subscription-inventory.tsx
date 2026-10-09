"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/page-header";
import { SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { cn } from "@/lib/utils";
import { formatMicrosAsCurrency } from "@/lib/format";
import { AddSubscriptionSheet } from "./add-subscription-sheet";
import { CostOverviewView } from "./cost-overview-view";
import { CostGhostRows } from "./cost-ghost-rows";
import type { CostOverview } from "@/lib/queries/tools/cost-overview";
import { ToolLogoTile } from "./tool-brand-icon";
import { subscriptionToolKeys } from "@/lib/tools/catalog";
import type { DashboardToolsData } from "@/lib/queries/dashboard/tools";
import { ExportCsvButton } from "@/components/export-csv-button";
import { TeamFilter } from "@/components/team-filter";
import { microsToDollarsCell, type CsvCell } from "@/lib/csv";
import { toolDisplayName } from "@/lib/tools/catalog";

/** One row per tool, matching the "By tool" table, for spreadsheets and finance reviews. */
function costCsvRows(overview: CostOverview): CsvCell[][] {
  return overview.tools.map((tool) => {
    const renewal = [...tool.plans].sort((a, b) => a.renewsOn.localeCompare(b.renewsOn))[0];
    return [
      toolDisplayName(tool.toolKey),
      tool.plans.map((plan) => plan.name).join("; ") || "Pay as you go",
      tool.seatsPaid,
      tool.seatsAssigned,
      tool.activePeople,
      microsToDollarsCell(tool.seatsMonthlyMicros),
      tool.seatsPriceTag ?? "",
      microsToDollarsCell(tool.usageToDateMicros),
      tool.usageBasis === "pay_as_you_go" ? "pay as you go (billed)" : "within plan (usage value, not billed)",
      renewal?.renewsOn ?? "",
    ];
  });
}

// API Credits UI intentionally omitted; ApiCreditPool + /api/tools/api-credit-pools remain frozen.

type CatalogTool = {
  key: string;
  name: string;
  shortName: string;
  aliases: readonly string[];
  sourceUrl: string;
  lastVerifiedAt: string;
  plans: Array<{
    key: string;
    name: string;
    tier: string;
    description: string;
    prices: Partial<Record<"weekly" | "monthly" | "annual" | "custom", string>>;
    includedCycleMicros: string;
    customPrice?: boolean;
    minimumSeats?: number;
  }>;
};
type Subscription = {
  id: string;
  toolKey: string | null;
  catalogPlanKey: string | null;
  name: string;
  tier: string | null;
  billingCadence: string;
  seatCapacity: number;
  cycleSeatMicros: string | bigint;
  estimatedCycleMicros: string | bigint;
  assignedSeats: number;
  availableSeats: number;
  customPrice: boolean;
  active: boolean;
};

function matchesCatalogTool(subscriptionToolKey: string | null, catalogToolKey: string) {
  if (!subscriptionToolKey) return false;
  return (subscriptionToolKeys(catalogToolKey) as readonly string[]).includes(subscriptionToolKey);
}

export function SubscriptionInventory({
  detected,
  initialCatalog,
  initialSubscriptions,
  overview = null,
  team = null,
  hasLocalSync = false,
  title = "Cost.",
  description = "What you pay for this month, what sits idle, and what to change.",
  onChanged,
  children,
}: {
  detected: DashboardToolsData | null;
  initialCatalog?: CatalogTool[];
  initialSubscriptions?: Subscription[];
  overview?: CostOverview | null;
  /** Set when the page is scoped to one team's seats. */
  team?: { id: string; name: string } | null;
  hasLocalSync?: boolean;
  title?: string;
  description?: string;
  /** Called after a plan is added so the cost overview can refetch. */
  onChanged?: () => void;
  children?: ReactNode;
}) {
  const [catalog, setCatalog] = useState<CatalogTool[]>(initialCatalog ?? []);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(initialSubscriptions ?? []);
  const [loading, setLoading] = useState(initialSubscriptions === undefined);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addToolKey, setAddToolKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Catalog data is static and arrives in the client bundle. Refresh only
    // the mutable subscription list after a successful mutation.
    const subscriptionsRes = await fetch("/api/tools/subscriptions");
    const subscriptionsJson = await subscriptionsRes.json().catch(() => ({}));
    if (!subscriptionsRes.ok) {
      setError(subscriptionsJson.error ?? "Could not load subscriptions");
    } else {
      setSubscriptions(subscriptionsJson.subscriptions ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialCatalog) setCatalog(initialCatalog);
    if (initialSubscriptions) {
      setSubscriptions(initialSubscriptions);
      setLoading(false);
    }
  }, [initialCatalog, initialSubscriptions]);

  const groups = useMemo(
    () =>
      catalog
        .map((tool) => ({
          tool,
          subscriptions: subscriptions.filter((subscription) =>
            matchesCatalogTool(subscription.toolKey, tool.key),
          ),
        }))
        .filter((group) => group.subscriptions.length > 0),
    [catalog, subscriptions],
  );
  const totals = useMemo(
    () => ({
      tools: groups.length,
      purchased: subscriptions.reduce((sum, item) => sum + item.seatCapacity, 0),
      available: subscriptions.reduce((sum, item) => sum + item.availableSeats, 0),
      cycle: subscriptions.reduce((sum, item) => sum + BigInt(item.estimatedCycleMicros), BigInt(0)),
    }),
    [groups.length, subscriptions],
  );

  // The By tool table already lists every plan with its seats and cost, so the
  // plan list below only shows when there is no overview to carry it.
  const showPlanList = !overview?.tools.length || !groups.length;
  // Nothing bought and nothing used yet: draw sample plans so the empty panel shows what will land there.
  const showSample = !loading && !error && !groups.length && !overview?.tools.length;
  const addButton = (
    <Button size="sm" className="rounded-none" onClick={() => openAdd()}>
      <Plus /> Add tool
    </Button>
  );

  function openAdd(toolKey?: string) {
    setAddToolKey(toolKey ?? null);
    setError(null);
    setAddOpen(true);
  }

  return (
    <>
      <PageHeader
        title={team ? `Cost · ${team.name}.` : title}
        description={team ? `Seats held by ${team.id === "none" ? "people with no team" : team.name} and their usage this month. Unassigned seats belong to the whole workspace, so they are not shown here.` : description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TeamFilter />
            {overview?.tools.length ? (
              <ExportCsvButton
                name={team ? `cost-${team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "cost"}
                header={["Tool", "Plans", "Seats paid", "Seats assigned", "People using it (30d)", "Seats per month (USD)", "Price basis", "Usage this month (USD)", "Usage basis", "Next renewal"]}
                rows={() => costCsvRows(overview)}
              />
            ) : null}
          </div>
        }
      >
        {children}
      </PageHeader>

      {overview ? <CostOverviewView data={overview} tableAction={showPlanList ? undefined : addButton} /> : null}

      {showPlanList ? (
        <div className="space-y-10">
          <div className={cn("grid items-start gap-y-8 sm:grid-cols-2 xl:grid-cols-4", overview && "hidden")}>
            <SignalsKpi
              label="Active tools"
              hero
              className="pl-5"
              value={totals.tools}
              sub="Configured subscriptions"
            />
            <SignalsKpi
              label="Purchased seats"
              className="sm:border-l sm:border-border sm:pl-8"
              value={totals.purchased}
              sub="Across every plan"
            />
            <SignalsKpi
              label="Available seats"
              className="xl:border-l xl:border-border xl:pl-8"
              value={totals.available}
              sub="Ready to assign"
            />
            <SignalsKpi
              label="Subscription cycle cost"
              className="sm:border-l sm:border-border sm:pl-8"
              value={formatMicrosAsCurrency(totals.cycle)}
              sub="Current cycles"
            />
          </div>

          <Panel as="section">
            <SignalsSectionHeader
              title="Manage plans."
              description="Plans and seats your team pays for. Edit a plan to enter your real price."
              bordered
              action={addButton}
            />
            {error ? (
              <Alert variant="destructive" className="mb-4 rounded-none">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {loading ? (
              <div className="flex min-h-48 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading subscriptions
              </div>
            ) : groups.length ? (
              <ul>
                {groups.map(({ tool, subscriptions: items }) => {
                  const purchased = items.reduce((sum, item) => sum + item.seatCapacity, 0);
                  const assigned = items.reduce((sum, item) => sum + item.assignedSeats, 0);
                  const cycle = items.reduce((sum, item) => sum + BigInt(item.estimatedCycleMicros), BigInt(0));
                  const summary = items.map((item) => `${item.seatCapacity} ${item.name}`).join(" · ");
                  return (
                    <li key={tool.key}>
                      <Link
                        href={`/tools/${tool.key}`}
                        prefetch={false}
                        className="group grid w-full gap-5 py-5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/40 md:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)_auto] md:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <ToolLogoTile tool={tool.key} size="lg" />
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold tracking-tight">{tool.name}</h3>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm tabular-nums">
                          <div>
                            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                              Seats
                            </span>
                            {assigned} / {purchased}
                          </div>
                          <div>
                            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                              Available
                            </span>
                            {purchased - assigned}
                          </div>
                          <div>
                            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                              Cycle cost
                            </span>
                            {formatMicrosAsCurrency(cycle)}
                          </div>
                        </div>
                        <span
                          aria-hidden
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "rounded-none justify-self-start pointer-events-none md:justify-self-end",
                          )}
                        >
                          Open
                          <ChevronRight />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div>
                <h3 className="text-sm font-medium">
                  {detected?.tools.some((tool) => tool.installedOn > 0)
                    ? hasLocalSync
                      ? "No seats yet"
                      : "Waiting for plan reports"
                    : "Add your first team tool"}
                </h3>
                <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                  {detected?.tools.some((tool) => tool.installedOn > 0)
                    ? hasLocalSync
                      ? "Use Sync now above to pull plans from this machine, or wait for teammates' agents to report vendor plans."
                      : "Detected tools need a vendor plan from a connected agent before seats appear. Open this page on a linked machine or wait for the next agent report."
                    : "Choose a familiar plan and tell us how many seats you own. Pricing and provider details are filled in for you."}
                </p>
                {showSample ? <CostGhostRows /> : null}
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      <AddSubscriptionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        initialToolKey={addToolKey}
        onCreated={async () => {
          onChanged?.();
          await load();
        }}
      />
    </>
  );
}
