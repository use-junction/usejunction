export const PRICING_VERSION = "2026-10-20";
export const CALCULATION_VERSION = "usage-v2";

export const ACTIVITY_PRIORITY: Record<string, number> = {
  vendor_verified: 0,
  otel_observed: 1,
  device_observed: 2,
  gateway_observed: 3,
  estimated: 4,
};

export const COST_PRIORITY: Record<string, number> = {
  vendor_verified: 0,
  invoice_imported: 0,
  gateway_observed: 1,
  estimated: 2,
  device_observed: 2,
  otel_observed: 3,
};

const SOURCE_ALIASES: Record<string, string> = {
  local_scan: "device_observed",
  cursor_local: "device_observed",
  cursor_usage_events: "vendor_verified",
  cursor_plan_percent: "device_observed",
  antigravity_local: "device_observed",
  antigravity_usage: "device_observed",
  opencode_local: "device_observed",
  opencode_usage: "device_observed",
};

export function normalizeSource(source: string): string {
  return SOURCE_ALIASES[source] ?? source;
}

export function isProductivityMetric(metricKind: string | null | undefined, source: string): boolean {
  if (metricKind === "productivity") return true;
  return source === "cursor_local" || source === "opencode_local";
}

export function costKindForRow(input: {
  verified: boolean;
  source: string;
  metricKind?: string | null;
  costMicros: bigint;
}): "verified_usage" | "estimated_api" | "actual_spend" | null {
  if (input.costMicros <= BigInt(0)) return null;
  if (input.verified || normalizeSource(input.source) === "vendor_verified") return "verified_usage";
  if (normalizeSource(input.source) === "invoice_imported") return "actual_spend";
  return "estimated_api";
}

export function activityPriority(source: string): number {
  return ACTIVITY_PRIORITY[normalizeSource(source)] ?? 99;
}

export function costPriority(source: string): number {
  return COST_PRIORITY[normalizeSource(source)] ?? 99;
}

/** Telemetry-backed sources only — excludes synthetic rate-card fallbacks. */
export function isObservedSource(source: string): boolean {
  return normalizeSource(source) !== "estimated";
}
