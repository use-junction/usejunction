"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/panel";
import { SignalsSectionHeader } from "@/components/signals/signals-ui";
import { formatMicrosAsCurrency } from "@/lib/format";
import { toolDisplayName } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";
import { ToolBrandIcon } from "./tool-brand-icon";
import type { CostOverview, CostTool, PriceTag } from "@/lib/queries/tools/cost-overview";

const money = formatMicrosAsCurrency;

/** Whole dollars with a tilde for anything estimated or projected. */
function approx(micros: string | bigint) {
  const dollars = Number(BigInt(micros)) / 1_000_000;
  if (dollars > 0 && dollars < 1) return "<$1";
  return `~$${Math.round(dollars).toLocaleString("en-US")}`;
}

const TAG_LABEL: Record<PriceTag | "mixed", string> = {
  entered: "Your price",
  list: "List price",
  mixed: "List + your prices",
};

const CADENCE_LABEL = { weekly: "weekly", monthly: "monthly", annual: "annual", custom: "custom cycle" } as const;

function dateLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Tag({ children, estimate = false }: { children: string; estimate?: boolean }) {
  return (
    <span className={cn("inline-block border px-1.5 py-px text-[10px] uppercase tracking-[0.08em]", estimate ? "border-dashed border-muted-foreground/60 text-muted-foreground" : "border-border text-muted-foreground")}>
      {children}
    </span>
  );
}

function ToolName({ tool, size = 18 }: { tool: string; size?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ToolBrandIcon tool={tool} size={size} />
      <span className="truncate">{toolDisplayName(tool)}</span>
    </span>
  );
}

type ToolStatus = "unused" | "at_limit" | "over_allowance" | "in_use";

const STATUS: Record<ToolStatus, { label: string; color: string; hatched?: boolean }> = {
  unused: { label: "No use in 30 days", color: "var(--brand-orange)", hatched: true },
  at_limit: { label: "Hitting its limit", color: "var(--brand-olive-accent)" },
  over_allowance: { label: "Past its allowance", color: "color-mix(in srgb, var(--brand-orange) 55%, var(--brand-olive-accent))" },
  in_use: { label: "In use", color: "var(--primary)" },
};

