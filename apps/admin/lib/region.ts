export const DEPLOYMENT_REGIONS = ["us", "eu"] as const;
export type DeploymentRegion = (typeof DEPLOYMENT_REGIONS)[number];

export const DEFAULT_US_APP_URL = "https://usejunction.dev";
export const DEFAULT_EU_APP_URL = "https://eu.usejunction.dev";
export const POSTHOG_US_HOST = "https://us.i.posthog.com";
export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

export function parseDeploymentRegion(value: string | undefined | null): DeploymentRegion {
  return value?.trim().toLowerCase() === "eu" ? "eu" : "us";
}

export function deploymentRegion(env: NodeJS.ProcessEnv = process.env): DeploymentRegion {
  return parseDeploymentRegion(env.DEPLOYMENT_REGION ?? env.NEXT_PUBLIC_DEPLOYMENT_REGION);
}

export function isEuDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return deploymentRegion(env) === "eu";
}

export function signalsProductEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED === "true";
}

export function signalsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return signalsProductEnabled(env) && !isEuDeployment(env);
}

export function analyticsHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return isEuDeployment(env) ? POSTHOG_EU_HOST : POSTHOG_US_HOST;
}

export function isEuPostHogHost(host: string | undefined | null): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(host).hostname.toLowerCase();
    return hostname === "eu.i.posthog.com" || hostname.endsWith(".eu.i.posthog.com") || hostname === "eu.posthog.com";
  } catch {
    return false;
  }
}

export function usAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_US_APP_URL ?? DEFAULT_US_APP_URL).replace(/\/$/, "");
}

export function euAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_EU_APP_URL ?? DEFAULT_EU_APP_URL).replace(/\/$/, "");
}

export function appUrlForRegion(region: DeploymentRegion, env: NodeJS.ProcessEnv = process.env): string {
  return region === "eu" ? euAppUrl(env) : usAppUrl(env);
}

export function regionSwitchUrl(
  region: DeploymentRegion,
  currentUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    return null;
  }
  if (current.hostname === "localhost" || current.hostname === "127.0.0.1") return null;
  const target = new URL(`${current.pathname}${current.search}${current.hash}`, appUrlForRegion(region, env));
  if (target.origin === current.origin) return null;
  return target.toString();
}

export function euPostHogMisconfiguration(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isEuDeployment(env)) return null;
  const host = env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  if (!host) return null;
  if (isEuPostHogHost(host)) return null;
  return "NEXT_PUBLIC_POSTHOG_HOST must be an EU PostHog host (eu.i.posthog.com) when DEPLOYMENT_REGION=eu";
}
