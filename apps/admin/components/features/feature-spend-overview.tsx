import { CircleHelp, GitCommitHorizontal } from "lucide-react";
import { Panel } from "@/components/panel";
import type { FeaturesPagePayload } from "@/lib/app-pages/features";
import { formatMicrosAsCurrency } from "@/lib/format";

function money(value: bigint | string) {
  return formatMicrosAsCurrency(String(value));
}

export function FeatureSpendOverview({ data }: { data: FeaturesPagePayload }) {
  const verified = BigInt(data.kpis.verifiedMicros);
  const estimated = BigInt(data.kpis.estimatedMicros);
  const total = verified + estimated;
  const unattributed = BigInt(data.kpis.unattributedMicros);
  const attributed = total > unattributed ? total - unattributed : BigInt(0);
  const coverage = Math.max(0, Math.min(100, data.kpis.mappedPct));
  const verifiedPercent = total > BigInt(0) ? Number((verified * BigInt(10000)) / total) / 100 : 0;

  return (
    <section aria-label="AI spend overview" className="mb-8 grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,1fr)]">
      <div className="uj-grid-texture relative flex min-h-64 flex-col justify-between overflow-hidden bg-foreground p-6 text-background [--uj-grid-opacity:0.055] sm:p-8">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Cost linked to shipped work</p>
            <p className="mt-3 text-5xl font-semibold tracking-[-0.06em] tabular-nums sm:text-6xl">{coverage.toFixed(1)}<span className="ml-1 text-3xl text-brand-yellow sm:text-4xl">%</span></p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">{money(attributed)} of your AI spend was matched to commits in this period.</p>
          </div>
          <div className="flex size-12 shrink-0 items-center justify-center border border-white/15 bg-white/5 text-brand-yellow"><GitCommitHorizontal className="size-6" aria-hidden /></div>
        </div>
        <div className="relative mt-8">
          <div className="flex justify-between gap-3 text-xs font-medium tabular-nums"><span>Attributed {money(attributed)}</span><span className="text-white/60">Unattributed {money(unattributed)}</span></div>
          <div role="meter" aria-label="AI spend attributed to commits" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage} className="mt-3 h-2.5 overflow-hidden bg-white/20">
            <div className="h-full bg-brand-yellow" style={{ width: `${coverage}%` }} />
          </div>
        </div>
      </div>

      <Panel className="flex min-h-64 flex-col justify-between p-6 sm:p-8">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">AI spend in this window</p><p className="mt-3 text-4xl font-semibold tracking-[-0.045em] tabular-nums sm:text-5xl">{money(total)}</p></div>
            <CircleHelp className="size-4 text-muted-foreground" aria-label="Verified and estimated amounts are shown separately below" />
          </div>
          <div className="mt-6 flex h-2 overflow-hidden bg-muted" aria-label="Share of verified and estimated AI spend">
            <div className="bg-brand-yellow-dark" style={{ width: `${verifiedPercent}%` }} />
            <div className="bg-foreground/25" style={{ width: `${100 - verifiedPercent}%` }} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 bg-brand-yellow-dark" />Verified usage</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(verified)}</p></div>
            <div><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 bg-foreground/25" />Estimated usage</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(estimated)}</p></div>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between gap-4 border-t pt-4 text-xs text-muted-foreground"><span>Typical allocated cost per commit</span><span className="font-semibold tabular-nums text-foreground">{money(data.kpis.medianCostPerCommit)}</span></div>
      </Panel>
    </section>
  );
}
