export const DASHBOARD_PERIOD_STORAGE_KEY = "uj.dashboard.rolling-period";

export const PERIOD_PRESETS = [7, 14, 30, 90] as const;
export type PeriodPresetDays = (typeof PERIOD_PRESETS)[number];

export type PresetRollingPeriod = {
  kind: "preset";
  days: PeriodPresetDays;
};

export type CustomRollingPeriod = {
  kind: "custom";
  id: string;
  from: string;
  to: string;
};

export type RollingPeriod = PresetRollingPeriod | CustomRollingPeriod;

export type RollingPeriodPrefs = {
  active: RollingPeriod;
  saved: CustomRollingPeriod[];
};

export const DEFAULT_ROLLING_PERIOD: PresetRollingPeriod = { kind: "preset", days: 30 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPeriodPresetDays(value: number): value is PeriodPresetDays {
  return (PERIOD_PRESETS as readonly number[]).includes(value);
}

export function isIsoDate(value: string | undefined | null): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidCustomPeriod(from: string | undefined, to: string | undefined) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return false;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000) + 1 <= 366;
}

export function shortUtcDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** Calendar ranges budget and renewal reviews use; they resolve to fixed from/to dates. */
export const CALENDAR_RANGES = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "year_to_date", label: "Year to date" },
] as const;

export type CalendarRangeKey = (typeof CALENDAR_RANGES)[number]["key"];

