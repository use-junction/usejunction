"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  analyticsConsentChangeEvent,
  hasResolvedAnalyticsConsent,
  persistAnalyticsConsent,
  readBrowserAnalyticsConsent,
  type AnalyticsConsentState,
} from "@/lib/consent/analytics-consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!hasResolvedAnalyticsConsent());
    function onChange() {
      setVisible(!hasResolvedAnalyticsConsent());
    }
    window.addEventListener(analyticsConsentChangeEvent, onChange);
    return () => window.removeEventListener(analyticsConsentChangeEvent, onChange);
  }, []);

  function choose(analytics: boolean) {
    persistAnalyticsConsent(analytics);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[80] border-t border-border bg-white p-4 shadow-[0_-8px_32px_rgba(16,24,16,0.08)] sm:p-5"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-foreground">Cookies</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            We use strictly necessary cookies to sign you in. Optional analytics (PostHog) help us
            understand product usage and load only if you accept. See the{" "}
            <Link href="/cookies" className="font-medium text-[#08a8c4] underline-offset-4 hover:underline">
              cookie policy
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-none flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => choose(false)}>
            Necessary only
          </Button>
          <Button type="button" onClick={() => choose(true)}>
            Accept analytics
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useAnalyticsConsent(): AnalyticsConsentState | null {
  const [state, setState] = useState<AnalyticsConsentState | null>(null);
  useEffect(() => {
    setState(readBrowserAnalyticsConsent());
    function onChange(event: Event) {
      const detail = (event as CustomEvent<AnalyticsConsentState>).detail;
      setState(detail ?? readBrowserAnalyticsConsent());
    }
    window.addEventListener(analyticsConsentChangeEvent, onChange);
    return () => window.removeEventListener(analyticsConsentChangeEvent, onChange);
  }, []);
  return state;
}
