import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const WORK_STATE_LABELS = {
  shipped: "Merged",
  in_flight: "Open",
  stalled: "Not moving",
} as const;

export const WORK_STATE_COLORS = {
  shipped: "var(--primary)",
  in_flight: "var(--brand-olive-accent)",
  stalled: "var(--brand-orange)",
} as const;

export const TREND_SERIES_COLORS = [
  "var(--primary)",
  "var(--brand-orange)",
  "var(--brand-olive-accent)",
  "var(--brand-yellow-dark)",
  "var(--border-strong)",
];

export const ATTRIBUTION_METHOD_COLORS = {
  named: "var(--primary)",
  wi_order: "var(--brand-olive-accent)",
  untasked: "var(--brand-orange)",
} as const;

export const ATTRIBUTION_METHOD_LABELS = {
  named: "Named in work",
  wi_order: "Estimated from WI order",
  untasked: "Not on a task",
} as const;

export function microsSharePct(part: string, whole: string) {
  const total = BigInt(whole);
  if (total <= 0n) return 0;
  return Number((BigInt(part) * 1000n) / total) / 10;
}

export function WorkSpendKpi({
  label,
  value,
  sub,
  footer,
  hero,
  accent,
  action,
  compactMobile = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  footer?: ReactNode;
  hero?: boolean;
  accent?: boolean;
  action?: ReactNode;
  compactMobile?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col justify-start",
        compactMobile ? "min-h-24 py-3 sm:min-h-32 sm:py-5" : "min-h-32 py-5",
        accent ? (compactMobile ? "px-3 sm:px-5" : "px-5") : null,
        className,
      )}
    >
      {accent ? <div aria-hidden className="pointer-events-none absolute inset-0 bg-brand-yellow-pale" /> : null}
      <div className="relative flex h-full flex-col justify-start">
        <div className={cn("relative flex items-center", compactMobile ? "h-6 sm:h-8" : "h-8")}>
          <p
            className={cn(
              "min-w-0 font-medium uppercase tracking-[0.08em] text-muted-foreground",
              compactMobile ? "text-[0.65rem] leading-3 sm:text-xs sm:leading-4" : "text-xs leading-4",
              action ? "pr-10" : null,
            )}
          >
            {label}
          </p>
          {action ? <div className="absolute inset-y-0 right-2 flex items-center justify-center">{action}</div> : null}
        </div>
        <div
          className={cn(
            "flex items-end font-semibold tracking-tight tabular-nums leading-none",
            compactMobile ? "mt-1.5 min-h-8" : "mt-2 min-h-10",
            hero
              ? compactMobile
                ? "text-[1.75rem] sm:text-4xl"
                : "text-4xl"
              : compactMobile
                ? "text-[1.75rem] sm:text-3xl"
                : "text-3xl",
          )}
        >
          {value}
        </div>
        {sub ? (
          <div className={cn("mt-2 text-muted-foreground", compactMobile ? "text-[0.68rem] leading-4 sm:text-xs" : "text-xs leading-4")}>
            {sub}
          </div>
        ) : null}
        {footer ? <div className="mt-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function WorkSpendSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function WorkSpendMeter({
  value,
  color,
  label,
  size = "lg",
  hatched = false,
}: {
  value: number;
  color: string;
  label: string;
  size?: "sm" | "lg";
  /** Diagonal stripes instead of a solid fill, for amounts that are a guess. */
  hatched?: boolean;
}) {
  const display = Math.min(100, Math.max(0, value));
  const width = display > 0 ? Math.max(display, 2) : 0;
  return (
    <div
      className={cn("w-full overflow-hidden bg-muted", size === "lg" ? "h-3.5" : "h-2")}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(display)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {width > 0 ? (
        <div
          className="h-full"
          style={hatched
            ? { width: `${width}%`, backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`, boxShadow: `inset 0 0 0 1px ${color}` }
            : { width: `${width}%`, backgroundColor: color }}
        />
      ) : null}
    </div>
  );
}

export function WorkSpendStack({
  segments,
  label,
}: {
  segments: Array<{ key: string; color: string; pct: number; title: string }>;
  label: string;
}) {
  return (
    <div className="flex h-3.5 w-full overflow-hidden bg-muted" role="img" aria-label={label}>
      {segments.map((row) =>
        row.pct > 0 ? (
          <span
            key={row.key}
            className="h-full min-w-0"
            style={{ width: `${Math.max(row.pct, 2)}%`, background: row.color }}
            title={row.title}
          />
        ) : null,
      )}
    </div>
  );
}
