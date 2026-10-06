import type { ContentPage } from "@/content/types";
import { siteConfig } from "@/lib/public/config";
import { LEGAL_PRIVACY_VERSION } from "@/lib/legal/versions";

const controllerName = "UseJunction";
const privacyEmail = "hello@usejunction.dev";

export const privacyPage: ContentPage = {
  kind: "legal",
  slug: "privacy",
  path: "/privacy",
  title: "Privacy Policy",
  description: `How ${siteConfig.name} collects, uses, retains, and protects personal data for the hosted service and website, including GDPR rights.`,
  primaryKeyword: "UseJunction privacy",
  secondaryKeywords: ["UseJunction GDPR", "AI coding observability privacy"],
  updatedAt: LEGAL_PRIVACY_VERSION,
  indexable: false,
  answer: `${siteConfig.name} is the controller of website, account, billing, and product-analytics data. For hosted team telemetry (usage, devices, optional Signals), the customer organization is the controller and UseJunction is the processor. We do not sell personal data and we do not use private product or work content to train foundation models. EU hosted workspaces run in the EU region. Signals work extraction is not available there.`,
  sections: [
    {
      heading: "1. Who we are",
      body: [
        `${controllerName} ("UseJunction," "we," "our," or "us") operates usejunction.dev, eu.usejunction.dev, the desktop agent, APIs, and related services (the Service).`,
        "Controller for website, account, billing, support, and our own product analytics: UseJunction. Contact: hello@usejunction.dev. Postal address and EU Article 27 representative will be published here once appointed; until then use the email contact for privacy requests.",
        "Controller for employee/developer telemetry collected for a customer workspace: the customer organization that enrolls devices. UseJunction processes that data on the customer's documented instructions under our Data Processing Addendum at /dpa.",
        "Self-hosted deployments keep telemetry on infrastructure the customer controls. This policy still applies to our hosted website, billing, and any data you send to us for support.",
      ],
    },
    {
      heading: "2. When GDPR applies",
      body: [
        "GDPR applies when we offer the Service to people in the EEA/UK or monitor their behaviour, including through the desktop agent. UK GDPR is treated as a parallel regime.",
        "Personal data includes identifiers such as name, email, device hostname, IP address used for rate limiting, per-developer usage, and any Signals work metadata a customer enables outside the EU region.",
      ],
    },
    {
      heading: "3. Lawful bases (UseJunction as controller)",
      body: [
        "Contract (Art. 6(1)(b)): creating your account, authenticating you, delivering the product you purchased or signed up for, and sending transactional email (verification, invites, password reset, device recovery).",
        "Legal obligation (Art. 6(1)(c)): tax, invoicing, and responding to lawful requests.",
        "Legitimate interests (Art. 6(1)(f)): securing the Service, preventing abuse, rate limiting (including IP address), diagnosing reliability issues, and keeping audit records of privacy-sensitive actions. You may object where the right applies.",
        "Consent (Art. 6(1)(a)): optional PostHog product analytics and non-essential cookies. You can refuse or withdraw consent at any time via the cookie banner or Settings → Privacy. Employee monitoring is not based on employee consent.",
      ],
    },
    {
      heading: "4. Data we collect",
      body: [
        "Account data: name, email, password hash, profile image, timezone, role, terms/privacy acceptance timestamps.",
        "Billing data: plan, Lemon Squeezy customer/subscription identifiers, billing email, tax region metadata, invoices.",
        "Device and agent data: hostname, OS, architecture, agent version, enrollment identifiers, last seen, tool inventory (including config path), tool-account emails and plans, quotas.",
        "Usage telemetry: per-day tokens, requests, estimated cost, models, tools, repositories, line metrics, and derived org-day snapshots.",
        "Optional Signals work context (not available on the EU hosted region): titles, summaries, change narratives, file basenames, git metadata, and clipped user asks only if the customer enables raw work text.",
        "Support and sales: contact-form name, email, company, message; Slack ops alerts on US deployments may include signup email (EU deployments send counts only).",
        "Security: IP address embedded in short-lived rate-limit keys; Auth.js session cookies; device and integration secrets stored hashed or encrypted.",
        "Product analytics (only with consent): PostHog events identified by user id, email, name, organization id, and role.",
      ],
    },
    {
      heading: "5. What we do not collect",
      body: [
        "Keystrokes, screenshots, clipboard text, full URLs, source code, file contents, or full chat transcripts.",
        "Raw prompt fields are rejected at ingest. Classic app/domain journey collection is off in this release.",
        "We do not use Your Data to train foundation models or other general-purpose AI models. We do not sell personal data.",
      ],
    },
    {
      heading: "6. How we use data",
      body: [
        "Provide observability: tool and model usage, estimated cost, plan utilization, seat waste, and device health.",
        "Authenticate users, enroll devices, and prevent fraud or abuse.",
        "Process billing and entitlements.",
        "Send service email you request (verification, invites, optional daily reports which you can disable in Settings).",
        "Comply with law and enforce our Terms.",
        "Improve reliability using aggregated or de-identified information that cannot reasonably identify you.",
      ],
    },
    {
      heading: "7. Recipients and subprocessors",
      body: [
        "We share data with subprocessors listed at /subprocessors (hosting, database, email, realtime, billing, analytics, OAuth). Each processes data only to provide their service.",
        "Integration partners you connect (for example GitHub) receive only the identifiers needed for that integration.",
        "Professional advisors and authorities where required by law.",
        "Successors in a merger or sale, under equivalent protections.",
      ],
    },
    {
      heading: "8. International transfers",
      body: [
        "The EU hosted region (eu.usejunction.dev) stores workspace telemetry in the EU. The US hosted region stores data in the United States.",
        "Some subprocessors are in the United States. Where GDPR Chapter V applies we rely on the EU-US Data Privacy Framework where the vendor is certified, otherwise Standard Contractual Clauses plus a transfer impact assessment.",
        "Self-hosted customers choose their own hosting location.",
      ],
    },
    {
      heading: "9. Retention",
      body: [
        "Account data: for the life of the account, then deleted or anonymised after a verified erasure request, except records we must keep for legal, security, billing, or dispute resolution.",
        "UsageDaily and related snapshots: 3 years by default (organization-configurable 90, 180, 365, 730, or 1095 days). Automated expiry of that window is not yet enforced; we will only keep rows beyond that period if they are still needed.",
        "Signals sessions and work extraction (where enabled): organization retention days (default 90, maximum 366).",
        "Device activity events: 30 days. Provider source records and rate-limit buckets: about 30 days or the rate-limit window.",
        "Audit logs: 2 years, except privacy.* actions which we keep as evidence of rights requests.",
        "When a member is removed, an erasure request is scheduled after a 30-day grace unless an admin cancels it.",
      ],
    },
    {
      heading: "10. Cookies",
      body: [
        "Strictly necessary cookies keep you signed in (Auth.js session) and remember workspace and sidebar state. These do not require consent.",
        "PostHog analytics cookies load only after you opt in. See /cookies for the inventory.",
      ],
    },
    {
      heading: "11. Your rights",
      body: [
        "Depending on your location you may request access, correction, deletion, restriction, objection, and portability (Art. 15–22 GDPR), and you may withdraw consent without affecting prior lawful processing.",
        "Developers can export their own workspace data from My data (/me/data) and request erasure. Organization owners and admins can export or erase a member's data on the customer's instructions.",
        "You may complain to a supervisory authority in your EEA/UK country of residence or work. We would appreciate the chance to resolve your concern first at hello@usejunction.dev.",
        "Employee monitoring rights (including works-council consultation) are the customer's responsibility as controller. We provide notice templates at /gdpr.",
      ],
    },
    {
      heading: "12. Security",
      body: [
        "We use encryption in transit, hashed device tokens, encrypted integration secrets, role-based access, and audit logging of sensitive views. Details: /security.",
        "No system is completely secure. Report issues to hello@usejunction.dev.",
      ],
    },
    {
      heading: "13. Children",
      body: [
        "The Service is not directed to children under 18, and we do not knowingly collect personal information from children under 18.",
      ],
    },
    {
      heading: "14. Changes",
      body: [
        "We may update this policy. Material changes will be posted on the Site and, where required, emailed. The version date above is the effective date.",
      ],
    },
    {
      heading: "15. Contact",
      body: [
        `Privacy requests: ${privacyEmail}. For processor terms see /dpa. For subprocessors see /subprocessors.`,
      ],
    },
  ],
  faq: [
    {
      question: "Do you sell my data or train AI models on it?",
      answer: "No. We do not sell personal data, and we do not use private product data, work context, or organization telemetry to train foundation models.",
    },
    {
      question: "Who is the controller of my coding-tool usage?",
      answer: "Your employer or workspace is the controller. UseJunction is the processor on the hosted service. You remain the controller if you self-host.",
    },
    {
      question: "Where is EU customer data stored?",
      answer: "Hosted EU workspaces use eu.usejunction.dev with an EU database region. US workspaces use the US deployment.",
    },
  ],
  relatedPaths: ["/terms", "/dpa", "/gdpr", "/cookies"],
};
