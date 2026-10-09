"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/panel";
import { SignalsSectionHeader } from "@/components/signals/signals-ui";
import { formatMicrosAsCurrency } from "@/lib/format";
import { toolDisplayName } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";
import { ToolBrandIcon } from "./tool-brand-icon";
import { idleMicrosByTool, idleSeatMicros } from "@/lib/queries/tools/cost-idle";
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

type ToolStatus = "unused" | "unassigned" | "at_limit" | "over_allowance" | "in_use";

const STATUS: Record<ToolStatus, { label: string; color: string; hatched?: boolean }> = {
  unused: { label: "No use in 30 days", color: "var(--brand-orange)", hatched: true },
  unassigned: { label: "Assigned to no one", color: "var(--muted-foreground)", hatched: true },
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

/** Split each paid tool's monthly seat cost into used, unused and unassigned parts, coloured by what needs doing. */
function segmentsFor(data: CostOverview): Segment[] {
  const idle = idleMicrosByTool(data);
  const segments: Segment[] = [];
  for (const tool of data.tools) {
    const seats = BigInt(tool.seatsMonthlyMicros);
    if (seats <= 0n) continue;
    const unassigned = (idle.unassigned.get(tool.toolKey) ?? 0n) > seats ? seats : idle.unassigned.get(tool.toolKey) ?? 0n;
    const remaining = seats - unassigned;
    const unused = (idle.unused.get(tool.toolKey) ?? 0n) > remaining ? remaining : idle.unused.get(tool.toolKey) ?? 0n;
    const included = BigInt(tool.includedMonthlyMicros);
    const used: ToolStatus = tool.limits && tool.limits.hit > 0
      ? "at_limit"
      : tool.usageBasis === "within_plan" && included > 0n && BigInt(tool.usageToDateMicros) > included
        ? "over_allowance"
        : "in_use";
    if (remaining - unused > 0n) segments.push({ toolKey: tool.toolKey, status: used, micros: remaining - unused });
    if (unused > 0n) segments.push({ toolKey: tool.toolKey, status: "unused", micros: unused });
    if (unassigned > 0n) segments.push({ toolKey: tool.toolKey, status: "unassigned", micros: unassigned });
  }
  const order: ToolStatus[] = ["unused", "unassigned", "over_allowance", "at_limit", "in_use"];
  return segments.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.micros > a.micros ? 1 : -1));
}

