"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { browserMutationInit, useAppQuery, useInvalidateAppData } from "@/lib/api/client";
import { workSpendProjectKey } from "@/lib/app-pages/query-keys";
import { formatMicrosAsCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GitHubProjectsBadge } from "@/components/features/integration-provider-logos";
import { StateChip } from "@/components/ui/state-chip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ATTRIBUTION_METHOD_COLORS,
  WorkSpendMeter,
  WorkSpendStack,
  WORK_STATE_COLORS,
  microsSharePct,
} from "@/components/features/work-spend-ui";
import { WorkSpendSheet } from "./work-spend-sheet";
import type { AttributionMethod, AttributionMode, WorkFeedItem, WorkSpendProjectInspection, WorkSpendProjectTask } from "./work-spend-types";

const money = formatMicrosAsCurrency;
const WI_TITLE = /^(WI-\d+)\s*:\s*(.*)$/i;
const TOP_VISIBLE = 5;
const FOLD_PAGE = 20;

function taskMicros(task: WorkSpendProjectTask) {
  return BigInt(task.verifiedMicros) + BigInt(task.estimatedMicros);
}

function workMicros(item: WorkFeedItem) {
  return BigInt(item.verifiedMicros) + BigInt(item.estimatedMicros);
}

function taskLabel(title: string) {
  const match = WI_TITLE.exec(title.trim());
  return match ? { key: match[1]!.toUpperCase(), label: match[2] || title } : { key: null, label: title };
}

function taskCommits(task: WorkSpendProjectTask) {
  return task.matches.reduce((sum, item) => sum + item.commitCount, 0);
}

function isGuess(method: AttributionMethod) {
  return method !== "named";
}

/** Whole dollars with a tilde: a guessed split should not look cent-exact. */
function approxMoney(micros: bigint) {
  const dollars = Number(micros) / 1_000_000;
  if (dollars > 0 && dollars < 1) return "<$1";
  return `~$${Math.round(dollars).toLocaleString("en-US")}`;
}

function methodChip(method: AttributionMethod) {
  if (method === "wi_order") return "Estimated by date";
  if (method === "mixed") return "Partly estimated by date";
  return "Linked by issue";
}

function isClosedUnmerged(item: WorkFeedItem) {
  return item.kind === "pull_request" && item.workState === "stalled" && (item.state ?? "").toUpperCase() === "CLOSED";
}

function workNoun(item: WorkFeedItem) {
  if (item.kind === "pull_request") return "pull request";
  const sha = item.sha?.slice(0, 7);
  return sha ? `commit ${sha}` : "commit";
}

function attributionReasonText(item: WorkFeedItem, task: WorkSpendProjectTask) {
  const reason = item.reason;
  const who = workNoun(item);
  const key = taskLabel(task.title).key;
  if (!reason) return "Matched to this task.";
  if (reason.matchedBy === "issue_number") return `${who} says ${reason.reference ?? `#${task.number}`}`;
  if (reason.matchedBy === "closing_reference") return `${who} closes ${reason.reference ?? `#${task.number}`}`;
  if (reason.matchedBy === "project_pr") return "This pull request is on the board.";
  if (reason.matchedBy === "timeline") {
    const slot = reason.position && reason.total ? `${reason.position} of ${reason.total}` : null;
    const target = key ?? "this task";
    return slot ? `${who} is ${slot} in date order, so ${target}` : `${who} was placed on ${target} by WI order`;
  }
  return `${who} is in this repository`;
}

function ruleSentence(data: WorkSpendProjectInspection) {
  if (data.attributionMode === "named_only") {
    return "Only commits and pull requests that name an issue are on tasks. Unnamed work is in Not on a task.";
  }
  if (data.wiTaskCount === 0) return "No WI-numbered tasks on this board, so unnamed commits stay off tasks.";
  const tasks = data.wiTaskCount === 1 ? "1 WI task" : `${data.wiTaskCount} WI tasks`;
  return data.canManage
    ? `Commits that name no issue are spread across ${tasks} in date order. Turn off in How we split this.`
    : `Commits that name no issue are spread across ${tasks} in date order.`;
}

