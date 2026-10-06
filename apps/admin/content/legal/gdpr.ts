import type { ContentPage } from "@/content/types";
import { LEGAL_PRIVACY_VERSION } from "@/lib/legal/versions";

export const gdprPage: ContentPage = {
  kind: "legal",
  slug: "gdpr",
  path: "/gdpr",
  title: "GDPR at UseJunction",
  description: "How UseJunction supports GDPR for EU engineering teams: EU region, what the agent collects, Signals limits, and how to export or erase data.",
  primaryKeyword: "UseJunction GDPR",
  secondaryKeywords: ["EU AI coding observability", "UseJunction data processing"],
  updatedAt: LEGAL_PRIVACY_VERSION,
  indexable: true,
  answer: "UseJunction's EU hosted region stores workspace data in the EU, disables Signals work extraction, shows developers a collection notice before the agent enrolls, and lets people export or erase their data. The customer remains the controller of employee telemetry and must handle employment-law notice and works councils.",
  sections: [
    {
      heading: "What the agent collects",
      body: [
        "Usage, estimated cost, plan utilization, tool inventory, device health, and related metadata from local tool stores. It does not capture keystrokes, screenshots, clipboard, source code, or full chats.",
        "A collection notice is shown in the product before an enrollment token is issued, and the agent records the same notice version on the device.",
      ],
    },
    {
      heading: "EU region",
      body: [
        "Choose the EU region at signup to use eu.usejunction.dev with an EU database. US and EU deployments do not mix customer telemetry.",
        "Signals work extraction (titles, summaries, clipped asks) is off and cannot be enabled on the EU hosted region in this release.",
      ],
    },
    {
      heading: "Your team's responsibilities",
      body: [
        "You are the controller. Provide employees a notice, consult your works council or CSE/OR where required, and do not use the product for unlawful individual surveillance or automated performance decisions.",
        "Templates for an employee notice and a works-council brief live in the open-source repo under docs/compliance.",
      ],
    },
    {
      heading: "Rights requests",
      body: [
        "Each developer can open My data, export a machine-readable bundle, and request erasure. Owners and admins can export or erase a member. Removal from the team schedules erasure after 30 days unless cancelled.",
        "Privacy policy: /privacy. Processor terms: /dpa. Subprocessors: /subprocessors.",
      ],
    },
  ],
  faq: [
    {
      question: "Is employee consent required?",
      answer: "Usually no — and often invalid because of the employment power imbalance. Use a lawful basis such as legitimate interests that is proportionate, plus transparency. We still show a collection notice so people know what is uploaded.",
    },
  ],
  relatedPaths: ["/privacy", "/dpa", "/subprocessors", "/security"],
};
