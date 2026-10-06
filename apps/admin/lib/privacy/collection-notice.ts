import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";

export type CollectionNoticeCopy = {
  version: string;
  title: string;
  summary: string;
  collects: string[];
  neverCollects: string[];
  whoSees: string;
  retention: string;
  usageDefinition: string;
  loggingDefinition: string;
  myDataHref: string;
};

export function collectionNoticeCopy(input?: {
  orgName?: string | null;
  usageRetentionDays?: number | null;
}): CollectionNoticeCopy {
  const org = input?.orgName?.trim() || "your organization";
  return {
    version: COLLECTION_NOTICE_VERSION,
    title: "What UseJunction collects from this device",
    summary: `${org} is connecting this machine so the team can see AI coding tool usage, estimated cost, plan utilization, and device health. UseJunction processes that telemetry for ${org} as a service provider.`,
    collects: [
      "Device metadata (hostname, OS, architecture, agent version)",
      "Installed AI coding tools, versions, and detected account emails or plans",
      "Aggregated usage: tokens, requests, estimated cost, models, repositories, and line metrics",
      "Heartbeat and sync status so coverage and device health can be shown",
    ],
    neverCollects: [
      "Keystrokes, screenshots, clipboard text, or full URLs",
      "Source code or file contents",
      "Full chat transcripts or raw prompt bodies",
    ],
    whoSees: "Workspace owners, admins, and managers can see team-level usage. You can review a summary of data associated with you on My data, and download a complete export.",
    retention: "Your organization decides how long usage is kept. Device activity logs are kept for 30 days.",
    usageDefinition: "Aggregated tokens, requests, models, estimated cost, repositories, and line metrics uploaded from this login. Turning Usage off stops new uploads; days already stored remain until they fall outside the retention window.",
    loggingDefinition: "Structured work summaries from this login, where available. Work-content metadata is not collected or stored in EU workspaces.",
    myDataHref: "/me/data",
  };
}

export function collectionNoticePlainText(copy: CollectionNoticeCopy = collectionNoticeCopy()): string {
  return [
    copy.title,
    "",
    copy.summary,
    "",
    "Collected:",
    ...copy.collects.map((item) => `- ${item}`),
    "",
    "Never collected:",
    ...copy.neverCollects.map((item) => `- ${item}`),
    "",
    copy.whoSees,
    copy.retention,
    `Notice version ${copy.version}.`,
  ].join("\n");
}
