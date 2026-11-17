"use client";

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { isHostedSite, prepareAnalyticsEvent } from "@/lib/web-analytics";

/**
 * Vercel Web Analytics page views: cookieless, opt-out aware, and with tokens
 * and ids taken out of URLs. It loads only on the hosted site, decided in the
 * browser, so self-hosted installs never request Vercel's script.
 */
export function WebAnalytics() {
  const [hosted, setHosted] = useState(false);
  useEffect(() => setHosted(isHostedSite(window.location.hostname)), []);
  if (!hosted) return null;
  return <Analytics beforeSend={(event) => prepareAnalyticsEvent(event)} />;
}
