"use client";

import { useMemo, useState } from "react";
import { TokenBreakdownChart } from "@/components/dashboard/token-breakdown-chart";
import { Panel } from "@/components/panel";
import { SignalsKpi, SignalsSectionHeader } from "@/components/signals/signals-ui";
import { ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { MobileDataCard, MobileDataField, MobileDataList } from "@/components/ui/mobile-data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { toolDisplayName } from "@/lib/tools/catalog";
import type { AiCodingMetrics, ModelUsageRow } from "@/lib/queries/me/overview";

const PAGE_SIZE = 25;

function pct(value: number | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

function formatPricePerMillionTokens(cost: number, tokens: number) {
  if (tokens <= 0) return null;
  return formatUsd((cost * 1_000_000) / tokens);
}

function CostBadge({ row }: { row: ModelUsageRow }) {
  if (row.costKind === "verified_usage" || row.verified) {
    return <Badge variant="default" className="rounded-none">Verified</Badge>;
  }
  if (row.costKind === "estimated_api") {
    return <Badge variant="secondary" className="rounded-none">Estimated</Badge>;
  }
  // Request-only local extracts (e.g. antigravity_local) have calls but no tokens/cost.
  if (row.requests > 0 && row.cost <= 0 && row.inputTokens + row.outputTokens <= 0) {
    return <Badge variant="outline" className="rounded-none">Request-only</Badge>;
  }
  return <Badge variant="outline" className="rounded-none">{row.source}</Badge>;
}

function ModelTable({ title, description, rows }: { title: string; description: string; rows: ModelUsageRow[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          b.requests - a.requests ||
          b.cost - a.cost ||
          b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
          a.toolName.localeCompare(b.toolName) ||
          a.model.localeCompare(b.model),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter(
      (row) =>
        row.model.toLowerCase().includes(q) ||
        row.toolName.toLowerCase().includes(q) ||
        row.source.toLowerCase().includes(q),
    );
  }, [query, sortedRows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Search models…"
          className="h-8 w-full max-w-xs rounded-none text-sm"
        />
      </div>
      {filtered.length ? (
        <>
          <MobileDataList>
            {pageRows.map((row) => (
              <MobileDataCard key={`${row.toolName}-${row.model}-${row.source}-${row.metricKind}`}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ToolLogoTile tool={row.toolName} size="sm" light />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{toolDisplayName(row.toolName)}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{row.model}</p>
                    </div>
                  </div>
                  <CostBadge row={row} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                  <MobileDataField label="Calls" value={formatCompactNumber(row.requests)} />
                  <MobileDataField label="Cost" value={formatUsd(row.cost)} />
                  <MobileDataField label="Input" value={formatCompactNumber(row.inputTokens)} />
                  <MobileDataField label="Output" value={formatCompactNumber(row.outputTokens)} />
                  <MobileDataField
                    label="Cache"
                    value={formatCompactNumber(row.cacheReadTokens + row.cacheWriteTokens)}
                  />
                </dl>
              </MobileDataCard>
            ))}
          </MobileDataList>
          <Table containerClassName="hidden md:block" className="min-w-[760px] text-left text-sm">
            <TableHeader className="border-b border-border/70 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
              <TableRow>
                <TableHead className="pb-3 pr-4 pt-1 font-medium">Tool</TableHead>
                <TableHead className="pb-3 pr-4 pt-1 font-medium">Model</TableHead>
                <TableHead className="pb-3 pr-4 pt-1 text-right font-medium">Calls</TableHead>
                <TableHead className="pb-3 pr-4 pt-1 text-right font-medium">In</TableHead>
                <TableHead className="pb-3 pr-4 pt-1 text-right font-medium">Out</TableHead>
                <TableHead className="pb-3 pr-4 pt-1 text-right font-medium">Cache</TableHead>
                <TableHead className="pb-3 pr-4 pt-1 text-right font-medium">Cost</TableHead>
                <TableHead className="pb-3 pt-1 font-medium">Kind</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) => (
                <TableRow
                  key={`${row.toolName}-${row.model}-${row.source}-${row.metricKind}`}
                  className="transition-colors hover:bg-muted/30"
                >
                  <TableCell className="py-5 pr-4">
                    <div className="flex items-center gap-2.5">
                      <ToolLogoTile tool={row.toolName} size="sm" light />
                      <span className="font-medium">{toolDisplayName(row.toolName)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate py-5 pr-4 font-mono text-xs">{row.model}</TableCell>
                  <TableCell className="py-5 pr-4 text-right tabular-nums">{formatCompactNumber(row.requests)}</TableCell>
                  <TableCell className="py-5 pr-4 text-right tabular-nums">{formatCompactNumber(row.inputTokens)}</TableCell>
                  <TableCell className="py-5 pr-4 text-right tabular-nums">{formatCompactNumber(row.outputTokens)}</TableCell>
                  <TableCell className="py-5 pr-4 text-right tabular-nums">
                    {formatCompactNumber(row.cacheReadTokens + row.cacheWriteTokens)}
                  </TableCell>
                  <TableCell className="py-5 pr-4 text-right tabular-nums">{formatUsd(row.cost)}</TableCell>
                  <TableCell className="py-5">
                    <CostBadge row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="underline-offset-4 hover:underline disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="underline-offset-4 hover:underline disabled:opacity-40"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
          <EmptyDescription>
            {query.trim() ? "No models match your search." : "No model usage reported in this period yet."}
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}

function PersonalValueKpis({ metrics }: { metrics: AiCodingMetrics }) {
  const acceptance =
    metrics.suggestedLines > 0 ? (metrics.acceptedLines / metrics.suggestedLines) * 100 : null;
  const tokens = metrics.inputTokens + metrics.outputTokens;
  const pricePerM = formatPricePerMillionTokens(metrics.cost, tokens);
  const hasChurn = metrics.addedLines > 0 || metrics.deletedLines > 0;

  return (
    <div className="grid items-start gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
      <SignalsKpi
        label="Accept rate"
        className="pl-5"
        value={pct(acceptance)}
        sub={
          metrics.suggestedLines > 0
            ? `${formatCompactNumber(metrics.acceptedLines)} accepted · ${formatCompactNumber(metrics.suggestedLines)} suggested`
            : metrics.acceptedLines > 0
              ? `${formatCompactNumber(metrics.acceptedLines)} accepted`
              : "No suggestions in this window"
        }
      />
      <SignalsKpi
        label="AI-driven commits"
        className="sm:border-l sm:border-border sm:pl-8"
        value={formatCompactNumber(metrics.commits)}
        sub={metrics.commits > 0 ? "scored commits" : "from Cursor tracking"}
      />
      <SignalsKpi
        label="Lines changed"
        className="xl:border-l xl:border-border xl:pl-8"
        value={hasChurn ? formatCompactNumber(metrics.addedLines + metrics.deletedLines) : "—"}
        sub={
          hasChurn
            ? `${formatCompactNumber(metrics.addedLines)} added · ${formatCompactNumber(metrics.deletedLines)} deleted`
            : "No line churn reported"
        }
      />
      <SignalsKpi
        label="Tokens"
        className="sm:border-l sm:border-border sm:pl-8 xl:border-l"
        value={formatCompactNumber(tokens)}
        sub={
          pricePerM
            ? `${pricePerM}/1M · ${formatCompactNumber(metrics.cacheReadTokens)} cache read`
            : `${formatCompactNumber(metrics.cacheReadTokens)} cache read · ${formatCompactNumber(metrics.cacheWriteTokens)} write`
        }
      />
    </div>
  );
}

function FullSpendKpis({ metrics }: { metrics: AiCodingMetrics }) {
  const acceptance =
    metrics.suggestedLines > 0 ? (metrics.acceptedLines / metrics.suggestedLines) * 100 : null;

  return (
    <div className="mb-8 grid items-start gap-y-8 sm:grid-cols-2 xl:grid-cols-5">
      <SignalsKpi
        label="AI lines accepted"
        className="pl-5"
        value={formatCompactNumber(metrics.acceptedLines)}
        sub={
          metrics.suggestedLines > 0
            ? `${formatCompactNumber(metrics.suggestedLines)} suggested · ${pct(acceptance)} accept`
            : undefined
        }
      />
      <SignalsKpi
        label="AI-driven commits"
        className="sm:border-l sm:border-border sm:pl-8"
        value={metrics.aiPercent != null ? pct(metrics.aiPercent) : formatCompactNumber(metrics.commits)}
        sub={metrics.commits > 0 ? `${metrics.commits} scored commits` : "from Cursor tracking"}
      />
      <SignalsKpi
        label="Tokens"
        className="xl:border-l xl:border-border xl:pl-8"
        value={formatCompactNumber(metrics.inputTokens + metrics.outputTokens)}
        sub={`${formatCompactNumber(metrics.cacheReadTokens)} cache read · ${formatCompactNumber(metrics.cacheWriteTokens)} write`}
      />
      <SignalsKpi
        label="Verified usage"
        className="sm:border-l sm:border-border sm:pl-8"
        value={formatUsd(metrics.verifiedCost)}
        sub="vendor-reported charges"
      />
      <SignalsKpi
        label="Estimated API value"
        className="xl:border-l xl:border-border xl:pl-8"
        value={formatUsd(Math.max(0, metrics.cost - metrics.verifiedCost))}
        sub="rate-card reconstruction"
      />
    </div>
  );
}

export function AiCodingPanel({
  metrics,
  models,
  embedded = false,
}: {
  metrics: AiCodingMetrics;
  models: ModelUsageRow[];
  embedded?: boolean;
}) {
  const usageModels = models.filter((row) => row.metricKind !== "productivity");

  const content = (
    <>
      {!embedded ? (
        <SignalsSectionHeader
          title="AI coding."
          description="Verified vendor charges and estimated API-equivalent values are shown separately. Prompt text is never collected."
          bordered={false}
        />
      ) : null}

      {embedded ? <PersonalValueKpis metrics={metrics} /> : <FullSpendKpis metrics={metrics} />}

      <div className="mt-8">
        <h3 className="mb-3 text-sm font-medium">Token breakdown</h3>
        <TokenBreakdownChart
          input={metrics.inputTokens}
          output={metrics.outputTokens}
          cacheRead={metrics.cacheReadTokens}
          cacheWrite={metrics.cacheWriteTokens}
        />
      </div>

      <ModelTable
        title="Every model"
        description={
          usageModels.length
            ? `All ${usageModels.length} ${usageModels.length === 1 ? "model" : "models"} used in this period`
            : "Models appear once usage reports"
        }
        rows={usageModels}
      />
    </>
  );

  if (embedded) return content;

  return (
    <Panel as="section" className="mt-10">
      {content}
    </Panel>
  );
}
