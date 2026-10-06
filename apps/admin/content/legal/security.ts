import type { ContentPage } from "@/content/types";
import { LEGAL_PRIVACY_VERSION } from "@/lib/legal/versions";

export const securityPage: ContentPage = {
  kind: "legal",
  slug: "security",
  path: "/security",
  title: "Security",
  description: "Technical and organizational measures UseJunction uses to protect hosted telemetry (GDPR Article 32).",
  primaryKeyword: "UseJunction security",
  secondaryKeywords: ["UseJunction encryption", "AI coding observability security"],
  updatedAt: LEGAL_PRIVACY_VERSION,
  indexable: true,
  answer: "UseJunction protects hosted data with TLS in transit, hashed device tokens, encrypted integration secrets, role-based access, production environment guards, and audit logs for sensitive actions. EU workspaces stay on the EU deployment.",
  sections: [
    {
      heading: "Measures",
      body: [
        "Transport: HTTPS in production; loopback HTTP only for local development.",
        "Secrets: device tokens and enrollment tokens stored as hashes; integration credentials encrypted at rest with INTEGRATION_ENCRYPTION_KEY; production rejects known default secrets.",
        "Access control: organization roles (owner, admin, manager, user). Privacy export and erasure require owner or admin. Raw work-trace viewing is audited.",
        "Isolation: each workspace is scoped by orgId. US and EU hosted regions use separate applications and databases.",
        "Application security: CSRF-style browser mutation guards, rate limiting, CSP, and no indexing of private app routes.",
        "Operations: cron jobs require CRON_SECRET; agent release promotion uses a dedicated operations token.",
      ],
    },
    {
      heading: "Reporting",
      body: ["Report security issues to hello@usejunction.dev. We do not run a public bug bounty at this time."],
    },
  ],
  faq: [
    {
      question: "Is data encrypted at rest?",
      answer: "Integration secrets are encrypted in the application. Database-at-rest encryption is provided by the managed Postgres host; confirm the EU or US provider configuration for your region.",
    },
  ],
  relatedPaths: ["/privacy", "/dpa", "/subprocessors"],
};
