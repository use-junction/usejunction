"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Panel } from "@/components/panel";
import { WorkSpendSectionHeader, TREND_SERIES_COLORS, WORK_STATE_COLORS, WORK_STATE_LABELS } from "@/components/features/work-spend-ui";

/**
 * Static stand-ins for the connected Work & Spend panels, shown faded under the
 * GitHub connect prompt. The real panels fetch their own data, so these mirror
 * their markup with fixed sample numbers instead.
 */

const REPOS = [
  { key: "web", title: "acme/web" },
  { key: "api", title: "acme/api" },
  { key: "mobile", title: "acme/mobile" },
] as const;

const WEEKS = [
  { week: "08-11", web: 22, api: 14, mobile: 6 },
  { week: "08-18", web: 31, api: 12, mobile: 9 },
  { week: "08-25", web: 27, api: 19, mobile: 4 },
  { week: "09-01", web: 18, api: 22, mobile: 11 },
  { week: "09-08", web: 36, api: 17, mobile: 8 },
  { week: "09-15", web: 41, api: 21, mobile: 13 },
  { week: "09-22", web: 29, api: 26, mobile: 10 },
  { week: "09-29", web: 45, api: 18, mobile: 15 },
  { week: "10-06", web: 38, api: 24, mobile: 12 },
];

const CHART_CONFIG = Object.fromEntries(REPOS.map((repo, index) => [repo.key, { label: repo.title, color: TREND_SERIES_COLORS[index] }])) as ChartConfig;

const PEOPLE = [
  { name: "Maya Chen", amount: "$118.40", line: "32% of spend on work · 14 items" },
  { name: "Jonas Weber", amount: "$96.15", line: "26% of spend on work · 9 items" },
  { name: "Asha Kumar", amount: "$84.02", line: "23% of spend on work · 11 items" },
  { name: "Tom Lindqvist", amount: "$74.22", line: "19% of spend on work · 6 items" },
];

const PROJECTS = [
  { title: "Q4 Billing", items: 12, shipped: "$96.30", in_flight: "$41.12", stalled: "—", total: "$137.42" },
  { title: "Onboarding v2", items: 8, shipped: "$58.75", in_flight: "$22.40", stalled: "$9.75", total: "$90.90" },
  { title: "Platform", items: 15, shipped: "$44.18", in_flight: "$12.60", stalled: "$18.04", total: "$74.82" },
];

const ITEMS = [
  { title: "Add team invitations", repo: "acme/web", key: "PAY-142", state: "shipped", amount: "$42.10" },
  { title: "Billing page redesign", repo: "acme/web", key: "PAY-151", state: "in_flight", amount: "$18.40" },
  { title: "Usage export to CSV", repo: "acme/api", key: "PLAT-88", state: "shipped", amount: "$15.85" },
  { title: "Spike: new search index", repo: "acme/api", key: "PLAT-73", state: "stalled", amount: "$9.75" },
] as const;

const STATES = ["shipped", "in_flight", "stalled"] as const;

export function WorkSpendPreview() {
  return (
    <div className="mt-10">
      <p className="mb-3 text-xs text-muted-foreground">With GitHub connected · sample data</p>
      <div
        aria-hidden
        inert
        className="pointer-events-none max-h-[46rem] select-none overflow-hidden opacity-50 [mask-image:linear-gradient(to_bottom,black_25%,transparent_92%)]"
      >
        <div className="grid items-stretch gap-6 xl:grid-cols-[1.45fr_1fr]">
          <Panel className="min-w-0">
            <WorkSpendSectionHeader
              title="Spend by week."
              description="Weekly spend on work"
              action={<div className="flex gap-3 text-sm"><span className="font-medium">Repos</span><span className="text-muted-foreground">Projects</span><span className="text-muted-foreground">People</span></div>}
            />
            <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {REPOS.map((repo, index) => (
                <li key={repo.key} className="inline-flex items-center gap-1.5">
                  <span className="size-2" style={{ background: TREND_SERIES_COLORS[index] }} />{repo.title}
                </li>
              ))}
            </ul>
            <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[200px] w-full">
              <BarChart data={WEEKS} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(value) => `$${value}`} />
                {REPOS.map((repo, index) => (
                  <Bar key={repo.key} dataKey={repo.key} stackId="alloc" fill={TREND_SERIES_COLORS[index]} maxBarSize={42} isAnimationActive={false} />
                ))}
              </BarChart>
            </ChartContainer>
          </Panel>

          <Panel className="min-w-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight">Spend by person.</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">Who the AI cost on this work belongs to.</p>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PEOPLE.map((person, index) => (
                <li key={person.name} className="flex flex-col gap-1 border border-border/70 bg-card px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="size-2 shrink-0" style={{ background: TREND_SERIES_COLORS[index] }} />
                    <span className="truncate text-sm font-medium">{person.name}</span>
                  </span>
                  <span className="text-base font-semibold tabular-nums">{person.amount}</span>
                  <span className="text-[0.7rem] text-muted-foreground">{person.line}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[7fr_3fr]">
          <Panel className="min-w-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold tracking-tight">Spend by project.</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">Every board&apos;s AI cost, split by whether the work merged, is still open, or is not moving.</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 text-left font-medium">Project</th>
                  {STATES.map((state) => (
                    <th key={state} className="hidden whitespace-nowrap pb-2 pl-3 text-right font-medium sm:table-cell">
                      <span className="inline-flex items-center gap-1.5"><span className="size-2" style={{ background: WORK_STATE_COLORS[state] }} />{WORK_STATE_LABELS[state]}</span>
                    </th>
                  ))}
                  <th className="pb-2 pl-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {PROJECTS.map((row) => (
                  <tr key={row.title} className="border-t border-border/60">
                    <td className="py-3 pr-3">
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-0.5 text-[0.7rem] text-muted-foreground">GitHub Project · {row.items} items</p>
                    </td>
                    {STATES.map((state) => (
                      <td key={state} className={`hidden py-3 pl-3 text-right tabular-nums sm:table-cell ${row[state] === "—" ? "text-muted-foreground/50" : ""}`}>{row[state]}</td>
                    ))}
                    <td className="py-3 pl-3 text-right font-semibold tabular-nums">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel className="min-w-0">
            <div className="mb-3">
              <h2 className="text-lg font-semibold tracking-tight">Biggest items.</h2>
              <p className="mt-1 text-xs text-muted-foreground">Highest spend on work</p>
            </div>
            <ul>
              {ITEMS.map((item) => (
                <li key={item.key} className="flex items-start gap-3 border-b border-border/60 py-3 last:border-b-0">
                  <span className="mt-0.5 size-5 shrink-0" style={{ background: WORK_STATE_COLORS[item.state] }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">{item.amount}</span>
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{item.repo} · {item.key}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
