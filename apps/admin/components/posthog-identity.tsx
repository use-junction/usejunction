"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import posthog from "posthog-js";
import { analyticsConsentChangeEvent, hasAnalyticsConsent } from "@/lib/consent/analytics-consent";
import { isPostHogConfigured, resetPostHogIdentity, startPostHogIfConsented } from "@/lib/posthog/client";

/** Keeps PostHog's browser identity aligned with the active NextAuth session. */
export function PostHogIdentity() {
  const { data: session, status } = useSession();
  const lastUserId = useRef<string | null>(null);
  const lastIdentityFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (!isPostHogConfigured || status === "loading") return;

    function syncIdentity() {
      if (!hasAnalyticsConsent()) {
        lastIdentityFingerprint.current = null;
        return;
      }
      startPostHogIfConsented();

      const user = session?.user;
      if (status === "authenticated" && user?.id) {
        if (lastUserId.current && lastUserId.current !== user.id) {
          resetPostHogIdentity();
        }

        const properties = {
          ...(user.email ? { email: user.email } : {}),
          ...(user.name ? { name: user.name } : {}),
          ...(user.orgId ? { organization_id: user.orgId } : {}),
          ...(user.role ? { organization_role: user.role } : {}),
        };
        const fingerprint = JSON.stringify([user.id, properties]);

        if (lastIdentityFingerprint.current !== fingerprint) {
          posthog.identify(user.id, properties);
          lastIdentityFingerprint.current = fingerprint;
        }
        if (user.orgId) {
          posthog.group("organization", user.orgId);
        }

        lastUserId.current = user.id;
        return;
      }

      if (lastUserId.current) resetPostHogIdentity();
      lastUserId.current = null;
      lastIdentityFingerprint.current = null;
    }

    syncIdentity();
    window.addEventListener(analyticsConsentChangeEvent, syncIdentity);
    return () => window.removeEventListener(analyticsConsentChangeEvent, syncIdentity);
  }, [
    session?.user?.email,
    session?.user?.id,
    session?.user?.name,
    session?.user?.orgId,
    session?.user?.role,
    status,
  ]);

  return null;
}
