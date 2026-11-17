import type { BeforeSendEvent } from "@vercel/analytics/next";
import { hasAnalyticsConsent, type AnalyticsConsentState } from "@/lib/consent/analytics-consent";

/**
 * Vercel Web Analytics records the URL of each page view. Some of our URLs
 * carry things that must not leave the app: invite tokens in the path
 * (/i/<token>, /join/<token>), device sign-in codes and password-reset tokens
 * in the query string (/connect?code=…, /reset-password?token=…), and ids of
 * people and sessions. Each URL is cut down to its page before it is sent.
 */
const REDACTED_SEGMENTS: Array<{ match: RegExp; replace: string }> = [
  { match: /^\/i\/[^/]+/, replace: "/i/[token]" },
  // /join/company/<slug> names a public company page; any other /join/<x> is an invite token.
  { match: /^\/join\/(?!company(?:\/|$))[^/]+/, replace: "/join/[token]" },
  { match: /^\/team\/[^/]+/, replace: "/team/[developerId]" },
  { match: /^\/signals\/activity\/work\/[^/]+/, replace: "/signals/activity/work/[sessionId]" },
  { match: /^\/signals\/journeys\/[^/]+/, replace: "/signals/journeys/[flowKey]" },
];

/** Keeps the origin and the page; drops the query string and fragment, and replaces tokens and ids in the path. */
export function redactAnalyticsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  let path = parsed.pathname;
  for (const { match, replace } of REDACTED_SEGMENTS) {
    if (match.test(path)) {
      path = path.replace(match, replace);
      break;
    }
  }
  return `${parsed.origin}${path}`;
}

/**
 * The Analytics component's beforeSend: nothing is sent when analytics is
 * turned off in Settings → Privacy (the same switch PostHog follows), and
 * everything else is sent with a redacted URL.
 */
export function prepareAnalyticsEvent(
  event: BeforeSendEvent,
  consent: AnalyticsConsentState | null | undefined = undefined,
): BeforeSendEvent | null {
  if (!(consent === undefined ? hasAnalyticsConsent() : hasAnalyticsConsent(consent))) return null;
  const url = redactAnalyticsUrl(event.url);
  if (!url) return null;
  return { ...event, url };
}
