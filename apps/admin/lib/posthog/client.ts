import posthog from "posthog-js";
import { hasAnalyticsConsent } from "@/lib/consent/analytics-consent";
import { analyticsHost } from "@/lib/region";

export const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

let posthogStarted = false;

export function startPostHogIfConsented() {
  if (!isPostHogConfigured || posthogStarted || typeof window === "undefined") return false;
  if (!hasAnalyticsConsent()) return false;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return false;
  posthog.init(token, {
    api_host: analyticsHost(),
    defaults: "2026-05-30",
  });
  posthogStarted = true;
  return true;
}

export function stopPostHogCapturing() {
  if (!isPostHogConfigured) return;
  try {
    posthog.opt_out_capturing();
    posthog.reset();
  } catch {
    // PostHog may not be initialised yet.
  }
  posthogStarted = false;
}

/** Clear the identified person before any auth flow leaves the current page. */
export function resetPostHogIdentity() {
  if (isPostHogConfigured) {
    try {
      posthog.reset();
    } catch {
      // ignore
    }
  }
}
