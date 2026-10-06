import type { ContentPage } from "@/content/types";
import { siteConfig } from "@/lib/public/config";
import { LEGAL_TERMS_VERSION } from "@/lib/legal/versions";

export const termsPage: ContentPage = {
  kind: "legal",
  slug: "terms",
  path: "/terms",
  title: "Terms of Service",
  description: `Terms for using ${siteConfig.name} software and hosted AI coding observability services, including EU customer terms.`,
  primaryKeyword: "UseJunction terms",
  secondaryKeywords: ["UseJunction terms of service", "UseJunction DPA"],
  updatedAt: LEGAL_TERMS_VERSION,
  indexable: false,
  answer: `These Terms govern access to ${siteConfig.name}. Your data is yours. We do not sell it or use it to train foundation models. Hosted customers are the controller of employee telemetry; you must use the Service lawfully, including employment and works-council rules. EU hosted customers may rely on EU law and are not required to arbitrate in California. Signals work extraction is unavailable in the EU region.`,
  sections: [
    {
      heading: "1. What these Terms cover",
      body: [
        `These Terms apply to ${siteConfig.url}, eu.usejunction.dev, applications, APIs, the desktop agent, and related services. Your use is also subject to the Privacy Policy.`,
        "Self-hosted software is additionally governed by the UseJunction Community License in the repository.",
      ],
    },
    {
      heading: "2. Eligibility and accounts",
      body: [
        "You must be at least 18. You are responsible for accurate account information, credentials, and activity under your account.",
        "Creating an account requires accepting these Terms and the Privacy Policy. We record the version accepted.",
      ],
    },
    {
      heading: "3. Customer as controller of employee telemetry",
      body: [
        "If you enroll developer devices or invite teammates, you are the controller of that personal data. UseJunction is your processor for hosted telemetry under /dpa.",
        "You are responsible for providing employees with a transparent notice, consulting works councils or equivalent bodies where required, completing any DPIA, and not using the Service to surveil individuals in ways that violate privacy or employment law.",
        "You must not use insights for automated decisions that produce legal or similarly significant effects on individuals without a lawful basis and human review.",
        "Signals work extraction (session titles, summaries, clipped asks, file basenames) is disabled on the EU hosted region. Usage, cost, seats, and device health remain available.",
      ],
    },
    {
      heading: "4. License and acceptable use",
      body: [
        "We grant a limited, revocable, non-exclusive, non-transferable license to use the Service, subject to these Terms and the Community License for self-hosted software.",
        "You must not resell the Service except as permitted, interfere with security, upload malware, scrape the hosted Service without permission, or use the Service unlawfully — including unlawful workplace surveillance.",
      ],
    },
    {
      heading: "5. Observability outputs",
      body: [
        "Insights, estimates, and derived metrics can be incomplete, delayed, or inaccurate. You are responsible for reviewing outputs before relying on them in business, legal, financial, security, staffing, or operational decisions.",
      ],
    },
    {
      heading: "6. Your content",
      body: [
        "You retain ownership of telemetry and materials you submit (Your Content). You grant us a worldwide, non-exclusive license to host, store, process, and display Your Content only as needed to provide and secure the Service.",
        "We do not sell Your Content and do not use it to train foundation models.",
      ],
    },
    {
      heading: "7. Billing",
      body: [
        "Paid plans follow checkout or contract pricing. Lemon Squeezy acts as Merchant of Record. Buyer terms: https://www.lemonsqueezy.com/buyer-terms.",
        "Unless required by law, fees are non-refundable. Plans may renew until cancelled.",
      ],
    },
    {
      heading: "8. Disclaimers and liability",
      body: [
        'The Service is provided "as is" to the fullest extent permitted by law.',
        "Nothing in these Terms limits liability that cannot be limited under applicable law, including for death or personal injury caused by negligence, fraud, or (for EEA consumers and, where mandatory, EEA customers) rights that cannot be waived.",
        "Subject to that, we are not liable for indirect or consequential loss, and our aggregate liability is limited to the greater of amounts paid in the twelve months before the claim or USD 100 — except where EU or UK law requires a different result.",
      ],
    },
    {
      heading: "9. Governing law and disputes",
      body: [
        "If your billing address or registered office is in the EEA or United Kingdom, these Terms are governed by the laws of Ireland, and the courts of Ireland have jurisdiction, without prejudice to any mandatory consumer or employment protections in your country.",
        "Otherwise, these Terms are governed by the laws of California, excluding conflict-of-laws rules. Disputes may be resolved by binding individual arbitration except where prohibited by law. Class actions are waived except where a waiver is unenforceable.",
        "EEA/UK customers are not required to arbitrate in California.",
      ],
    },
    {
      heading: "10. Changes and contact",
      body: [
        "We may update these Terms with notice on the Site or by email. Continued use after the effective date means you accept the revised Terms where permitted by law.",
        "Questions: hello@usejunction.dev.",
      ],
    },
  ],
  faq: [
    {
      question: "Who owns my data?",
      answer: "You do. We process it to operate the Service. Employee telemetry is controlled by the customer organization.",
    },
    {
      question: "Can I use Signals in the EU?",
      answer: "Not on the hosted EU region in this release. Usage, cost, seats, and device health remain available. Self-host customers configure Signals under their own lawful basis.",
    },
  ],
  relatedPaths: ["/privacy", "/dpa", "/gdpr"],
};