function isoDay(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function calendarRangePeriod(key: CalendarRangeKey, today: Date = new Date()): CustomRollingPeriod {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const todayKey = isoDay(year, month, today.getUTCDate());
  const quarterStart = month - (month % 3);
  const range = (() => {
    switch (key) {
      case "this_month":
        return { from: isoDay(year, month, 1), to: todayKey };
      case "last_month":
        return { from: isoDay(year, month - 1, 1), to: isoDay(year, month, 0) };
      case "this_quarter":
        return { from: isoDay(year, quarterStart, 1), to: todayKey };
      case "last_quarter":
        return { from: isoDay(year, quarterStart - 3, 1), to: isoDay(year, quarterStart, 0) };
      case "year_to_date":
        return { from: isoDay(year, 0, 1), to: todayKey };
    }
  })();
  return { kind: "custom", id: `calendar:${key}`, ...range };
}

/** "This quarter" instead of "Jul 1 – Sep 30" when a custom range is exactly a calendar range. */
export function calendarRangeLabel(period: RollingPeriod, today: Date = new Date()): string | null {
  if (period.kind !== "custom") return null;
  for (const range of CALENDAR_RANGES) {
    const candidate = calendarRangePeriod(range.key, today);
    if (candidate.from === period.from && candidate.to === period.to) return range.label;
  }
  return null;
}

export function rollingPeriodLabel(period: RollingPeriod): string {
  if (period.kind === "preset") return `Last ${period.days} days`;
  const calendar = calendarRangeLabel(period);
  if (calendar) return calendar;
  if (period.from === period.to) return shortUtcDate(period.from);
  return `${shortUtcDate(period.from)} – ${shortUtcDate(period.to)}`;
}

export function rollingPeriodHref(
  period: RollingPeriod,
  basePath = "/dashboard",
  preserveSearch: string | URLSearchParams = "",
): string {
  const params = new URLSearchParams({ view: "last_30_days" });
  if (period.kind === "preset") {
    if (period.days !== 30) params.set("days", String(period.days));
  } else {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  // Preserve audience scope (and other non-period params callers care about).
  const source =
    typeof preserveSearch === "string"
      ? new URLSearchParams(preserveSearch.startsWith("?") ? preserveSearch.slice(1) : preserveSearch)
      : new URLSearchParams(preserveSearch);
  for (const key of ["scope", "team"] as const) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  return `${basePath}?${params.toString()}`;
}

/** Query-only period href for pages that filter metrics without cycle views. */
export function metricPeriodHref(
  period: RollingPeriod,
  basePath: string,
  preserveSearch: string | URLSearchParams = "",
): string {
  const params = new URLSearchParams();
  if (period.kind === "preset") {
    if (period.days !== 30) params.set("days", String(period.days));
  } else {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  const source =
    typeof preserveSearch === "string"
      ? new URLSearchParams(preserveSearch.startsWith("?") ? preserveSearch.slice(1) : preserveSearch)
      : new URLSearchParams(preserveSearch);
  for (const key of ["scope", "team"] as const) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function rollingPeriodShortSuffix(period: RollingPeriod): string {
  if (period.kind === "preset") return `${period.days}d`;
  if (period.from === period.to) return period.from.slice(5);
  return `${period.from.slice(5)}–${period.to.slice(5)}`;
}

export function periodsEqual(a: RollingPeriod, b: RollingPeriod): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "preset" && b.kind === "preset") return a.days === b.days;
  if (a.kind === "custom" && b.kind === "custom") {
    return a.from === b.from && a.to === b.to;
  }
  return false;
}

export function parseRollingPeriodFromSearch(params: {
  days?: string;
  from?: string;
  to?: string;
}): RollingPeriod {
  const from = params.from;
  const to = params.to;
  if (isValidCustomPeriod(from, to)) {
    return { kind: "custom", id: `custom:${from}:${to}`, from: from!, to: to! };
  }

  const days = Number(params.days);
  if (Number.isFinite(days) && isPeriodPresetDays(days)) {
    return { kind: "preset", days };
  }

  return DEFAULT_ROLLING_PERIOD;
}

function normalizeCustom(period: unknown): CustomRollingPeriod | null {
  if (!period || typeof period !== "object") return null;
  const value = period as Partial<CustomRollingPeriod>;
  if (value.kind !== "custom") return null;
  if (!isValidCustomPeriod(value.from, value.to)) return null;
  return {
    kind: "custom",
    id: typeof value.id === "string" && value.id ? value.id : `custom:${value.from}:${value.to}`,
    from: value.from!,
    to: value.to!,
  };
}

function normalizeActive(period: unknown): RollingPeriod {
  if (!period || typeof period !== "object") return DEFAULT_ROLLING_PERIOD;
  const value = period as Partial<RollingPeriod>;
  if (value.kind === "preset" && typeof value.days === "number" && isPeriodPresetDays(value.days)) {
    return { kind: "preset", days: value.days };
  }
  return normalizeCustom(period) ?? DEFAULT_ROLLING_PERIOD;
}

export function readRollingPeriodPrefs(): RollingPeriodPrefs {
  if (typeof window === "undefined") {
    return { active: DEFAULT_ROLLING_PERIOD, saved: [] };
  }
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PERIOD_STORAGE_KEY);
    if (!raw) return { active: DEFAULT_ROLLING_PERIOD, saved: [] };
    const parsed = JSON.parse(raw) as Partial<RollingPeriodPrefs>;
    const saved = Array.isArray(parsed.saved)
      ? parsed.saved
          .map(normalizeCustom)
          .filter((item): item is CustomRollingPeriod => item != null)
          .slice(0, 8)
      : [];
    return { active: normalizeActive(parsed.active), saved };
  } catch {
    return { active: DEFAULT_ROLLING_PERIOD, saved: [] };
  }
}

export function writeRollingPeriodPrefs(prefs: RollingPeriodPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DASHBOARD_PERIOD_STORAGE_KEY, JSON.stringify(prefs));
}

export function setActiveRollingPeriod(period: RollingPeriod): RollingPeriodPrefs {
  const current = readRollingPeriodPrefs();
  const next: RollingPeriodPrefs = {
    active: period,
    saved:
      period.kind === "custom" && !period.id.startsWith("calendar:")
        ? [
            period,
            ...current.saved.filter((item) => !(item.from === period.from && item.to === period.to)),
          ].slice(0, 8)
        : current.saved,
  };
  writeRollingPeriodPrefs(next);
  return next;
}

export function removeSavedRollingPeriod(id: string): RollingPeriodPrefs {
  const current = readRollingPeriodPrefs();
  const next: RollingPeriodPrefs = {
    active:
      current.active.kind === "custom" && current.active.id === id
        ? DEFAULT_ROLLING_PERIOD
        : current.active,
    saved: current.saved.filter((item) => item.id !== id),
  };
  writeRollingPeriodPrefs(next);
  return next;
}
