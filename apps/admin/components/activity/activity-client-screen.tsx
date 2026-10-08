"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { MobileDataCard, MobileDataField, MobileDataList } from "@/components/ui/mobile-data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActivityPageHeader } from "@/components/activity/activity-page-header";
import { ExportCsvButton } from "@/components/export-csv-button";
import { TeamFilter } from "@/components/team-filter";
import type { CsvCell } from "@/lib/csv";
import { toolDisplayName } from "@/lib/tools/catalog";
import { AudienceScopeSwitcher } from "@/components/audience-scope-switcher";
import { Panel } from "@/components/panel";
import { DeviceActivityFeed } from "@/components/activity/device-activity-feed";
import { UsageBreakdownList } from "@/components/activity/usage-breakdown-list";
import { TeamAdoptionView } from "@/components/activity/team-adoption-view";
import { sampleAdoption } from "@/components/activity/adoption-sample";
import { LocalSyncPanel } from "@/components/dashboard/local-sync-panel";
import { ConnectionRepairBanner } from "@/components/dashboard/connection-repair-banner";
import { CycleViewPicker } from "@/components/dashboard/cycle-view-picker";
import { FlowPath, SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { type CycleView, type CycleViewWindows } from "@/lib/dashboard/cycle-view";
import { type RollingPeriod } from "@/lib/dashboard/period-prefs";
import type { AudienceScope } from "@/lib/audience-scope";
import { signalsProductEnabled } from "@/lib/region";
import type { getDeviceActivityFeed } from "@/lib/queries/activity/device-activity";
import type { TeamAdoption } from "@/lib/queries/activity/adoption";
import type { getMeOverview } from "@/lib/queries/me/overview";
import { formatCompactNumber } from "@/lib/format";
import type { getPersonalSignalsLedger } from "@/lib/signals/read";
import type { OrgActivitySettings } from "@/lib/activity/contracts";
import { useAppPageQuery } from "@/lib/api/client";
import { activityKey } from "@/lib/app-pages/query-keys";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";
import { DashboardSetupPanel } from "@/components/dashboard/setup-panel";

type DeviceFeed = Awaited<ReturnType<typeof getDeviceActivityFeed>>;
type MeOverview = Awaited<ReturnType<typeof getMeOverview>>;
type SignalsLedger = Awaited<ReturnType<typeof getPersonalSignalsLedger>>;

type BreakdownRow = {
  key: string;
  toolName: string | null;
  model?: string | null;
  requests: number;
  cost: number;
  metaExtra: string | null;
};

/** Normalized activity surface — Team and You share the same chrome. */
type ActivityViewModel = {
  scope: AudienceScope;
  periodLabel: string;
  kpis: {
    requests: number;
    sessions: number;
    tokens: number;
    tools: number;
    toolsSub: string;
  };
  tools: BreakdownRow[];
  models: BreakdownRow[];
  deviceFeed: DeviceFeed;
  showDeveloperOnFeed: boolean;
  sync?: MeOverview["sync"] | null;
  signalsLedger?: SignalsLedger;
  showDeviceFeed: boolean;
};

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: ReactNode;
}) {
  if (!rows.length) {
    return (
      <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
        <EmptyDescription>{empty}</EmptyDescription>
      </Empty>
    );
  }
  return (
    <>
      <MobileDataList>
        {rows.map((row, index) => (
          <MobileDataCard key={index}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {row.map((cell, cellIndex) => (
                <MobileDataField
                  key={cellIndex}
                  label={headers[cellIndex] ?? `Field ${cellIndex + 1}`}
                  value={cell}
                  className={cellIndex === 0 ? "col-span-2" : undefined}
                />
              ))}
            </dl>
          </MobileDataCard>
        ))}
      </MobileDataList>
      <Table containerClassName="hidden md:block" className="min-w-[720px] text-left text-sm">
        <TableHeader className="border-b border-border/70 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className="pb-3 pr-4 pt-1 font-medium">
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index} className="transition-colors hover:bg-muted/30">
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className="py-5 pr-4 align-middle">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function fromPersonal(
  personal: MeOverview,
  signalsLedger: SignalsLedger,
  deviceFeed: DeviceFeed,
  showDeviceFeed: boolean,
  periodLabel: string,
): ActivityViewModel {
  const tokens = Number(BigInt(personal.usage30d.inputTokens) + BigInt(personal.usage30d.outputTokens));
  const tools = [...personal.toolsUsage30d].sort((a, b) => b.requests - a.requests || b.tokens - a.tokens);
  const models = [...personal.modelUsage30d]
    .filter((row) => row.metricKind !== "productivity")
    .sort((a, b) => b.requests - a.requests);

  return {
    scope: "you",
    periodLabel,
    kpis: {
      requests: personal.usage30d.requests,
      sessions: personal.usage30d.sessions,
      tokens,
      tools: tools.length,
      toolsSub: "with traffic this period",
    },
    tools: tools.map((tool) => ({
      key: tool.toolName,
      toolName: tool.toolName,
      requests: tool.requests,
      cost: tool.cost,
      metaExtra: tool.tokens > 0 ? `${formatCompactNumber(tool.tokens)} tokens` : null,
    })),
    models: models.map((row) => ({
      key: `${row.toolName}-${row.model}-${row.source}`,
      toolName: row.toolName,
      model: row.model,
      requests: row.requests,
      cost: row.cost,
      metaExtra: null,
    })),
    deviceFeed,
    showDeveloperOnFeed: false,
    sync: personal.sync,
    signalsLedger,
    showDeviceFeed,
  };
}

function SharedActivityView({ view }: { view: ActivityViewModel }) {
  const isYou = view.scope === "you";

  return (
    <>
      {isYou && view.sync ? (
        <div className="mb-10">
          <LocalSyncPanel
            scope="you"
            lastSeenAt={view.sync.lastSeenAt}
            lastUsageSyncAt={view.sync.lastUsageSyncAt}
            lastAccountSyncAt={view.sync.lastAccountSyncAt}
            dashboardReady={view.sync.dashboardReady}
            dirtyDayCount={view.sync.dirtyDayCount}
            staleDeviceCount={view.sync.staleDeviceCount}
          />
        </div>
      ) : null}

      <div className="mb-10 grid gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
        <SignalsKpi
          label="Requests"
          hero
          className="pl-5"
          value={formatCompactNumber(view.kpis.requests)}
          sub={view.periodLabel}
        />
        <SignalsKpi
          label="Sessions"
          className="sm:border-l sm:border-border sm:pl-8"
          value={formatCompactNumber(view.kpis.sessions)}
          sub={view.periodLabel}
        />
        <SignalsKpi
          label="Tokens"
          className="xl:border-l xl:border-border xl:pl-8"
          value={formatCompactNumber(view.kpis.tokens)}
          sub="input + output"
        />
        <SignalsKpi
          label="Tools"
          className="sm:border-l sm:border-border sm:pl-8"
          value={formatCompactNumber(view.kpis.tools)}
          sub={view.kpis.toolsSub}
        />
      </div>

      {view.showDeviceFeed ? (
        <DeviceActivityFeed feed={view.deviceFeed} showDeveloper={view.showDeveloperOnFeed} />
      ) : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Panel as="section">
          <SignalsSectionHeader
            title="By tool."
            description={isYou ? "Request volume by tool on your devices." : "Request volume by detected tool."}
            bordered={false}
          />
          <UsageBreakdownList
            valueMode="requests"
            countNoun="tools"
            empty={isYou ? "No tools detected yet." : "No tool traffic yet."}
            rows={view.tools}
          />
        </Panel>

        <Panel as="section">
          <SignalsSectionHeader
            title="By model."
            description={`Request volume by model · ${view.models.length} total.`}
            bordered={false}
          />
          <UsageBreakdownList
            valueMode="requests"
            countNoun="models"
            empty="No model traffic yet."
            rows={view.models}
          />
        </Panel>
      </div>

      {isYou && signalsProductEnabled() && view.signalsLedger ? (
        <Panel as="section" className="mt-10">
          <SignalsSectionHeader
            title="Your Signals ledger."
            description="App and domain flow for latest sessions. No screenshots, full URLs, or clipboard text."
            bordered={false}
          />
          <DataTable
            headers={["Flow", "Time", "Duration", "Device", "Confidence"]}
            empty="No Signals sessions uploaded yet."
            rows={view.signalsLedger.map((session) => [
              <FlowPath
                flow={[
                  session.domainBefore ?? session.appBefore ?? "unknown",
                  session.aiTool,
                  session.domainAfter ?? session.appAfter ?? "unknown",
                ].join(" -> ")}
              />,
              <span className="text-muted-foreground">{new Date(session.startedAt).toLocaleString()}</span>,
              <span className="tabular-nums">{duration(session.durationSeconds)}</span>,
              <span>{session.device.hostname}</span>,
              <span className="tabular-nums text-muted-foreground">{Math.round(session.confidence * 100)}%</span>,
            ])}
          />
        </Panel>
      ) : null}
    </>
  );
}

type ActivityPayload =
  | {
      kind: "personal";
      scope: AudienceScope;
      canSwitchAudience: boolean;
      youUnlinked?: boolean;
      settings: OrgActivitySettings;
      allowPeriodControls: boolean;
      cycleView: CycleView;
      rollingPeriod: RollingPeriod;
      periodLabel: string;
      cycleWindows?: CycleViewWindows;
      personal: MeOverview | null;
      signalsLedger: SignalsLedger;
      deviceFeed: DeviceFeed;
    }
  | {
      kind: "organization";
      scope: AudienceScope;
      canSwitchAudience: boolean;
      allowPeriodControls: boolean;
      cycleView: CycleView;
      rollingPeriod: RollingPeriod;
      periodLabel: string;
      cycleWindows?: CycleViewWindows;
      adoption: TeamAdoption;
      deviceFeed: DeviceFeed;
      team?: { id: string; name: string } | null;
    };

const BAND_EXPORT_LABEL: Record<TeamAdoption["people"][number]["band"], string> = {
  regular: "Regular",
  occasional: "Occasional",
  not_started: "Not using yet",
  no_data: "No data",
};

function adoptionCsvRows(adoption: TeamAdoption): CsvCell[][] {
  return [
    ...adoption.people.map((person) => [
      person.name,
      BAND_EXPORT_LABEL[person.band],
      person.activeDays,
      person.daysPerWeek,
      person.tools.map((tool) => toolDisplayName(tool)).join("; "),
      person.seats.filter((seat) => !seat.used).map((seat) => toolDisplayName(seat.toolName)).join("; "),
      person.lastSeenAt ?? "",
    ]),
    ...adoption.notEnrolled.map((person) => [person.name, "No machine connected", 0, 0, "", person.seats.map((seat) => toolDisplayName(seat.toolName)).join("; "), ""]),
  ];
}

export default function ActivityClientScreen() {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const query = useAppPageQuery<ActivityPayload>(
    activityKey(queryString),
    `/api/app/activity${queryString ? `?${queryString}` : ""}`,
  );

  const payload = query.data;
  const periodLabel = payload?.periodLabel ?? "";
  const view: ActivityViewModel | null = useMemo(() => {
    if (!payload) return null;
    if (payload.kind === "personal") {
      if (payload.youUnlinked || !payload.personal) return null;
      return fromPersonal(
        payload.personal,
        payload.signalsLedger,
        payload.deviceFeed,
        payload.settings.teamDeviceActivityEnabled,
        payload.periodLabel,
      );
    }
    return null;
  }, [payload]);

  useAppQueryErrorToast(query.error && query.data ? query.error : null, { retry: () => void query.refetch() });

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  if (!payload) return <AppPageSkeleton />;

  const isYou = payload.kind === "personal";
  const { allowPeriodControls: allowDeveloperPeriodControls, cycleView, rollingPeriod, cycleWindows } = payload;
  const switcher = payload.canSwitchAudience ? <AudienceScopeSwitcher /> : null;

  return (
    <>
      {isYou && view ? (
        <ConnectionRepairBanner scope="you" recoveryDevices={view.sync?.recoveryDevices} />
      ) : null}
      <ActivityPageHeader
        title={isYou ? "How are you using it?" : payload.team ? `Adoption · ${payload.team.name}.` : "Adoption."}
        actions={
          allowDeveloperPeriodControls ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {payload.kind === "organization" ? (
                <>
                  <TeamFilter />
                  <ExportCsvButton
                    name="adoption"
                    header={["Person", "Status", "Active days", "Days per week", "Tools used", "Unused paid seats", "Last seen (UTC)"]}
                    rows={() => adoptionCsvRows(payload.adoption)}
                  />
                </>
              ) : null}
              <CycleViewPicker
                view={cycleView}
                period={rollingPeriod}
                basePath="/activity"
                cycleWindows={cycleWindows}
              />
            </div>
          ) : undefined
        }
      />
      {switcher ? <div className="mb-8">{switcher}</div> : null}

      {payload.kind === "personal" && (payload.youUnlinked || !payload.personal) ? (
        <DashboardSetupPanel canInvite={false} />
      ) : payload.kind === "organization" ? (
        <TeamAdoptionView
          data={payload.adoption}
          sample={payload.adoption.counts.enrolled === 0 ? sampleAdoption(payload.adoption) : undefined}
        >
          <DeviceActivityFeed feed={payload.deviceFeed} showDeveloper />
        </TeamAdoptionView>
      ) : view ? (
        <SharedActivityView view={view} />
      ) : null}
    </>
  );
}
