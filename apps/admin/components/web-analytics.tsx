"use client";

import { Analytics } from "@vercel/analytics/next";
import { prepareAnalyticsEvent } from "@/lib/web-analytics";

/** Vercel Web Analytics page views: cookieless, opt-out aware, and with tokens and ids taken out of URLs. */
export function WebAnalytics() {
  return <Analytics beforeSend={(event) => prepareAnalyticsEvent(event)} />;
}
