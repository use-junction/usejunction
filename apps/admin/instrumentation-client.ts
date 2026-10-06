import { analyticsConsentChangeEvent, hasAnalyticsConsent } from "@/lib/consent/analytics-consent";
import { isPostHogConfigured, startPostHogIfConsented, stopPostHogCapturing } from "@/lib/posthog/client";

if (isPostHogConfigured) {
  startPostHogIfConsented();
  if (typeof window !== "undefined") {
    window.addEventListener(analyticsConsentChangeEvent, (event) => {
      const analytics = Boolean((event as CustomEvent<{ analytics?: boolean }>).detail?.analytics) && hasAnalyticsConsent();
      if (analytics) startPostHogIfConsented();
      else stopPostHogCapturing();
    });
  }
}
