"use client";

import { Ghost } from "@/components/empty-states/ghost";
import { ToolAccountsTable } from "@/components/security/tool-accounts-table";
import type { ToolAccountRow } from "@/lib/app-pages/tool-accounts";

const MINUTE = 60_000;

const SAMPLE: Array<Omit<ToolAccountRow, "id" | "updatedAt" | "signedIn" | "usageShared"> & { minutesAgo: number }> = [
  { person: { id: "sample-maya", name: "Maya Chen" }, toolKey: "claude", email: "maya@acme.dev", ownership: "company", plan: "Team Premium", loginMethod: "oauth", companySeat: true, machine: "maya-mbp", minutesAgo: 12 },
  { person: { id: "sample-jonas", name: "Jonas Weber" }, toolKey: "cursor", email: "j••••@gmail.com", ownership: "personal", plan: "Pro", loginMethod: "oauth", companySeat: true, machine: "jonas-studio", minutesAgo: 40 },
  { person: { id: "sample-asha", name: "Asha Kumar" }, toolKey: "chatgpt-codex", email: "a••••@outlook.com", ownership: "personal", plan: "Plus", loginMethod: "oauth", companySeat: false, machine: "asha-mbp", minutesAgo: 95 },
  { person: { id: "sample-tom", name: "Tom Lindqvist" }, toolKey: "github-copilot", email: null, ownership: "unknown", plan: null, loginMethod: "token", companySeat: true, machine: "tom-linux", minutesAgo: 300 },
  { person: { id: "sample-priya", name: "Priya Nair" }, toolKey: "claude", email: "priya@acme.dev", ownership: "company", plan: "Team Premium", loginMethod: "oauth", companySeat: true, machine: "priya-air", minutesAgo: 520 },
  { person: { id: "sample-leo", name: "Leo Martins" }, toolKey: "cursor", email: "leo@acme.dev", ownership: "company", plan: "Pro+", loginMethod: "oauth", companySeat: true, machine: "leo-mbp", minutesAgo: 1440 },
];

/** Sample logins drawn inside the empty accounts panel until an agent reports one. */
export function ToolAccountsGhostRows() {
  const now = Date.now();
  const rows: ToolAccountRow[] = SAMPLE.map(({ minutesAgo, ...row }, index) => ({
    ...row,
    id: `sample-${index}`,
    signedIn: true,
    usageShared: true,
    updatedAt: new Date(now - minutesAgo * MINUTE).toISOString(),
  }));
  return (
    <Ghost fade className="border-t">
      <ToolAccountsTable rows={rows} />
    </Ghost>
  );
}
