"use client";

import { ArrowRight, ArrowUpRight, Unplug } from "lucide-react";
import { IntegrationProviderMark } from "@/components/features/integration-provider-logos";
import { Button } from "@/components/ui/button";
import type { GitHubConnectionView } from "@/lib/integrations/github-connections";
import { cn } from "@/lib/utils";

function statusLabel(connection: GitHubConnectionView) {
  if (connection.state === "permission_required") return "Permissions needed";
  if (connection.state === "syncing") return "Syncing";
  if (connection.state === "partial" || connection.lastError) return "Needs attention";
  return "Connected";
}

function statusDot(connection: GitHubConnectionView) {
  if (connection.state === "permission_required" || connection.state === "partial" || connection.lastError) return "bg-amber-500";
  if (connection.state === "syncing") return "bg-sky-500";
  return "bg-primary";
}

export function GitHubAccountsList({
  connections,
  canManage,
  installHref,
  availableInstalls = [],
  onDisconnect,
}: {
  connections: GitHubConnectionView[];
  canManage: boolean;
  installHref: string;
  availableInstalls?: Array<{ id: string; login: string; accountType: string; linked?: boolean }>;
  onDisconnect: (connection: GitHubConnectionView) => void;
}) {
  const addable = availableInstalls.filter((install) => !install.linked);
  return (
    <div className="space-y-3">
      <ul className="divide-y border">
        {connections.map((connection) => (
          <li key={connection.id} className="p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex size-8 shrink-0 items-center justify-center border border-border/50 bg-white" aria-hidden>
                <IntegrationProviderMark provider="github" size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  <span className="truncate">{connection.githubOrg || "GitHub"}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    <span className={cn("size-1.5 shrink-0", statusDot(connection))} aria-hidden />
                    {statusLabel(connection)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {connection.accountType === "User" ? "Personal account" : "Organization"}
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  {connection.approveUrl ? (
                    <Button asChild size="sm" variant="outline" className="rounded-none">
                      <a href={connection.approveUrl} target="_blank" rel="noreferrer">Manage access <ArrowUpRight className="size-4" aria-hidden /></a>
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" className="rounded-none text-destructive" aria-label={`Disconnect ${connection.githubOrg || "GitHub"}…`} onClick={() => onDisconnect(connection)}>
                    <Unplug className="size-4" aria-hidden />Disconnect
                  </Button>
                </div>
              ) : null}
            </div>
            {connection.lastError ? <p role="alert" className="mt-2 break-words text-sm text-destructive">{connection.lastError}</p> : null}
            {connection.state === "permission_required" ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {connection.needsMembers
                  ? "Read-only member access is needed to match authors."
                  : "Read-only contents and pull-request access is needed to sync work."}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="space-y-2">
          <Button asChild size="sm" variant="outline" className="rounded-none">
            <a href={installHref}><span className="flex size-5 items-center justify-center border border-border/50 bg-white" aria-hidden><IntegrationProviderMark provider="github" size={12} /></span>Connect another GitHub account<ArrowRight className="size-4" aria-hidden /></a>
          </Button>
          {addable.length > 0 ? (
            <ul className="divide-y border">
              {addable.map((install) => (
                <li key={install.id}>
                  <Button asChild variant="ghost" size="sm" className="h-auto min-h-10 w-full justify-between gap-3 rounded-none py-2">
                    <a href={`/api/integrations/github/callback?installation_id=${encodeURIComponent(install.id)}`}>
                      <span className="truncate">{install.login}</span>
                      <span className="text-xs text-muted-foreground">{install.accountType}</span>
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">A workspace admin can connect or disconnect GitHub accounts.</p>
      )}
    </div>
  );
}
