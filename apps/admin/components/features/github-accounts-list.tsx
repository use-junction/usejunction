"use client";

import { ArrowUpRight, Plus } from "lucide-react";
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

/** Heading row + action, shared by every section of the integrations dialog. */
export function IntegrationSectionHeader({ id, title, action }: { id: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

/** One settings row: provider mark, name, meta line, right-aligned actions. */
export function IntegrationRow({ title, href, meta, actions, children, className }: { title: React.ReactNode; href?: string; meta?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <li className={cn("px-3 py-2.5", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IntegrationProviderMark provider="github" size={20} className="shrink-0" />
        <div className="min-w-40 flex-1">
          <p className="truncate text-sm font-medium">{href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 hover:underline"><span className="truncate">{title}</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /></a> : title}</p>
          {meta ? <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">{meta}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </li>
  );
}

export function GitHubAccountsList({
  connections,
  canManage,
  installHref,
  availableInstalls = [],
  onDisconnect,
  heading = "GitHub accounts",
}: {
  connections: GitHubConnectionView[];
  canManage: boolean;
  installHref: string;
  availableInstalls?: Array<{ id: string; login: string; accountType: string; linked?: boolean }>;
  onDisconnect: (connection: GitHubConnectionView) => void;
  heading?: string;
}) {
  const addable = canManage ? availableInstalls.filter((install) => !install.linked) : [];
  return (
    <section className="space-y-2" aria-labelledby="github-accounts-heading">
      <IntegrationSectionHeader
        id="github-accounts-heading"
        title={heading}
        action={canManage ? (
          <Button asChild size="sm" variant="outline" className="rounded-none border-primary/25 bg-primary/10 shadow-none hover:bg-primary/15">
            <a href={installHref}><Plus className="size-4" aria-hidden />Connect account</a>
          </Button>
        ) : null}
      />
      <ul className="divide-y border">
        {connections.map((connection) => (
          <IntegrationRow
            key={connection.id}
            title={connection.githubOrg || "GitHub"}
            meta={<>
              <span>{connection.accountType === "User" ? "Personal account" : "Organization"}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("size-1.5 shrink-0", statusDot(connection))} aria-hidden />
                {statusLabel(connection)}
              </span>
            </>}
            actions={canManage ? <>
              {connection.approveUrl ? (
                <Button asChild size="sm" variant="outline" className="rounded-none">
                  <a href={connection.approveUrl} target="_blank" rel="noreferrer">Configure <ArrowUpRight className="size-3.5" aria-hidden /></a>
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="ghost" className="rounded-none text-muted-foreground hover:text-destructive" aria-label={`Disconnect ${connection.githubOrg || "GitHub"}…`} onClick={() => onDisconnect(connection)}>
                Disconnect
              </Button>
            </> : null}
          >
            {connection.lastError ? <p role="alert" className="mt-2 break-words pl-8 text-sm text-destructive">{connection.lastError}</p> : null}
            {connection.state === "permission_required" ? (
              <p className="mt-2 pl-8 text-sm text-muted-foreground">
                {connection.needsMembers
                  ? "Read-only member access is needed to match authors."
                  : "Read-only contents and pull-request access is needed to sync work."}
              </p>
            ) : null}
          </IntegrationRow>
        ))}
        {addable.map((install) => (
          <IntegrationRow
            key={install.id}
            title={install.login}
            meta={<><span>{install.accountType === "User" ? "Personal account" : "Organization"}</span><span aria-hidden>·</span><span>Installed on GitHub, not linked</span></>}
            actions={
              <Button asChild size="sm" variant="outline" className="rounded-none">
                <a href={`/api/integrations/github/callback?installation_id=${encodeURIComponent(install.id)}`}>Link</a>
              </Button>
            }
          />
        ))}
      </ul>
      {!canManage ? <p className="text-xs text-muted-foreground">A workspace admin can connect or disconnect GitHub accounts.</p> : null}
    </section>
  );
}
