import { euPostHogMisconfiguration } from "../region";

const DEFAULT_SECRET_VALUES = new Set([
  "admin",
  "change-me-in-production",
  "change-me-ingest-secret",
  "development-cron",
  "sk-usejunction-master",
  "uj_enroll_demo_token_change_me",
]);

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function isLoopbackHttpUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  return isLoopbackHostname(parsed.hostname);
}

export function validateHttpsUnlessLoopback(name: string, raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${name} must be an absolute URL`;
  }
  if (parsed.protocol === "https:") return null;
  if (isLoopbackHttpUrl(value)) return null;
  return `${name} must use HTTPS outside loopback`;
}

function secretProblem(name: string, value: string | undefined, minLength = 32): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return `${name} is required`;
  if (trimmed.length < minLength) return `${name} must be at least ${minLength} characters`;
  if (DEFAULT_SECRET_VALUES.has(trimmed)) return `${name} must not use a known default`;
  return null;
}

function requiredNonEmpty(name: string, value: string | undefined): string | null {
  if (!value?.trim()) return `${name} is required`;
  return null;
}

function lemonBillingConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.LEMONSQUEEZY_API_KEY?.trim() ||
      env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim() ||
      env.LEMONSQUEEZY_STORE_ID?.trim() ||
      env.LEMONSQUEEZY_VARIANT_ID_TEAM?.trim(),
  );
}

function lemonBillingProblems(env: NodeJS.ProcessEnv): Array<string | null> {
  if (!lemonBillingConfigured(env)) return [];
  return [
    secretProblem("LEMONSQUEEZY_API_KEY", env.LEMONSQUEEZY_API_KEY),
    secretProblem("LEMONSQUEEZY_WEBHOOK_SECRET", env.LEMONSQUEEZY_WEBHOOK_SECRET, 16),
    requiredNonEmpty("LEMONSQUEEZY_STORE_ID", env.LEMONSQUEEZY_STORE_ID),
    requiredNonEmpty("LEMONSQUEEZY_VARIANT_ID_TEAM", env.LEMONSQUEEZY_VARIANT_ID_TEAM),
  ];
}

export function assertSecureProductionEnv(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const problems = [
    env.USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT === "true"
      ? "USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT must not be true in production"
      : null,
    secretProblem("AUTH_SECRET", env.AUTH_SECRET ?? env.NEXTAUTH_SECRET),
    secretProblem("INGEST_SECRET", env.INGEST_SECRET),
    secretProblem("CRON_SECRET", env.CRON_SECRET),
    secretProblem("AGENT_RELEASE_OPERATIONS_TOKEN", env.AGENT_RELEASE_OPERATIONS_TOKEN),
    secretProblem("ABLY_API_KEY", env.ABLY_API_KEY),
    env.LITELLM_MASTER_KEY ? secretProblem("LITELLM_MASTER_KEY", env.LITELLM_MASTER_KEY) : null,
    env.ADMIN_PASSWORD ? secretProblem("ADMIN_PASSWORD", env.ADMIN_PASSWORD, 12) : null,
    env.DEMO_ENROLLMENT_TOKEN ? secretProblem("DEMO_ENROLLMENT_TOKEN", env.DEMO_ENROLLMENT_TOKEN, 24) : null,
    validateHttpsUnlessLoopback("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL),
    validateHttpsUnlessLoopback("NEXTAUTH_URL", env.NEXTAUTH_URL),
    euPostHogMisconfiguration(env),
    ...lemonBillingProblems(env),
  ].filter(Boolean);

  if (problems.length) {
    throw new Error(`Insecure production configuration:\n- ${problems.join("\n- ")}`);
  }
}
