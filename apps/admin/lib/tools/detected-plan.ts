import { findCatalogTool } from "./catalog";

const DEFAULT_PLAN_KEYS: Record<string, string> = {
  "chatgpt-codex": "free",
  claude: "free",
  cursor: "hobby",
  antigravity: "individual",
  "github-copilot": "free",
  opencode: "multi_provider",
};

// Tools where simply being signed in justifies auto-creating a base-tier seat,
// even before we learn the vendor plan. Claude is deliberately excluded: Claude
// Code runs on a paid subscription (Pro/Max/Team/Enterprise), so defaulting a
// detected login to "Free" is almost always wrong. When we cannot read the
// plan for a Claude login we leave it as "Plan unknown" for an admin to assign.
const AUTH_ONLY_SEAT_DEFAULTS: Record<string, string> = {
  "chatgpt-codex": "free",
  cursor: "hobby",
  antigravity: "individual",
  "github-copilot": "free",
  opencode: "multi_provider",
};

const VENDOR_PLAN_ALIASES: Record<string, Record<string, string>> = {
  cursor: {
    free: "hobby",
    hobby: "hobby",
    pro: "pro",
    "pro-plus": "pro-plus",
    "pro+": "pro-plus",
    proplus: "pro-plus",
    ultra: "ultra",
    business: "teams",
    team: "teams",
    teams: "teams",
    enterprise: "enterprise",
    free_trial: "pro",
    "free-trial": "pro",
  },
  antigravity: {
    free: "individual",
    individual: "individual",
    "g1-free": "individual",
    "g1-free-tier": "individual",
    plus: "google-ai-plus",
    "google-ai-plus": "google-ai-plus",
    "g1-plus": "google-ai-plus",
    "g1-plus-tier": "google-ai-plus",
    "google ai plus": "google-ai-plus",
    pro: "google-ai-pro",
    "google-ai-pro": "google-ai-pro",
    "g1-pro": "google-ai-pro",
    "g1-pro-tier": "google-ai-pro",
    "google ai pro": "google-ai-pro",
    ultra: "google-ai-ultra",
    "google-ai-ultra": "google-ai-ultra",
    "g1-ultra": "google-ai-ultra",
    "g1-ultra-tier": "google-ai-ultra",
    "google ai ultra": "google-ai-ultra",
    "ultra-max": "google-ai-ultra-max",
    "google-ai-ultra-max": "google-ai-ultra-max",
    "g1-ultra-max": "google-ai-ultra-max",
    "google ai ultra max": "google-ai-ultra-max",
    organization: "organization",
    enterprise: "organization",
  },
  "chatgpt-codex": {
    free: "free",
    go: "go",
    plus: "plus",
    pro: "pro",
    business: "business",
    team: "business",
    enterprise: "enterprise",
  },
  claude: {
    free: "free",
    pro: "pro",
    max: "max-5x",
    "max-5x": "max-5x",
    "max-20x": "max-20x",
    team: "team-standard",
    "team-standard": "team-standard",
    team_standard: "team-standard",
    "team-premium": "team-premium",
    enterprise: "enterprise",
  },
  "github-copilot": {
    free: "free",
    student: "student",
    educational: "student",
    "free-educational-quota": "student",
    "individual-free-educational-quota": "student",
    pro: "pro",
    "pro-plus": "pro-plus",
    proplus: "pro-plus",
    max: "max",
    business: "business",
    enterprise: "enterprise",
  },
  opencode: {
    zen: "zen",
    multi_provider: "multi_provider",
    "multi-provider": "multi_provider",
    multiprovider: "multi_provider",
    free: "multi_provider",
  },
};

export function hasReportedVendorPlan(plan: string | null | undefined): boolean {
  return Boolean(plan?.trim());
}

export function canAutoCreateDetectedSeat(
  toolKey: string,
  input: { hasVendorPlan: boolean; authPresent?: boolean },
): boolean {
  if (input.hasVendorPlan) return true;
  return Boolean(input.authPresent && AUTH_ONLY_SEAT_DEFAULTS[toolKey]);
}

function normalizeVendorPlan(plan: string) {
  return plan
    .trim()
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[/\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function vendorPlanCandidates(vendorPlan: string) {
  const normalized = normalizeVendorPlan(vendorPlan);
  const segments = vendorPlan
    .split("/")
    .map((part) => normalizeVendorPlan(part))
    .filter(Boolean);
  return [...new Set([normalized, ...segments])];
}

export function mapVendorPlanToCatalog(
  toolKey: string,
  vendorPlan: string | null | undefined,
): string {
  const tool = findCatalogTool(toolKey);
  const fallback = DEFAULT_PLAN_KEYS[toolKey] ?? tool?.plans[0]?.key ?? "free";
  if (!tool) return fallback;
  if (!vendorPlan?.trim()) return fallback;

  const aliases = VENDOR_PLAN_ALIASES[toolKey];
  for (const candidate of vendorPlanCandidates(vendorPlan)) {
    if (tool.plans.some((plan) => plan.key === candidate)) return candidate;
    const alias = aliases?.[candidate];
    if (alias) return alias;
  }
  return fallback;
}

// Catalog plans are listed weakest-first, so a plan's index is its strength.
// Returns -1 for an unknown tool.
export function vendorPlanRank(toolKey: string, vendorPlan: string | null | undefined): number {
  const tool = findCatalogTool(toolKey);
  if (!tool) return -1;
  const key = mapVendorPlanToCatalog(toolKey, vendorPlan);
  return tool.plans.findIndex((plan) => plan.key === key);
}

// strongerVendorPlan picks the higher-tier of two vendor plans for a tool, used
// when one person has several logins (e.g. personal Pro + work Team) and we must
// choose a single billing seat. Ties keep the first argument.
export function strongerVendorPlan(toolKey: string, a: string, b: string): string {
  return vendorPlanRank(toolKey, a) >= vendorPlanRank(toolKey, b) ? a : b;
}
