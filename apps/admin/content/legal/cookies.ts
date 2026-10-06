import type { ContentPage } from "@/content/types";
import { LEGAL_PRIVACY_VERSION } from "@/lib/legal/versions";

export const cookiesPage: ContentPage = {
  kind: "legal",
  slug: "cookies",
  path: "/cookies",
  title: "Cookie Policy",
  description: "Cookies and similar technologies UseJunction uses, including strictly necessary session cookies and optional PostHog analytics.",
  primaryKeyword: "UseJunction cookies",
  secondaryKeywords: ["UseJunction cookie banner", "PostHog consent"],
  updatedAt: LEGAL_PRIVACY_VERSION,
  indexable: false,
  answer: "UseJunction uses strictly necessary cookies to keep you signed in and remember workspace state. Optional PostHog analytics cookies load only after you opt in from the cookie banner or Settings → Privacy.",
  sections: [
    {
      heading: "Strictly necessary",
      body: [
        "Auth.js session cookie (authjs.session-token or __Secure-authjs.session-token): authenticates your session. Session lifetime.",
        "OAuth state/callback cookies during sign-in with GitHub, Google, or Microsoft.",
        "uj_active_org: remembers the last workspace. First-party, Lax.",
        "sidebar_state: remembers whether the app sidebar is open. First-party.",
      ],
    },
    {
      heading: "Analytics (consent required)",
      body: [
        "uj_consent: stores your analytics choice and policy version for up to 12 months.",
        "PostHog cookies (ph_*) are set only after you accept analytics. They measure product usage. Host: us.i.posthog.com on the US deployment, eu.i.posthog.com on the EU deployment.",
        "Refusing analytics does not affect sign-in or the observability product.",
      ],
    },
    {
      heading: "Managing cookies",
      body: [
        "Use the cookie banner, Settings → Privacy, or your browser controls. Blocking strictly necessary cookies will sign you out.",
      ],
    },
  ],
  faq: [
    {
      question: "Can I use the product without PostHog?",
      answer: "Yes. Choose necessary cookies only. Self-hosted deployments leave PostHog unset unless you configure it.",
    },
  ],
  relatedPaths: ["/privacy", "/gdpr"],
};
