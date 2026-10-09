import { ANALYTICS_CONSENT_VERSION } from "@/lib/legal/versions";

export const ANALYTICS_CONSENT_COOKIE = "uj_consent";
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type AnalyticsConsentState = {
  analytics: boolean;
  version: string;
  at: string;
};

function parseConsentValue(raw: string | undefined | null): AnalyticsConsentState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnalyticsConsentState>;
    if (typeof parsed.analytics !== "boolean") return null;
    if (typeof parsed.version !== "string" || !parsed.version) return null;
    if (typeof parsed.at !== "string" || !parsed.at) return null;
    return { analytics: parsed.analytics, version: parsed.version, at: parsed.at };
  } catch {
    return null;
  }
}

export function readConsentCookie(cookieHeader: string | undefined | null): AnalyticsConsentState | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`));
  if (!match) return null;
  return parseConsentValue(decodeURIComponent(match.slice(ANALYTICS_CONSENT_COOKIE.length + 1)));
}

export function readBrowserAnalyticsConsent(): AnalyticsConsentState | null {
  if (typeof document === "undefined") return null;
  return readConsentCookie(document.cookie);
}

/** Analytics are on by default (covered by the Terms); only an explicit opt-out turns them off. */
export function hasAnalyticsConsent(state: AnalyticsConsentState | null = readBrowserAnalyticsConsent()): boolean {
  return state?.analytics !== false;
}

export function serializeAnalyticsConsent(analytics: boolean, at = new Date()): AnalyticsConsentState {
  return {
    analytics,
    version: ANALYTICS_CONSENT_VERSION,
    at: at.toISOString(),
  };
}

export function analyticsConsentCookie(state: AnalyticsConsentState): string {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  return `${ANALYTICS_CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Path=/; Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function writeBrowserAnalyticsConsent(analytics: boolean): AnalyticsConsentState {
  const state = serializeAnalyticsConsent(analytics);
  if (typeof document !== "undefined") {
    document.cookie = analyticsConsentCookie(state);
  }
  return state;
}

export function persistAnalyticsConsent(analytics: boolean): AnalyticsConsentState {
  const state = writeBrowserAnalyticsConsent(analytics);
  notifyAnalyticsConsentChanged(state);
  if (typeof window !== "undefined") {
    void fetch("/api/app/me/privacy/analytics-consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analytics }),
    }).catch(() => undefined);
  }
  return state;
}

export const analyticsConsentChangeEvent = "uj:analytics-consent";

export function notifyAnalyticsConsentChanged(state: AnalyticsConsentState) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(analyticsConsentChangeEvent, { detail: state }));
}