function names(keys: string[]) {
  const labels = [...new Set(keys)].map((key) => toolDisplayName(key));
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function SpendBar({ segments, total }: { segments: Segment[]; total: bigint }) {
  if (!segments.length || total <= 0n) return null;
  const present = (["unused", "unassigned", "over_allowance", "at_limit", "in_use"] as ToolStatus[]).filter((status) => segments.some((segment) => segment.status === status));
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
  const paidCount = data.tools.filter((tool) => BigInt(tool.seatsMonthlyMicros) > 0n).length;
  const payg = BigInt(totals.payAsYouGoToDateMicros);

  return (
    <section aria-label="Monthly AI spend" className="mb-10 space-y-5">
      <p className="text-4xl font-semibold tracking-tight tabular-nums">
        {money(seats)}
        <span className="ml-1.5 text-lg font-normal text-muted-foreground">/ month on {paidCount} paid {paidCount === 1 ? "plan" : "plans"}</span>
      </p>

      <SpendBar segments={segments} total={seats} />

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
      detail: "No use in the last 30 days.",
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
        detail: `Extra usage may be billed or slowed.${renewal ? ` Renews ${dateLabel(renewal)}.` : ""}`,
        micros: null,
        href: `/tools/${change.toolKey}`,
        cta: "Open tool",
      });
    } else if (change.kind === "hitting_limits") {
      actions.push({
        key: `limit-${change.toolKey}`,
        tools: [change.toolKey],
        title: `${toolDisplayName(change.toolKey)} is hitting its limit`,
        detail: tool?.limits
          ? `${tool.limits.hit} of ${tool.limits.measured} ${tool.limits.measured === 1 ? "person" : "people"} blocked in 30 days. A higher tier may fit.`
          : change.text,
        micros: null,
        href: "/dashboard",
        cta: "See limits",
      });
    } else if (change.kind === "unassigned_seats" || change.kind === "annual_renewal") {
      actions.push({
        key: `${change.kind}-${change.toolKey}-${change.text}`,
        tools: [change.toolKey],
        title: `${toolDisplayName(change.toolKey)}: ${change.text}`,
        detail: "",
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
  const savings = idleSeatMicros(data);
  return (
    <Panel as="section" className="mb-10">
      <SignalsSectionHeader title="What to do." bordered={false} />
      {savings > 0n ? (
        <p className="-mt-2 mb-2 text-sm text-muted-foreground">
          Up to <span className="font-semibold tabular-nums text-foreground">{money(savings)}/mo</span> is going to seats nobody used in the last 30 days.
        </p>
      ) : null}
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
                {action.detail ? <span className="block text-xs leading-5 text-muted-foreground">{action.detail}</span> : null}
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

type RowStatus = { label: string; detail?: string; fill: CSSProperties };

const LIGHT_FILL = { background: "var(--border-strong)" };
const IDLE_FILL = { background: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--border-strong)" };

/** One plain-language state per tool, using the same colours as the spend bar above. */
function rowStatus(tool: CostTool, unusedMicros: bigint): RowStatus {
  const included = BigInt(tool.includedMonthlyMicros);
  const people = (count: number) => `${count} of ${tool.limits?.measured ?? 0} ${tool.limits?.measured === 1 ? "person" : "people"}`;
  if (tool.activePeople === 0) {
    return BigInt(tool.seatsMonthlyMicros) > 0n
      ? { label: STATUS.unused.label, detail: `${tool.seatsPaid === 1 ? "Paid seat" : "Paid seats"} sitting idle`, fill: statusFill("unused") }
      : { label: "No use in 30 days", fill: IDLE_FILL };
  }
  if (tool.limits && tool.limits.hit > 0) return { label: STATUS.at_limit.label, detail: `${people(tool.limits.hit)} hit it`, fill: statusFill("at_limit") };
  if (tool.usageBasis === "within_plan" && included > 0n && BigInt(tool.usageToDateMicros) > included) {
    return { label: STATUS.over_allowance.label, detail: "Extra use may be billed", fill: statusFill("over_allowance") };
  }
  if (unusedMicros > 0n) return { label: "Some seats unused", detail: `${money(unusedMicros)}/mo idle`, fill: statusFill("unused") };
  if (tool.limits && tool.limits.measured > 0 && tool.limits.light === tool.limits.measured) {
    return { label: "Light use", detail: "Under 10% of the plan limit", fill: LIGHT_FILL };
  }
  return { label: STATUS.in_use.label, detail: tool.limits?.near ? `${people(tool.limits.near)} near the limit` : undefined, fill: statusFill("in_use") };
}

function UsageCell({ tool, canProject }: { tool: CostTool; canProject: boolean }) {
  const usage = BigInt(tool.usageToDateMicros);
  if (usage === 0n) return <span>—</span>;
  const estimated = usage > BigInt(tool.usageVerifiedToDateMicros);
  if (tool.usageBasis === "pay_as_you_go") {
    return (
      <span>
        <span className="text-sm tabular-nums text-foreground">{estimated ? approx(usage) : money(usage)}</span> spent
        {canProject && tool.projectedSpendMicros ? <span className="block">{approx(tool.projectedSpendMicros)} projected</span> : null}
      </span>
    );
  }
  const included = BigInt(tool.includedMonthlyMicros);
  const over = included > 0n && usage > included;
  return (
    <span className="block max-w-48">
      <span className="text-sm tabular-nums text-foreground">{approx(usage)}</span> at API prices
      {included > 0n ? (
        <>
          <span className="mt-1.5 block h-1 w-full bg-muted" aria-hidden>
            <span className="block h-full" style={{ width: `${Math.min(100, Number((usage * 100n) / included))}%`, background: over ? "var(--brand-orange)" : "var(--primary)" }} />
          </span>
          <span className="mt-1 block">{money(included)} included{over ? ` · ${Math.round(Number(usage) / Number(included))}× over` : ""}</span>
        </>
      ) : null}
    </span>
  );
}

function planLabel(plan: CostTool["plans"][number]) {
  return plan.cadence === "monthly" ? plan.name : `${plan.name} (${CADENCE_LABEL[plan.cadence]})`;
}

function ToolCostTable({ data, action }: { data: CostOverview; action?: ReactNode }) {
  const canProject = data.totals.payAsYouGoProjectedMicros !== null;
  if (!data.tools.length) return null;
  const idle = idleMicrosByTool(data);
  return (
    <Panel as="section" className="mb-10">
      <SignalsSectionHeader title="By tool." bordered={false} action={action} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border/70 text-xs text-muted-foreground">
            <tr>
              <th className="pb-2.5 pr-4 font-medium">Tool</th>
              <th className="pb-2.5 pr-4 font-medium">Status</th>
              <th className="pb-2.5 pr-4 font-medium">Seats</th>
              <th className="pb-2.5 pr-4 font-medium">Usage this month</th>
              <th className="pb-2.5 pr-4 font-medium">Renews</th>
              <th className="w-6 pb-2.5"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="text-xs text-muted-foreground">
            {data.tools.map((tool) => {
              const nextRenewal = [...tool.plans].sort((a, b) => a.renewsOn.localeCompare(b.renewsOn))[0];
              const unassigned = tool.seatsPaid - tool.seatsAssigned;
              const status = rowStatus(tool, (idle.unused.get(tool.toolKey) ?? 0n) + (idle.unassigned.get(tool.toolKey) ?? 0n));
              const price = BigInt(tool.seatsMonthlyMicros) > 0n ? money(tool.seatsMonthlyMicros) : null;
              return (
                <tr key={tool.toolKey} className="group relative border-b border-border/60 align-top last:border-b-0 hover:bg-muted/30">
                  <td className="py-3.5 pr-4">
                    <Link href={`/tools/${tool.toolKey}`} className="text-sm font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-ring">
                      <ToolName tool={tool.toolKey} />
                    </Link>
                    <span className="mt-0.5 block pl-7">
                      {tool.plans.length ? tool.plans.map(planLabel).join(" · ") : "Pay as you go"}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <span className="inline-flex items-center gap-2 text-sm text-foreground">
                      <span className="size-2.5 shrink-0" style={status.fill} aria-hidden />
                      {status.label}
                    </span>
                    {status.detail ? <span className="mt-0.5 block pl-[1.125rem]">{status.detail}</span> : null}
                  </td>
                  <td className="py-3.5 pr-4">
                    {tool.seatsPaid ? (
                      <span className="text-sm tabular-nums text-foreground">{Math.min(tool.activePeople, tool.seatsPaid)} of {tool.seatsPaid} used</span>
                    ) : (
                      <span><span className="text-sm tabular-nums text-foreground">{tool.activePeople}</span> {tool.activePeople === 1 ? "person" : "people"}</span>
                    )}
                    {price || unassigned > 0 ? (
                      <span className="mt-0.5 block tabular-nums">
                        {[
                          price ? `${price}/mo${tool.seatsPriceTag ? ` · ${TAG_LABEL[tool.seatsPriceTag].toLowerCase()}` : ""}` : null,
                          unassigned > 0 ? `${unassigned} unassigned` : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3.5 pr-4"><UsageCell tool={tool} canProject={canProject} /></td>
                  <td className="py-3.5 pr-4">
                    {nextRenewal ? (
                      <>
                        <span className="text-sm text-foreground">{dateLabel(nextRenewal.renewsOn)}</span>
                        {nextRenewal.cadence !== "monthly" && BigInt(nextRenewal.renewalMicros) > 0n ? (
                          <span className="block">{money(nextRenewal.renewalMicros)} charged then</span>
                        ) : null}
                      </>
                    ) : "—"}
                  </td>
                  <td className="py-3.5 text-right">
                    <ArrowRight className="mt-0.5 inline size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Seat use and status cover the last 30 days. Usage is priced at API rates to compare against what&apos;s included. List prices apply until you enter your own on a tool&apos;s page.
      </p>
    </Panel>
  );
}

export function CostOverviewView({ data, tableAction }: { data: CostOverview; tableAction?: ReactNode }) {
  return (
    <>
      <MonthTotal data={data} />
      <Changes data={data} />
      <ToolCostTable data={data} action={tableAction} />
    </>
  );
}
