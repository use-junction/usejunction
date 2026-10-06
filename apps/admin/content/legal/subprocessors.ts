import type { ContentPage } from "@/content/types";
import { LEGAL_PRIVACY_VERSION } from "@/lib/legal/versions";
import { isEuDeployment } from "@/lib/region";

export type Subprocessor = {
  name: string;
  purpose: string;
  location: string;
  transfer: string;
};

export function subprocessorsForDeployment(eu = isEuDeployment()): Subprocessor[] {
  return [
    {
      name: "Vercel",
      purpose: "Application hosting and cron",
      location: eu ? "EU (Frankfurt function region)" : "United States",
      transfer: eu ? "EU hosting" : "DPF / SCCs",
    },
    {
      name: "Managed PostgreSQL provider",
      purpose: "Primary product database",
      location: eu ? "EU" : "United States",
      transfer: eu ? "EU hosting" : "DPF / SCCs",
    },
    {
      name: "Lemon Squeezy",
      purpose: "Merchant of Record billing",
      location: "United States",
      transfer: "DPF / SCCs",
    },
    {
      name: "Resend",
      purpose: "Transactional email",
      location: "United States",
      transfer: "DPF / SCCs",
    },
    {
      name: "Ably",
      purpose: "Realtime device sync push",
      location: "Global (including US)",
      transfer: "SCCs",
    },
    {
      name: "PostHog",
      purpose: "Product analytics (only after cookie consent)",
      location: eu ? "EU Cloud" : "US Cloud",
      transfer: eu ? "EU hosting" : "DPF / SCCs",
    },
    {
      name: "GitHub, Google, Microsoft",
      purpose: "Optional OAuth sign-in",
      location: "United States / global",
      transfer: "DPF / SCCs",
    },
    {
      name: "GitHub",
      purpose: "Agent release binaries and optional Copilot billing sync",
      location: "United States",
      transfer: "DPF / SCCs",
    },
  ];
}

export function subprocessorsPage(eu = isEuDeployment()): ContentPage {
  const rows = subprocessorsForDeployment(eu);
  return {
    kind: "legal",
    slug: "subprocessors",
    path: "/subprocessors",
    title: "Subprocessors",
    description: "Processors UseJunction uses to host and operate the Service, with location and transfer mechanism.",
    primaryKeyword: "UseJunction subprocessors",
    secondaryKeywords: ["UseJunction vendors", "UseJunction DPA subprocessors"],
    updatedAt: LEGAL_PRIVACY_VERSION,
    indexable: true,
    answer: `UseJunction uses the vendors below to operate the ${eu ? "EU" : "US"} hosted Service. Material additions are posted here with at least 30 days' notice as described in the DPA.`,
    sections: [
      {
        heading: "Current list",
        body: [
          `This list applies to the ${eu ? "EU (eu.usejunction.dev)" : "US (usejunction.dev)"} deployment you are viewing.`,
          ...rows.map(
            (row) => `${row.name}: ${row.purpose}. Location: ${row.location}. Transfer: ${row.transfer}.`,
          ),
          "Self-hosted deployments use only the vendors the customer configures.",
        ],
      },
      {
        heading: "Changes",
        body: [
          "We will update this page when subprocessors change. Object on reasonable data-protection grounds by emailing hello@usejunction.dev within 30 days of a material addition.",
        ],
      },
    ],
    faq: [
      {
        question: "Does PostHog run without consent?",
        answer: "No. PostHog loads only after analytics consent in the cookie banner or Settings → Privacy.",
      },
    ],
    relatedPaths: ["/dpa", "/privacy", "/security"],
  };
}

export const subprocessorsPageDefault = subprocessorsPage();
