"use client";

import {
  TREND_SERIES_COLORS,
  WorkSpendMeter,
  WorkSpendStack,
  microsSharePct,
} from "@/components/features/work-spend-ui";
import type { WorkSpendPayload } from "@/components/features/work-spend-types";
import { formatMicrosAsCurrency } from "@/lib/format";

export function WorkSpendMix({ data }: { data: WorkSpendPayload }) {
  const allocated = data.coverage.attributedMicros;
  const period = `last ${data.days} days`;
  const cycleCount = Math.max(1, Math.round(data.days / 30));
  const cycleLabel = cycleCount === 1 ? "1 cycle" : `${cycleCount} cycles`;
  const repos = [...data.repositories]
    .map((repo) => ({
      ...repo,
      micros: (BigInt(repo.verifiedMicros) + BigInt(repo.estimatedMicros)).toString(),
    }))
    .filter((repo) => BigInt(repo.micros) > 0n)
    .sort((a, b) => (BigInt(a.micros) === BigInt(b.micros) ? a.fullName.localeCompare(b.fullName) : BigInt(a.micros) > BigInt(b.micros) ? -1 : 1))
    .slice(0, 6);
  const changeTotal = data.changeMix.reduce((sum, row) => sum + row.count, 0);
  const changes = data.changeMix.map((row, index) => ({
    ...row,
    pct: changeTotal > 0 ? Math.round((row.count / changeTotal) * 1000) / 10 : 0,
    color: TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1],
  }));

  return (
    <section aria-label="Spend by repository" className="min-w-0">
      <h2 className="text-lg font-semibold tracking-tight">By repository.</h2>
      <p className="mt-1.5 text-xs text-muted-foreground">Spend on work by repo for the {period} ({cycleLabel}).</p>
      {repos.length ? (
        <ul className="mt-4 divide-y divide-border">
          {repos.map((repo, index) => {
            const share = microsSharePct(repo.micros, allocated);
            const color = TREND_SERIES_COLORS[index] ?? TREND_SERIES_COLORS[TREND_SERIES_COLORS.length - 1];
            return (
              <li key={repo.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium">{repo.fullName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {repo.pullRequestCount} {repo.pullRequestCount === 1 ? "PR" : "PRs"} · {repo.commitCount} {repo.commitCount === 1 ? "commit" : "commits"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatMicrosAsCurrency(repo.micros)}</p>
                    {BigInt(repo.estimatedMicros) > 0n ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">Estimated usage · across {cycleLabel}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2">
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.7rem] leading-snug text-muted-foreground">
                    <span>
                      <span className="font-medium tabular-nums text-foreground">{share}%</span> of spend on work · {period}
                    </span>
                  </div>
                  <WorkSpendMeter value={share} color={color} label={`${repo.fullName} ${share}% of spend on work · ${period}`} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No repository spend in the {period}.</p>
      )}

      {changes.length ? (
        <div className="mt-8">
          <h3 className="text-sm font-semibold tracking-tight">Commit types.</h3>
          <p className="mt-1 text-xs text-muted-foreground">Prefixes on the commits in this work.</p>
          <div className="mt-3">
            <WorkSpendStack
              label="Commit prefixes in work with spend"
              segments={changes.map((row) => ({ key: row.type, color: row.color, pct: row.pct, title: `${row.type} ${row.pct}%` }))}
            />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {changes.map((row) => (
              <li key={row.type} className="inline-flex items-center gap-1.5">
                <span className="size-2 shrink-0" style={{ background: row.color }} aria-hidden />
                {row.type} · {row.count}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
