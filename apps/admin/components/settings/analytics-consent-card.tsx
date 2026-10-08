"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  analyticsConsentChangeEvent,
  hasAnalyticsConsent,
  persistAnalyticsConsent,
  readBrowserAnalyticsConsent,
} from "@/lib/consent/analytics-consent";

export function AnalyticsConsentCard() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(hasAnalyticsConsent());
    function onChange() {
      setEnabled(hasAnalyticsConsent(readBrowserAnalyticsConsent()));
    }
    window.addEventListener(analyticsConsentChangeEvent, onChange);
    return () => window.removeEventListener(analyticsConsentChangeEvent, onChange);
  }, []);

  function toggle() {
    persistAnalyticsConsent(!enabled);
  }

  return (
    <Panel as="section" className="sm:p-6" aria-labelledby="analytics-consent-heading">
      <h2 id="analytics-consent-heading" className="text-lg font-semibold tracking-tight">
        Analytics cookies
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        PostHog product analytics are on by default. Necessary sign-in cookies are always on. You can
        turn analytics off any time.
      </p>
      <Button type="button" variant="outline" className="mt-4 rounded-none" onClick={toggle}>
        {enabled ? "Disable analytics cookies" : "Enable analytics cookies"}
      </Button>
    </Panel>
  );
}
