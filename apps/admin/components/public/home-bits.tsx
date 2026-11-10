import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared section spacing and heading style for the homepage. */
export const HOME_SECTION = "bg-white pt-28 sm:pt-32 lg:pt-44";
export const HOME_H2 = "text-3xl font-semibold leading-[1.1] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl lg:text-[2.5rem]";

/** The quieter second half of a two-part heading. */
export function Muted({ children, block = false }: { children: ReactNode; block?: boolean }) {
  return <span className={cn("text-[#a3a59d]", block && "block")}>{children}</span>;
}

/** Dark result note that sits on the corner of a product window. */
export function ResultNote({
  icon,
  title,
  detail,
  className,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute z-10 flex items-center gap-3 bg-[#111210] py-2.5 pl-2.5 pr-4 text-white shadow-[0_22px_40px_-22px_rgba(17,18,16,0.6)]",
        className,
      )}
    >
      <span
        aria-hidden
        className="inline-flex size-[30px] shrink-0 items-center justify-center bg-brand-yellow text-[0.9375rem] font-bold text-[#111210] [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="leading-tight">
        <span className="block whitespace-nowrap text-[0.8125rem] font-semibold">{title}</span>
        <span className="block whitespace-nowrap text-xs text-[#b9bbb2]">{detail}</span>
      </span>
    </div>
  );
}

/** Small product window: a header line and hairline rows. */
export function MiniWindow({ title, rows }: { title: string; rows: ReactNode[] }) {
  return (
    <div className="border border-border bg-white text-[0.8125rem] leading-snug shadow-[0_30px_60px_-44px_rgba(17,18,16,0.4)]">
      <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">{title}</p>
      <ul>
        {rows.map((row, index) => (
          <li key={index} className="flex min-h-[52px] items-center justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Meter({ percent, hot = false, label = true }: { percent: number; hot?: boolean; label?: boolean }) {
  return (
    <span className="flex w-full max-w-[13rem] items-center gap-3">
      <span className="block h-1.5 flex-1 bg-[#ecede8]" aria-hidden>
        <span
          className={cn("block h-full", hot ? "bg-[var(--public-warning)]" : "bg-primary")}
          style={{ width: `${percent}%` }}
        />
      </span>
      {label ? <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-foreground">{percent}%</span> : null}
    </span>
  );
}

export function SeatSplit({ used, total }: { used: number; total: number }) {
  return (
    <span className="flex h-1.5 gap-0.5" aria-hidden>
      <span className="bg-primary" style={{ flex: used }} />
      {total > used ? <span className="bg-[var(--public-warning)]" style={{ flex: total - used }} /> : null}
    </span>
  );
}

export function StatusDot({ waiting = false }: { waiting?: boolean }) {
  return <span aria-hidden className={cn("mr-2 inline-block size-[7px]", waiting ? "bg-[#d6d8d0]" : "bg-[#16805d]")} />;
}
