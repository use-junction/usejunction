import { cn } from "@/lib/utils";

export function StatCard({
  label,
  count,
  value,
  cents,
  items,
  ruleClass,
  selected,
  onSelect,
  onItem,
}: {
  label: string;
  count: number;
  value: string;
  cents?: string;
  items: Array<{ id: string; title: string; amount: string }>;
  ruleClass: string;
  selected?: boolean;
  onSelect?: () => void;
  onItem?: (id: string) => void;
}) {
  return (
    <div className={cn("bg-card", selected && "bg-muted/40")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className={cn("w-full p-5 text-left focus-visible:outline focus-visible:outline-ring sm:p-6", ruleClass)}>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label} · {count}</p>
        <p className="mt-2 font-display text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
          {value}{cents ? <span className="text-2xl text-muted-foreground sm:text-3xl">.{cents}</span> : null}
        </p>
      </button>
      {items.length ? (
        <ul className="border-t px-5 py-3 sm:px-6">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onItem?.(item.id)} className="flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-sm hover:text-foreground focus-visible:outline focus-visible:outline-ring">
                <span className="min-w-0 truncate">{item.title}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{item.amount}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="border-t px-5 py-3 text-xs text-muted-foreground sm:px-6">No work in this state</p>}
    </div>
  );
}
