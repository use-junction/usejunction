"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppPageSkeleton } from "@/components/app-data-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { HubTabList } from "@/components/hub-nav";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { appFetch } from "@/lib/api/client";
import type { AuditEntry } from "@/lib/audit/read";

type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "access", label: "Access" },
  { id: "billing", label: "Billing & seats" },
  { id: "integrations", label: "Integrations" },
  { id: "privacy", label: "Privacy" },
  { id: "devices", label: "Machines" },
  { id: "settings", label: "Settings" },
] as const;

/** Plain-English labels for the actions people look for; anything else shows its raw name. */
const ACTION_LABELS: Record<string, string> = {
  "member.removed": "Removed a member",
  "member.role_updated": "Changed a member's role",
  "invite.created": "Invited someone",
  "invite.accepted": "Accepted an invite",
  "invite.role_updated": "Changed an invite's role",
  "team_invite_link.redeemed": "Joined with the team link",
  "domain.created": "Added a company domain",
  "domain.verified": "Verified a company domain",
  "domain_join.accepted": "Joined through the company domain",
  "workspace.created": "Created the workspace",
  "team.created": "Created a team",
  "team.updated": "Renamed a team",
  "team.deleted": "Deleted a team",
  "team.members_assigned": "Moved people into a team",
  "team.members_unassigned": "Removed people from a team",
  "billing.checkout_created": "Started checkout",
  "billing.portal_opened": "Opened the billing portal",
  "billing.subscription_synced": "Billing subscription synced",
  "billing.assignment_created": "Assigned a seat",
  "billing.assignment_updated": "Changed a seat",
  "billing.assignment_archived": "Removed a seat",
  "billing.assignments_bulk_created": "Assigned seats in bulk",
  "tools.subscription_created": "Added a tool plan",
  "tools.subscription_updated": "Changed a tool plan",
  "tools.subscription_archived": "Removed a tool plan",
  "integration.connected": "Connected an integration",
  "integration.disconnected": "Disconnected an integration",
  "integration.synced": "Synced an integration",
  "integration.credential_rotated": "Rotated an integration key",
  "privacy.export_completed": "Exported personal data",
  "privacy.erasure_requested": "Requested data erasure",
  "privacy.erasure_completed": "Erased personal data",
  "privacy.erasure_cancelled": "Cancelled an erasure",
  "privacy.retention_updated": "Changed data retention",
  "consent.analytics_granted": "Turned analytics cookies on",
  "consent.analytics_withdrawn": "Turned analytics cookies off",
  "account_collection.usage_enabled": "Turned on usage sharing for a tool login",
  "account_collection.usage_disabled": "Turned off usage sharing for a tool login",
  "device.repair_token_issued": "Issued a machine repair token",
  "activity_settings.updated": "Changed team visibility settings",
  "workspace.renamed": "Renamed the workspace",
  "workspace.updated": "Changed workspace details",
  "workspace.joined": "Joined the workspace",
  "enrollment_token.created": "Created a machine enrollment token",
  "enrollment_token.rotated": "Rotated the machine enrollment token",
  "telemetry_token.rotated": "Rotated the telemetry token",
  "integration.github_app_installed": "Installed the GitHub app",
  "integration.github_projects_selected": "Chose GitHub Projects to sync",
  "integration.github_projects_synced": "Synced GitHub Projects",
  "integration.github_projects_disconnected": "Disconnected GitHub Projects",
  "integration.linear_connected": "Connected Linear",
  "integration.linear_disconnected": "Disconnected Linear",
  "integration.linear_synced": "Synced Linear",
  "integration.invoice_imported": "Imported an invoice",
  "github_identity.mapped": "Matched a GitHub author to a person",
  "provider_api_key.mapped": "Matched an API key to a person",
  "tools.detected_plan_applied": "Applied a detected plan",
  "billing.seat_sync_failed": "Billing seat sync failed",
  "api_credit_pool.created": "Added API credits",
  "api_credit_pool.updated": "Changed API credits",
  "api_credit_pool.archived": "Removed API credits",
  "sync_request.create": "Asked machines to sync",
  "sync_request.stale_auto": "Re-synced stale machines",
  "sync_request.features_github": "Synced GitHub work",
  "work_session.raw_trace_viewed": "Viewed a raw work trace",
  "collection_notice.acknowledged": "Read the collection notice",
  "legal.accepted": "Accepted the terms",
  "retention.usage_purged": "Deleted usage past retention",
  "signals_policy.updated": "Changed Signals policy",
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function actorLabel(entry: AuditEntry) {
  if (entry.actor.type === "system") return "UseJunction";
  return entry.actor.name || entry.actor.email || "Former member";
}

function formatAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AuditLogClientScreen() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>("all");
  const query = useInfiniteQuery({
    queryKey: ["app", "audit", category],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (pageParam) params.set("cursor", pageParam);
      const search = params.toString();
      return appFetch<AuditPage>(`/api/app/audit${search ? `?${search}` : ""}`, signal);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (query.isError && !query.data) {
    return (
      <>
        <PageHeader title="Audit log." />
        <p className="text-sm text-muted-foreground">Only workspace owners and admins can read the audit log.</p>
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Audit log."
        description="Who changed access, seats, integrations, privacy and settings in this workspace. Kept for two years."
        actions={
          <ExportCsvButton
            name="audit-log"
            header={["Time (UTC)", "Who", "Email", "Action", "Event", "Target type", "Target"]}
            rows={() => entries.map((entry) => [entry.at, actorLabel(entry), entry.actor.email ?? "", actionLabel(entry.action), entry.action, entry.targetType ?? "", entry.targetLabel ?? entry.targetId ?? ""])}
            label="Export loaded"
          />
        }
      >
        <HubTabList
          items={CATEGORIES.map((item) => ({ id: item.id, label: item.label }))}
          value={category}
          onChange={(id) => setCategory(id as typeof category)}
          className="border-b border-border"
          aria-label="Audit categories"
        />
      </PageHeader>

      <Panel as="section" padded={false}>
        {!entries.length ? (
          <Empty className="min-h-0 gap-1 border-0 px-5 py-8 md:px-5 md:py-8">
            <EmptyDescription>No events in this category yet.</EmptyDescription>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border/70 bg-muted/25 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Who</th>
                  <th className="px-3 py-2.5 font-medium">What</th>
                  <th className="px-5 py-2.5 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60 align-top last:border-b-0">
                    <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums text-muted-foreground">{formatAt(entry.at)}</td>
                    <td className="px-3 py-3">
                      <span className="block text-sm">{actorLabel(entry)}</span>
                      {entry.actor.email && entry.actor.name ? <span className="block text-xs text-muted-foreground">{entry.actor.email}</span> : null}
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-sm">{actionLabel(entry.action)}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{entry.action}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {entry.targetLabel ?? (entry.targetType ? `${entry.targetType.replace(/_/g, " ")}` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.hasNextPage ? (
          <div className="border-t px-5 py-3">
            <Button variant="outline" size="sm" className="rounded-none" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load older events"}
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
