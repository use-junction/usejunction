import { ChevronRight } from "lucide-react";
import { Ghost } from "@/components/empty-states/ghost";
import { buttonVariants } from "@/components/ui/button";
import { formatMicrosAsCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ToolLogoTile } from "./tool-brand-icon";

const SAMPLE = [
  { key: "claude", name: "Claude", plan: "6 Team Premium", seats: 6, assigned: 6, monthly: 750 },
  { key: "cursor", name: "Cursor", plan: "6 Pro+", seats: 6, assigned: 5, monthly: 360 },
  { key: "github-copilot", name: "GitHub Copilot", plan: "10 Business", seats: 10, assigned: 8, monthly: 190 },
];

const LABEL = "mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground";

/** Sample plans drawn inside the empty Manage plans panel, matching its row layout. */
export function CostGhostRows() {
  return (
    <Ghost fade className="mt-4">
      <ul>
        {SAMPLE.map((row) => (
          <li key={row.key} className="grid w-full gap-5 py-5 md:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)_auto] md:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <ToolLogoTile tool={row.key} size="lg" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">{row.name}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">{row.plan}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm tabular-nums">
              <div><span className={LABEL}>Seats</span>{row.assigned} / {row.seats}</div>
              <div><span className={LABEL}>Available</span>{row.seats - row.assigned}</div>
              <div><span className={LABEL}>Cycle cost</span>{formatMicrosAsCurrency(String(row.monthly * 1_000_000))}</div>
            </div>
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-none justify-self-start md:justify-self-end")}>
              Open
              <ChevronRight />
            </span>
          </li>
        ))}
      </ul>
    </Ghost>
  );
}
