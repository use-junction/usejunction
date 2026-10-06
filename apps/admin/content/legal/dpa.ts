import type { ContentPage } from "@/content/types";
import { LEGAL_PRIVACY_VERSION } from "@/lib/legal/versions";

export const dpaPage: ContentPage = {
  kind: "legal",
  slug: "dpa",
  path: "/dpa",
  title: "Data Processing Addendum",
  description: "Article 28 GDPR processor terms for hosted UseJunction workspaces, including subprocessors, transfers, deletion, and breach notice.",
  primaryKeyword: "UseJunction DPA",
  secondaryKeywords: ["UseJunction processor", "GDPR Article 28"],
  updatedAt: LEGAL_PRIVACY_VERSION,
  indexable: true,
  answer: "This Data Processing Addendum (DPA) is UseJunction's Article 28 processor terms for hosted workspace telemetry. The customer is the controller. We process personal data only on documented instructions, keep it confidential, use approved subprocessors, assist with data-subject rights and DPIAs, notify breaches without undue delay, and delete or return data on contract end.",
  sections: [
    {
      heading: "1. Parties and order of precedence",
      body: [
        "This DPA forms part of the Terms of Service or other written agreement (the Agreement) between the customer (Controller) and UseJunction (Processor) for the hosted Service.",
        "If this DPA conflicts with the Agreement on data-protection matters, this DPA prevails. EU Standard Contractual Clauses, where executed, prevail over this DPA on international transfers.",
      ],
    },
    {
      heading: "2. Subject matter",
      body: [
        "Subject matter: hosting and processing AI coding observability telemetry so the Controller can manage spend, seats, plan utilization, and device coverage.",
        "Duration: the term of the Agreement plus the retention periods in the Privacy Policy unless a shorter deletion instruction is given.",
        "Nature: collection from enrolled devices and vendor integrations, storage, aggregation, display, export, and deletion.",
        "Types of personal data: account identifiers, device metadata, tool-account emails, usage metrics, and (outside the EU hosted region, if enabled) Signals work metadata.",
        "Data subjects: the Controller's employees, contractors, and invited users.",
      ],
    },
    {
      heading: "3. Instructions",
      body: [
        "We process personal data only on the Controller's documented instructions, including configuration in the product (retention, Signals, member removal, export, erasure) and this DPA, unless EU or Member State law requires otherwise.",
        "The Controller warrants that it has a lawful basis and has provided required notices to data subjects, including employment-law notice where applicable.",
      ],
    },
    {
      heading: "4. Confidentiality and security",
      body: [
        "Persons authorised to process personal data are bound by confidentiality. Security measures are described at /security (Art. 32): TLS, hashed device tokens, encrypted integration secrets, RBAC, and audit logs.",
      ],
    },
    {
      heading: "5. Subprocessors",
      body: [
        "The Controller authorises the subprocessors listed at /subprocessors. We will post updates there and, for material additions, give at least 30 days' notice by email or in-product banner so the Controller may object on reasonable data-protection grounds.",
        "We impose data-protection terms on subprocessors no less protective than this DPA.",
      ],
    },
    {
      heading: "6. International transfers",
      body: [
        "EU region workspaces are hosted in the EU. Transfers to subprocessors outside the EEA use the EU-US Data Privacy Framework where certified, otherwise the European Commission's Standard Contractual Clauses (Module 2 controller-to-processor, and Module 3 processor-to-processor as needed) plus a transfer impact assessment.",
        "A copy of the SCCs will be provided to the Controller on request.",
      ],
    },
    {
      heading: "7. Assistance",
      body: [
        "We assist the Controller with data-subject rights using the in-product export and erasure tools and, where those are insufficient, reasonable additional assistance.",
        "We assist with DPIAs and prior consultation to the extent the information is available to us. A customer DPIA pack is published under docs/compliance.",
        "We notify the Controller without undue delay after becoming aware of a personal-data breach affecting Controller data, with the facts then known (Art. 33 as processor).",
      ],
    },
    {
      heading: "8. Deletion and audits",
      body: [
        "On termination we delete or return Controller personal data within 30 days, except data we must retain under Union or Member State law, which we isolate and eventually delete.",
        "The Controller may audit our compliance once per year (or after a confirmed breach) on reasonable notice, subject to confidentiality. We may satisfy the audit with third-party certifications and questionnaire responses where they reasonably address the request.",
      ],
    },
    {
      heading: "9. Contact",
      body: ["Privacy: hello@usejunction.dev."],
    },
  ],
  faq: [
    {
      question: "Do I need to sign a separate DPA?",
      answer: "Hosted use of UseJunction under the Terms incorporates this DPA. Enterprise customers who need a signed copy should email hello@usejunction.dev.",
    },
  ],
  relatedPaths: ["/privacy", "/subprocessors", "/security", "/gdpr"],
};