function statusFill(status: ToolStatus) {
  const { color, hatched } = STATUS[status];
  return hatched
    ? { backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)`, boxShadow: `inset 0 0 0 1px ${color}` }
    : { background: color };
}

type Segment = { toolKey: string; status: ToolStatus; micros: bigint };

/** Split each paid tool's monthly seat cost into used and unused parts, coloured by what needs doing. */
function segmentsFor(data: CostOverview): Segment[] {
  const unusedByTool = new Map<string, bigint>();
  for (const change of data.changes) {
    if (change.kind === "unused_seats" && change.toolKey && change.monthlyMicros) {
      unusedByTool.set(change.toolKey, (unusedByTool.get(change.toolKey) ?? 0n) + BigInt(change.monthlyMicros));
    }
  }
  const segments: Segment[] = [];
  for (const tool of data.tools) {
    const seats = BigInt(tool.seatsMonthlyMicros);
    if (seats <= 0n) continue;
    const unused = (unusedByTool.get(tool.toolKey) ?? 0n) > seats ? seats : unusedByTool.get(tool.toolKey) ?? 0n;
    const included = BigInt(tool.includedMonthlyMicros);
    const used: ToolStatus = tool.limits && tool.limits.hit > 0
      ? "at_limit"
      : tool.usageBasis === "within_plan" && included > 0n && BigInt(tool.usageToDateMicros) > included
        ? "over_allowance"
        : "in_use";
    if (seats - unused > 0n) segments.push({ toolKey: tool.toolKey, status: used, micros: seats - unused });
    if (unused > 0n) segments.push({ toolKey: tool.toolKey, status: "unused", micros: unused });
  }
  const order: ToolStatus[] = ["unused", "over_allowance", "at_limit", "in_use"];
  return segments.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.micros > a.micros ? 1 : -1));
}

function names(keys: string[]) {
  const labels = [...new Set(keys)].map((key) => toolDisplayName(key));
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function SpendBar({ segments, total }: { segments: Segment[]; total: bigint }) {
  if (!segments.length || total <= 0n) return null;
  const present = (["unused", "over_allowance", "at_limit", "in_use"] as ToolStatus[]).filter((status) => segments.some((segment) => segment.status === status));
  return (
    <div className="space-y-2">
      <div className="flex h-11 w-full gap-0.5 overflow-hidden" role="list" aria-label="Monthly seat cost by tool">
        {segments.map((segment) => {
          const pct = Number((segment.micros * 1000n) / total) / 10;
          const label = `${toolDisplayName(segment.toolKey)} ${money(segment.micros)} · ${STATUS[segment.status].label}`;
          return (
            <span
              key={`${segment.toolKey}-${segment.status}`}
              role="listitem"
              title={label}
              aria-label={label}
              className="flex h-full min-w-0 items-center gap-1.5 overflow-hidden px-2 text-xs"
              style={{ width: `${Math.max(pct, 3)}%`, ...statusFill(segment.status) }}
            >
              {pct >= 9 ? (
                <span className="flex min-w-0 items-center gap-1.5 bg-background/90 px-1.5 py-0.5">
                  <ToolBrandIcon tool={segment.toolKey} size={13} />
                  <span className="truncate font-medium">{toolDisplayName(segment.toolKey)}</span>
                  <span className="tabular-nums text-muted-foreground">{money(segment.micros)}</span>
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {present.map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5">
            <span className="size-2.5" style={statusFill(status)} aria-hidden />
            {STATUS[status].label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthTotal({ data }: { data: CostOverview }) {
  const { totals } = data;
  const seats = BigInt(totals.seatsMonthlyMicros);
  const segments = segmentsFor(data);
  const unused = segments.filter((segment) => segment.status === "unused");
  const unusedMicros = unused.reduce((sum, segment) => sum + segment.micros, 0n);
  const paidCount = data.tools.filter((tool) => BigInt(tool.seatsMonthlyMicros) > 0n).length;
  const free = data.tools.filter((tool) => BigInt(tool.seatsMonthlyMicros) === 0n && tool.plans.length > 0);
  const payg = BigInt(totals.payAsYouGoToDateMicros);

  return (
    <section aria-label="Monthly AI spend" className="mb-10 space-y-5">
      <div className="space-y-2">
        <p className="text-4xl font-semibold tracking-tight tabular-nums">
          {money(seats)}
          <span className="ml-1.5 text-lg font-normal text-muted-foreground">/ month on {paidCount} paid {paidCount === 1 ? "plan" : "plans"}</span>
        </p>
        <p className="max-w-3xl text-base leading-7">
          {unusedMicros > 0n ? (
            <>
              <span className="font-semibold tabular-nums">{money(unusedMicros)}</span> of it went to {names(unused.map((segment) => segment.toolKey))}, with no use recorded in the last 30 days.
            </>
          ) : (
            "Every paid plan was used in the last 30 days."
          )}
        </p>
        {totals.seatsHaveListPrices ? (
          <p className="text-xs text-muted-foreground">Prices are vendor list prices unless you entered your own under Manage plans.</p>
        ) : null}
      </div>

      <SpendBar segments={segments} total={seats} />

      {free.length ? (
        <p className="text-xs text-muted-foreground">
          Also on free plans: {free.map((tool) => (
            <span key={tool.toolKey} className="ml-1.5 inline-flex items-center gap-1 align-middle">
              <ToolBrandIcon tool={tool.toolKey} size={12} />{toolDisplayName(tool.toolKey)}
            </span>
          ))}
        </p>
      ) : null}

      {payg > 0n ? (
        <p className="border-l-2 border-border pl-3 text-sm">
          Plus <span className="font-semibold tabular-nums">{BigInt(totals.payAsYouGoEstimatedToDateMicros) > 0n ? approx(payg) : money(payg)}</span> of pay-as-you-go usage so far this month
          {totals.payAsYouGoProjectedMicros ? <span className="text-muted-foreground">, on pace for {approx(totals.payAsYouGoProjectedMicros)}</span> : null}.
        </p>
      ) : null}
    </section>
  );
}

type Action = { key: string; tools: string[]; title: string; detail: string; micros: bigint | null; href: string; cta: string };

function actionsFor(data: CostOverview): Action[] {
  const actions: Action[] = [];
  const unused = data.changes.filter((change) => change.kind === "unused_seats" && change.toolKey);
  if (unused.length) {
    const micros = unused.reduce((sum, change) => sum + BigInt(change.monthlyMicros ?? "0"), 0n);
    actions.push({
      key: "unused",
      tools: unused.map((change) => change.toolKey!),
      title: `Cancel or reassign ${names(unused.map((change) => change.toolKey!))}`,
      detail: "No use recorded in 30 days, counting only people whose agent is reporting.",
      micros,
      href: "/activity",
      cta: "See who holds them",
    });
  }
  for (const change of data.changes) {
    if (!change.toolKey) continue;
    const tool = data.tools.find((row) => row.toolKey === change.toolKey);
    const renewal = tool?.plans.map((plan) => plan.renewsOn).sort()[0];
    if (change.kind === "past_allowance") {
      actions.push({
        key: `allowance-${change.toolKey}`,
        tools: [change.toolKey],
        title: `${toolDisplayName(change.toolKey)} is past its included allowance`,
        detail: `Usage this month is worth more than the plan includes. Extra usage may be billed or slowed; check the next invoice${renewal ? ` (renews ${dateLabel(renewal)})` : ""}.`,
        micros: null,
        href: `/tools/${change.toolKey}`,
        cta: "Open tool",
      });
    } else if (change.kind === "hitting_limits") {
      actions.push({
        key: `limit-${change.toolKey}`,
        tools: [change.toolKey],
        title: `${toolDisplayName(change.toolKey)} is hitting its limit`,
        detail: `${change.text.replace(/ A higher tier may fit\.$/, "")} People get blocked until the window resets; a higher tier may fit${renewal ? ` before it renews ${dateLabel(renewal)}` : ""}.`,
        micros: null,
        href: "/dashboard",
        cta: "See limits",
      });
    } else if (change.kind === "unassigned_seats" || change.kind === "annual_renewal") {
      actions.push({
        key: `${change.kind}-${change.toolKey}-${change.text}`,
        tools: [change.toolKey],
        title: `${toolDisplayName(change.toolKey)}: ${change.text}`,
        detail: change.basis,
        micros: change.monthlyMicros ? BigInt(change.monthlyMicros) : null,
        href: change.href ?? `/tools/${change.toolKey}`,
        cta: "Open tool",
      });
    }
  }
  return actions.sort((a, b) => ((b.micros ?? 0n) > (a.micros ?? 0n) ? 1 : (b.micros ?? 0n) < (a.micros ?? 0n) ? -1 : 0));
}

function Changes({ data }: { data: CostOverview }) {
  const actions = actionsFor(data);
  if (!actions.length) return null;
  return (
    <Panel as="section" className="mb-10">
      <SignalsSectionHeader title="What to do." description="Biggest saving first." bordered={false} />
      <ol className="divide-y divide-border/60">
        {actions.map((action) => (
          <li key={action.key} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-4">
            <span className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex shrink-0 -space-x-1">
                {action.tools.map((tool) => (
                  <span key={tool} className="rounded-full bg-background p-0.5"><ToolBrandIcon tool={tool} size={18} /></span>
                ))}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{action.title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{action.detail}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-4">
              {action.micros ? (
                <span className="text-sm">
                  Save <span className="font-semibold tabular-nums">{money(action.micros)}</span><span className="text-xs text-muted-foreground">/mo</span>
                </span>
              ) : null}
              <Link href={action.href} className="inline-flex items-center gap-0.5 text-xs hover:underline">
                {action.cta} <ArrowRight className="size-3" aria-hidden />
              </Link>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function LimitsCell({ limits }: { limits: CostTool["limits"] }) {
  if (!limits) return <span className="text-muted-foreground">No limit data</span>;
  const parts = [
    limits.hit ? `${limits.hit} hit limit` : null,
    limits.near ? `${limits.near} near` : null,
    limits.light ? `${limits.light} under 10%` : null,
  ].filter(Boolean);
  return (
    <span>
      <span className={cn(limits.hit > 0 && "text-foreground")}>{parts.length ? parts.join(" · ") : "Within limits"}</span>
      <span className="block text-muted-foreground">of {limits.measured} measured · 30 days</span>
    </span>
  );
}

function UsageCell({ tool, canProject }: { tool: CostTool; canProject: boolean }) {
  const usage = BigInt(tool.usageToDateMicros);
  if (usage === 0n) return <span className="text-muted-foreground">—</span>;
  const estimated = usage > BigInt(tool.usageVerifiedToDateMicros);
  if (tool.usageBasis === "pay_as_you_go") {
    return (
      <span>
        <span className="tabular-nums text-foreground">{estimated ? approx(usage) : money(usage)}</span> so far
        <span className="block text-muted-foreground">
          {canProject && tool.projectedSpendMicros ? `${approx(tool.projectedSpendMicros)} projected · ` : ""}billed on use
        </span>
      </span>
    );
  }
  const included = BigInt(tool.includedMonthlyMicros);
  return (
    <span>
      <span className="tabular-nums">{approx(usage)}</span> value
      <span className="block text-muted-foreground">
        {included > 0n ? `${money(included)} included${usage > included ? " · past allowance" : ""}` : "covered by seats"}
      </span>
    </span>
  );
}

function ToolCostTable({ data }: { data: CostOverview }) {
  const canProject = data.totals.payAsYouGoProjectedMicros !== null;
  if (!data.tools.length) return null;
  return (
    <Panel as="section" className="mb-10">
      <SignalsSectionHeader
        title="By tool."
        description="What each tool costs per month, how many seats are in use, and whether people run into its limits."
        bordered={false}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border/70 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <tr>
              <th className="pb-3 pr-4 font-medium">Tool</th>
              <th className="pb-3 pr-4 text-right font-medium">Seats / mo</th>
              <th className="pb-3 pr-4 font-medium">Seats in use</th>
              <th className="pb-3 pr-4 font-medium">Usage this month</th>
              <th className="pb-3 pr-4 font-medium">Limits</th>
              <th className="pb-3 font-medium">Renews</th>
            </tr>
          </thead>
          <tbody className="text-xs text-muted-foreground">
            {data.tools.map((tool) => {
              const nextRenewal = [...tool.plans].sort((a, b) => a.renewsOn.localeCompare(b.renewsOn))[0];
              return (
                <tr key={tool.toolKey} className="border-b border-border/60 align-top last:border-b-0 hover:bg-muted/30">
                  <td className="py-4 pr-4">
                    <Link href={`/tools/${tool.toolKey}`} className="text-sm font-medium text-foreground hover:underline">
                      <ToolName tool={tool.toolKey} />
                    </Link>
                    <span className="mt-1 block pl-7">
                      {tool.plans.length
                        ? tool.plans.map((plan) => `${plan.name} (${CADENCE_LABEL[plan.cadence]})`).join(" · ")
                        : "No plan · pay as you go"}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-right">
                    <span className="block text-sm tabular-nums text-foreground">{BigInt(tool.seatsMonthlyMicros) > 0n ? money(tool.seatsMonthlyMicros) : "—"}</span>
                    {tool.seatsPriceTag ? <span className="mt-1 inline-block"><Tag>{TAG_LABEL[tool.seatsPriceTag]}</Tag></span> : null}
                  </td>
                  <td className="py-4 pr-4">
                    {tool.seatsPaid ? (
                      <>
                        <span className="text-sm tabular-nums text-foreground">{Math.min(tool.activePeople, tool.seatsPaid)} of {tool.seatsPaid}</span>
                        <span className="block">used in last 30 days{tool.seatsPaid > tool.seatsAssigned ? ` · ${tool.seatsPaid - tool.seatsAssigned} unassigned` : ""}</span>
                      </>
                    ) : (
                      <span><span className="text-sm tabular-nums text-foreground">{tool.activePeople}</span> {tool.activePeople === 1 ? "person" : "people"} in last 30 days</span>
                    )}
                  </td>
                  <td className="py-4 pr-4"><UsageCell tool={tool} canProject={canProject} /></td>
                  <td className="py-4 pr-4"><LimitsCell limits={tool.limits} /></td>
                  <td className="py-4">
                    {nextRenewal ? (
                      <>
                        <span className="text-foreground">{dateLabel(nextRenewal.renewsOn)}</span>
                        {nextRenewal.cadence !== "monthly" && BigInt(nextRenewal.renewalMicros) > 0n ? (
                          <span className="block">{money(nextRenewal.renewalMicros)} charged then</span>
                        ) : null}
                      </>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Annual and weekly plans are converted to a monthly amount; the full charge shows under Renews. Money is this calendar month. &quot;Seats in use&quot; and limits look at the last 30 days so a seat isn't called unused two days into a month.
      </p>
    </Panel>
  );
}

export function CostOverviewView({ data }: { data: CostOverview }) {
  return (
    <>
      <MonthTotal data={data} />
      <Changes data={data} />
      <ToolCostTable data={data} />
    </>
  );
}