function KpiInfo({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`How ${label.toLowerCase()} is calculated`}
        >
          <Info className="size-3" strokeWidth={2.25} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

function AttributionModePopover({
  projectId, data,
}: {
  projectId: string;
  data: WorkSpendProjectInspection;
}) {
  const invalidate = useInvalidateAppData();
  const [saving, setSaving] = useState(false);
  const wiOrder = BigInt(data.methodMicros.wiOrder);

  async function save(attributionMode: AttributionMode) {
    if (!data.canManage || attributionMode === data.attributionMode || saving) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/app/work-spend/projects/${encodeURIComponent(projectId)}`,
        browserMutationInit("PATCH", { attributionMode }),
      );
      if (!response.ok) throw new Error("Couldn’t update how this project is split.");
      await invalidate();
      toast.success(attributionMode === "named_only" ? "Only named work stays on tasks." : "Unnamed commits are spread by WI order.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t update how this project is split.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-none" disabled={saving}>
          How we split this
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-none p-2">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Choose whether unnamed commits are estimated onto WI tasks.
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={data.attributionMode} onValueChange={(value) => void save(value as AttributionMode)}>
          <DropdownMenuRadioItem value="named_only" disabled={!data.canManage || saving} className="items-start rounded-none py-2.5">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">Only work that names an issue</span>
              <span className="text-xs leading-4 text-muted-foreground">Exact. Fewer tasks covered.</span>
              {wiOrder > 0n ? (
                <span className="text-xs tabular-nums text-muted-foreground">{money(wiOrder.toString())} would move to Not on a task.</span>
              ) : null}
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="wi_order" disabled={!data.canManage || saving} className="items-start rounded-none py-2.5">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">Also spread unnamed commits by WI order</span>
              <span className="text-xs leading-4 text-muted-foreground">Estimate. Covers WI-01…WI-N in date order.</span>
              {wiOrder > 0n ? (
                <span className="text-xs tabular-nums text-muted-foreground">{money(wiOrder.toString())} estimated this way now.</span>
              ) : null}
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectCostSummary({ data, total, days }: { data: WorkSpendProjectInspection; total: string; days: number }) {
  const guessed = BigInt(data.methodMicros.wiOrder);
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        AI spend · last {days} days
        <KpiInfo label="AI spend">Verified plus estimated AI usage attributed to this project in the selected period.</KpiInfo>
      </p>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{money(total)}</p>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="tabular-nums text-foreground">{money(data.verifiedMicros)}</span> measured from tool usage
          <KpiInfo label="Measured">Usage recorded from the coding tool on days with matching commits.</KpiInfo>
        </li>
        {BigInt(data.estimatedMicros) > 0n ? (
          <li className="flex items-center gap-1.5">
            <span className="tabular-nums text-foreground">{money(data.estimatedMicros)}</span> modelled
            <KpiInfo label="Modelled">Usage on days without exact per-commit data, spread by commit count.</KpiInfo>
          </li>
        ) : null}
        {guessed > 0n ? (
          <li><span className="tabular-nums text-foreground">{approxMoney(guessed)}</span> placed on tasks by date, not by an issue link</li>
        ) : null}
      </ul>
    </div>
  );
}

const OUTCOMES = [
  { key: "mergedPr", label: "Merged PRs", color: WORK_STATE_COLORS.shipped, hatched: false },
  { key: "openPr", label: "Open PRs", color: WORK_STATE_COLORS.in_flight, hatched: false },
  { key: "idlePr", label: "PRs idle 14+ days", color: WORK_STATE_COLORS.in_flight, hatched: true },
  { key: "closedPr", label: "Closed without merging", color: WORK_STATE_COLORS.stalled, hatched: false },
  { key: "directCommit", label: "Direct commits", color: "var(--muted-foreground)", hatched: false },
] as const;

function OutcomeSection({ data, total }: { data: WorkSpendProjectInspection; total: string }) {
  const rows = OUTCOMES
    .map((row) => ({ ...row, micros: data.outcomeMicros[row.key] }))
    .filter((row) => BigInt(row.micros) > 0n);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="project-outcome-heading" className="space-y-3">
      <h3 id="project-outcome-heading" className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">What it produced</h3>
      <div className="flex h-3.5 w-full overflow-hidden bg-muted" role="img" aria-label="Spend by outcome">
        {rows.map((row) => {
          const pct = microsSharePct(row.micros, total);
          return pct > 0 ? (
            <span
              key={row.key}
              className="h-full min-w-0"
              title={`${row.label} ${money(row.micros)}`}
              style={row.hatched
                ? { width: `${Math.max(pct, 2)}%`, backgroundImage: `repeating-linear-gradient(135deg, ${row.color} 0 2px, transparent 2px 5px)` }
                : { width: `${Math.max(pct, 2)}%`, background: row.color }}
            />
          ) : null;
        })}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="size-2 shrink-0"
                style={row.hatched ? { boxShadow: `inset 0 0 0 1px ${row.color}` } : { background: row.color }}
                aria-hidden
              />
              {row.label}
            </dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-base font-semibold tabular-nums">{money(row.micros)}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{Math.round(microsSharePct(row.micros, total))}%</span>
            </dd>
          </div>
        ))}
      </dl>
      {BigInt(data.outcomeMicros.directCommit) > 0n ? (
        <p className="text-xs leading-5 text-muted-foreground">Commits pushed without a pull request have no merge signal, so they are counted apart rather than as finished or abandoned.</p>
      ) : null}
    </section>
  );
}

function GuessBanner({ data, total }: { data: WorkSpendProjectInspection; total: string }) {
  if (microsSharePct(data.methodMicros.wiOrder, total) <= 50) return null;
  return (
    <div role="note" className="border-l-2 px-4 py-3 text-sm leading-6" style={{ borderColor: ATTRIBUTION_METHOD_COLORS.wi_order, background: "var(--muted)" }}>
      <p className="font-medium">The task split below is mostly an estimate.</p>
      <p className="text-muted-foreground">
        Commits here rarely mention an issue, so spend is spread across WI tasks by date. Ask the team to write the issue number (for example <code className="font-mono text-xs">#123</code>) in commit messages or PR titles to make it exact.
      </p>
    </div>
  );
}

const SOURCE_LABELS = {
  named: "Linked by an issue",
  wi_order: "Estimated by date (WI order)",
  untasked: "Not on a task",
} as const;

function MethodDisclosure({ data, total }: { data: WorkSpendProjectInspection; total: string }) {
  const segments = [
    { key: "named" as const, micros: data.methodMicros.named },
    { key: "wi_order" as const, micros: data.methodMicros.wiOrder },
    { key: "untasked" as const, micros: data.methodMicros.untasked },
  ].filter((row) => BigInt(row.micros) > 0n);
  return (
    <details className="group border-t border-border/60 pt-4">
      <summary className="cursor-pointer list-none text-sm font-semibold marker:hidden">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
        How spend is placed on tasks
      </summary>
      <div className="mt-3 space-y-3">
        {segments.length > 1 ? (
          <WorkSpendStack
            label="Spend by attribution method"
            segments={segments.map((row) => ({
              key: row.key,
              color: ATTRIBUTION_METHOD_COLORS[row.key],
              pct: microsSharePct(row.micros, total),
              title: `${SOURCE_LABELS[row.key]} ${money(row.micros)}`,
            }))}
          />
        ) : null}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {segments.map((row) => (
            <li key={row.key} className="inline-flex items-center gap-1.5">
              <span className="size-2 shrink-0" style={{ background: ATTRIBUTION_METHOD_COLORS[row.key] }} aria-hidden />
              {SOURCE_LABELS[row.key]} <span className="tabular-nums text-foreground">{money(row.micros)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">{ruleSentence(data)}</p>
      </div>
    </details>
  );
}

function FoldControl({
  remaining, shown, amount, noun, onExpand, onMore, onCollapse,
}: {
  remaining: number;
  shown: number;
  amount: string;
  noun: string;
  onExpand: () => void;
  onMore: () => void;
  onCollapse: () => void;
}) {
  if (remaining <= 0 && shown <= 0) return null;
  if (shown <= 0) {
    return (
      <li className="border-b border-border/60 last:border-b-0">
        <button
          type="button"
          onClick={onExpand}
          className="flex w-full items-baseline justify-between gap-3 py-3 text-left text-sm hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring"
        >
          <span>+{remaining} more {remaining === 1 ? noun : `${noun}s`}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{amount}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-xs text-muted-foreground">
      {shown < remaining ? (
        <button type="button" className="hover:underline" onClick={onMore}>Show {Math.min(FOLD_PAGE, remaining - shown)} more</button>
      ) : null}
      <button type="button" className="hover:underline" onClick={onCollapse}>Show less</button>
    </li>
  );
}

function WorkRow({
  item, onOpen,
}: {
  item: WorkFeedItem;
  onOpen: (item: WorkFeedItem, button: HTMLButtonElement) => void;
}) {
  const amount = money(workMicros(item).toString());
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        aria-label={`${item.title}, ${amount}`}
        onClick={(event) => onOpen(item, event.currentTarget)}
        className="flex w-full items-start gap-3 py-3 text-left hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring"
      >
        <span className="mt-1.5 size-2 shrink-0" style={{ background: WORK_STATE_COLORS[item.workState ?? "in_flight"] }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
            <span className="shrink-0 text-sm font-medium tabular-nums">{amount}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{item.kind === "pull_request" ? "PR" : "Commit"}</span>
            <span className="font-mono">{item.repository.fullName}</span>
            <StateChip state={item.state} workState={item.workState} activityAt={item.activityAt} />
            {item.commitCount > 0 ? <span>{item.commitCount} {item.commitCount === 1 ? "commit" : "commits"}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function TaskRow({
  task, share, onOpen,
}: {
  task: WorkSpendProjectTask;
  share: number;
  onOpen: (task: WorkSpendProjectTask, button: HTMLButtonElement) => void;
}) {
  const micros = taskMicros(task);
  const exact = money(micros.toString());
  const guess = micros > 0n && isGuess(task.method);
  const { key, label } = taskLabel(task.title);
  const commits = taskCommits(task);
  const thin = guess && commits <= 2;
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        aria-label={`${task.title}, ${exact}`}
        onClick={(event) => onOpen(task, event.currentTarget)}
        className="flex w-full items-start gap-3 py-3 text-left hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring"
      >
        <span className="mt-0.5 w-12 shrink-0 font-mono text-xs text-muted-foreground">{key ?? `#${task.number}`}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{label}</span>
            <span className={cn("shrink-0 text-sm font-medium tabular-nums", micros === 0n && "text-muted-foreground")} title={guess ? exact : undefined}>
              {guess ? approxMoney(micros) : exact}
            </span>
          </span>
          <span className="mt-1.5 block">
            <WorkSpendMeter
              size="sm"
              value={share}
              hatched={guess}
              color={guess ? ATTRIBUTION_METHOD_COLORS.wi_order : ATTRIBUTION_METHOD_COLORS.named}
              label={`${task.title} share of project`}
            />
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {task.status ? <span className="text-foreground/80">{task.status}</span> : null}
            <span>{commits} {commits === 1 ? "commit" : "commits"}</span>
            {micros > 0n ? <span>{methodChip(task.method)}</span> : null}
            {thin ? (
              <span className="px-1.5 py-px text-[11px]" style={{ background: "color-mix(in srgb, var(--brand-orange) 14%, transparent)" }}>
                Thin evidence
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function splitTasks(tasks: WorkSpendProjectTask[]) {
  const withSpend: WorkSpendProjectTask[] = [];
  const zero: WorkSpendProjectTask[] = [];
  for (const task of tasks) (taskMicros(task) > 0n ? withSpend : zero).push(task);
  return { top: withSpend.slice(0, TOP_VISIBLE), rest: [...withSpend.slice(TOP_VISIBLE), ...zero], idle: zero.length };
}

function TaskList({
  tasks, projectTotal, untasked, onOpen,
}: {
  tasks: WorkSpendProjectTask[];
  projectTotal: bigint;
  untasked: string;
  onOpen: (task: WorkSpendProjectTask, button: HTMLButtonElement) => void;
}) {
  const { top, rest, idle } = splitTasks(tasks);
  const [shown, setShown] = useState(0);
  const attributed = tasks.reduce((sum, task) => sum + taskMicros(task), 0n);
  const restAmount = rest.reduce((sum, task) => sum + taskMicros(task), 0n).toString();
  const visibleRest = rest.slice(0, shown);
  const shareOf = (task: WorkSpendProjectTask) => (projectTotal > 0n ? Number((taskMicros(task) * 1000n) / projectTotal) / 10 : 0);
  const summary = [
    attributed > 0n ? `${money(attributed.toString())} on ${tasks.length - idle} ${tasks.length - idle === 1 ? "task" : "tasks"}` : null,
    BigInt(untasked) > 0n ? `${money(untasked)} not on a task` : null,
    idle > 0 ? `${idle} with no spend` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="project-tasks-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="project-tasks-heading" className="text-sm font-semibold">Tasks</h3>
        {summary ? <p className="text-xs tabular-nums text-muted-foreground">{summary}</p> : null}
      </div>
      {tasks.length ? (
        <ul className="mt-2">
          {[...top, ...visibleRest].map((task) => (
            <TaskRow key={task.id} task={task} share={shareOf(task)} onOpen={onOpen} />
          ))}
          <FoldControl
            remaining={rest.length}
            shown={shown}
            amount={money(restAmount)}
            noun="task"
            onExpand={() => setShown(FOLD_PAGE)}
            onMore={() => setShown((count) => count + FOLD_PAGE)}
            onCollapse={() => setShown(0)}
          />
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No tasks on this board.</p>
      )}
    </section>
  );
}

function ClosedWithoutMerging({
  items, onOpen,
}: {
  items: WorkFeedItem[];
  onOpen: (item: WorkFeedItem, button: HTMLButtonElement) => void;
}) {
  const closed = items.filter(isClosedUnmerged);
  if (!closed.length) return null;
  const sum = closed.reduce((acc, item) => acc + workMicros(item), 0n).toString();
  return (
    <section aria-labelledby="project-closed-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="project-closed-heading" className="text-sm font-semibold">Closed without merging</h3>
        <p className="text-xs tabular-nums text-muted-foreground">
          {closed.length} {closed.length === 1 ? "pull request" : "pull requests"} · {money(sum)}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">AI spend on pull requests that were closed and never merged.</p>
      <ul className="mt-2">
        {closed.slice(0, TOP_VISIBLE).map((item) => <WorkRow key={item.id} item={item} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

function FoldedWorkList({
  items, noun, empty, onOpen,
}: {
  items: WorkFeedItem[];
  noun: string;
  empty: string;
  onOpen: (item: WorkFeedItem, button: HTMLButtonElement) => void;
}) {
  const top = items.slice(0, TOP_VISIBLE);
  const rest = items.slice(TOP_VISIBLE);
  const [shown, setShown] = useState(0);
  const restAmount = rest.reduce((sum, item) => sum + workMicros(item), 0n).toString();
  if (!items.length) return <p className="mt-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="mt-2">
      {top.map((item) => <WorkRow key={item.id} item={item} onOpen={onOpen} />)}
      {rest.slice(0, shown).map((item) => <WorkRow key={item.id} item={item} onOpen={onOpen} />)}
      <FoldControl
        remaining={rest.length}
        shown={shown}
        amount={money(restAmount)}
        noun={noun}
        onExpand={() => setShown(FOLD_PAGE)}
        onMore={() => setShown((value) => value + FOLD_PAGE)}
        onCollapse={() => setShown(0)}
      />
    </ul>
  );
}

const WORK_FILTERS = [
  { key: "all", label: "All" },
  { key: "shipped", label: "Merged" },
  { key: "in_flight", label: "Open" },
  { key: "stalled", label: "Not moving" },
] as const;

function ProjectWorkList({
  data, onOpen,
}: {
  data: WorkSpendProjectInspection;
  onOpen: (item: WorkFeedItem, button: HTMLButtonElement) => void;
}) {
  const [filter, setFilter] = useState<(typeof WORK_FILTERS)[number]["key"]>("all");
  const all = [...data.pullRequests, ...data.commits].sort((a, b) => {
    const diff = workMicros(b) - workMicros(a);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });
  const counts = Object.fromEntries(WORK_FILTERS.map((option) => [
    option.key,
    option.key === "all" ? all.length : all.filter((item) => item.workState === option.key).length,
  ]));
  const items = filter === "all" ? all : all.filter((item) => item.workState === filter);
  return (
    <section aria-labelledby="project-work-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="project-work-heading" className="text-sm font-semibold">
          Pull requests and commits
          <span className="ml-2 font-normal text-muted-foreground">{data.pullRequestCount} PRs · {data.commitCount} commits</span>
        </h3>
        <div role="radiogroup" aria-label="Filter by outcome" className="flex flex-wrap gap-1">
          {WORK_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={filter === option.key}
              disabled={option.key !== "all" && counts[option.key] === 0}
              onClick={() => setFilter(option.key)}
              className={cn(
                "border px-2 py-0.5 text-xs tabular-nums disabled:opacity-40",
                filter === option.key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label} {counts[option.key]}
            </button>
          ))}
        </div>
      </div>
      <FoldedWorkList
        key={filter}
        items={items}
        noun="item"
        empty="No pull requests or commits matched this project in the selected period."
        onOpen={onOpen}
      />
    </section>
  );
}

function TaskWhySheet({
  task, days, onClose, onOpenWork, onReturnFocus,
}: {
  task: WorkSpendProjectTask | null;
  days: number;
  onClose: () => void;
  onOpenWork: (item: WorkFeedItem, button: HTMLButtonElement) => void;
  onReturnFocus: () => void;
}) {
  const total = task ? taskMicros(task).toString() : "0";
  return (
    <Sheet open={!!task} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }} className="gap-0 sm:w-[38rem] sm:max-w-[38rem]">
        {task ? (
          <>
            <SheetHeader className="border-b p-5 pr-12">
              <p className="text-xs text-muted-foreground">{task.repository.fullName}{task.status ? ` · ${task.status}` : ""}</p>
              <SheetTitle className="break-words text-xl leading-7">{task.title}</SheetTitle>
              <SheetDescription>Why {money(total)} is on this task · last {days} days</SheetDescription>
              {task.url ? (
                <a className="mt-1 inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4" href={task.url} target="_blank" rel="noreferrer">
                  Open on GitHub <ArrowUpRight className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </SheetHeader>
            <div className="space-y-6 p-5">
              <section aria-label="Allocated cost">
                <h3 className="text-sm font-semibold">Allocated cost</h3>
                <dl className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Verified</dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">{money(task.verifiedMicros)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Estimated</dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">{money(task.estimatedMicros)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Usage is split across matched commits on each UTC day.
                  {task.method === "wi_order" ? " This task’s spend is an estimate from WI order." : task.method === "mixed" ? " Some work named this issue; the rest is a WI-order estimate." : " Work named this issue in a commit or pull request."}
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold">Why {money(total)}</h3>
                {task.matches.length ? (
                  <ul className="mt-2 divide-y">
                    {task.matches.map((item) => {
                      const amount = money(workMicros(item).toString());
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            aria-label={`${item.title}, ${amount}`}
                            onClick={(event) => onOpenWork(item, event.currentTarget)}
                            className="flex w-full flex-col gap-1 py-3 text-left hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring"
                          >
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                              <span className="shrink-0 text-sm tabular-nums">{amount}</span>
                            </span>
                            <span className="text-xs leading-5 text-muted-foreground">{attributionReasonText(item, task)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No work was attributed to this task in the selected period.</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function WorkSpendProjectView({
  projectId, days, allocationCurrent,
}: {
  projectId: string;
  days: number;
  allocationCurrent: boolean;
}) {
  const query = useAppQuery<WorkSpendProjectInspection>(
    workSpendProjectKey(projectId, days),
    `/api/app/work-spend/projects/${encodeURIComponent(projectId)}?days=${days}`,
  );
  const openedBy = useRef<HTMLButtonElement | null>(null);
  const [selectedTask, setSelectedTask] = useState<WorkSpendProjectTask | null>(null);
  const [selectedWork, setSelectedWork] = useState<WorkFeedItem | null>(null);
  const data = query.data;
  const total = data ? (BigInt(data.verifiedMicros) + BigInt(data.estimatedMicros)).toString() : "0";

  function openTask(task: WorkSpendProjectTask, button: HTMLButtonElement) {
    openedBy.current = button;
    setSelectedWork(null);
    setSelectedTask(task);
  }

  function openWork(item: WorkFeedItem, button: HTMLButtonElement) {
    openedBy.current = button;
    setSelectedTask(null);
    setSelectedWork(item);
  }

  if (query.isPending) return <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading project…</p>;
  if (query.error || !data) {
    return (
      <p role="alert" className="py-8 text-sm text-destructive">
        {query.error?.status === 404 ? "This project is not in the current GitHub connection." : "Couldn’t load this project."}{" "}
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Retry</Button>
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">{data.title}</h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <GitHubProjectsBadge />
              <span>
                {data.pullRequestCount} {data.pullRequestCount === 1 ? "pull request" : "pull requests"} · {data.commitCount} {data.commitCount === 1 ? "commit" : "commits"}
              </span>
              {data.url ? (
                <a className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline" href={data.url} target="_blank" rel="noreferrer">
                  Open on GitHub <ArrowUpRight className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </p>
          </div>
          {data.canManage ? <AttributionModePopover projectId={projectId} data={data} /> : null}
        </div>
        <div className="grid gap-8 border-y border-border/60 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <ProjectCostSummary data={data} total={total} days={days} />
          <OutcomeSection data={data} total={total} />
        </div>
      </header>

      <div className="space-y-4">
        <GuessBanner data={data} total={total} />
        <TaskList tasks={data.tasks} projectTotal={BigInt(total)} untasked={data.methodMicros.untasked} onOpen={openTask} />
      </div>
      <ClosedWithoutMerging items={data.pullRequests} onOpen={openWork} />
      <ProjectWorkList data={data} onOpen={openWork} />
      <MethodDisclosure data={data} total={total} />

      <TaskWhySheet
        task={selectedWork ? null : selectedTask}
        days={days}
        onClose={() => setSelectedTask(null)}
        onOpenWork={openWork}
        onReturnFocus={() => openedBy.current?.focus()}
      />
      <WorkSpendSheet
        item={selectedWork}
        days={days}
        allocationCurrent={allocationCurrent}
        onClose={() => setSelectedWork(null)}
        onReturnFocus={() => openedBy.current?.focus()}
      />
    </div>
  );
}
