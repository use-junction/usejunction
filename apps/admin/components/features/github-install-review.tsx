"use client";

import { AlertCircle, ArrowRight, Check, Database, Github, GitPullRequest, Loader2, Lock, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { ProjectToolConnectDialog } from "@/components/features/project-tool-connect-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

const PERMISSIONS = [
  "Read repository contents to sync commit metadata and default-branch history. Source files are not stored.",
  "Read pull requests for associated commit context.",
  "Read organization members to identify eligible authors.",
  "Read organization Projects when you choose Projects to connect. Only issue and pull-request titles, status, and links from granted repositories are imported.",
  "Read repository metadata to list the repositories you allow.",
];

const DATA_POINTS = [
  "We keep commit messages, authors, ticket keys, and timestamps in your workspace.",
  "Selected GitHub Projects add linked item titles, status, and links; descriptions are not imported.",
  "We allocate already-collected AI usage cost onto commits. We do not pull Copilot billing from a personal GitHub account.",
  "Outside GitHub org contributors remain in git history but are not listed as authors and do not receive cost.",
  "We do not store source code, file contents, keystrokes, or raw prompts.",
  "Disconnecting unlinks this workspace. You can uninstall the GitHub App separately in GitHub settings.",
];

type Installation = { id: string; login: string; accountType: string; linked?: boolean };

export function GithubInstallReview({
  installHref,
  installations = [],
  canManage = true,
  loading = false,
  loadError = null,
  onRetry,
}: {
  installHref: string;
  installations?: Installation[];
  canManage?: boolean;
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="min-w-0 pb-6">
      <PageHeader
        title="What did it produce?"
        actions={<ProjectToolConnectDialog />}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel padded={false} className="overflow-hidden">
            <div className="border-b bg-primary/5 p-5 sm:p-7">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                  <Github className="size-6" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-semibold">GitHub</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Your code, connected to your costs</p>
                </div>
              </div>
              <h2 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">Understand the cost of shipped work.</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Connect your repositories to see shipped work and allocated AI cost across your team. Ticket keys connect related changes.
              </p>
              {canManage ? (
                <Button asChild className="mt-5 w-full sm:w-auto">
                  <a href={installHref}><Github className="size-4" aria-hidden />Connect GitHub<ArrowRight className="size-4" aria-hidden /></a>
                </Button>
              ) : (
                <p className="mt-5 border border-primary/20 bg-background p-3 text-sm leading-6">Ask a workspace owner or admin to connect GitHub.</p>
              )}
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5 shrink-0" aria-hidden />Read-only access · You choose the repositories</p>
            </div>
            <div className="p-5 sm:p-7">
              <h3 className="text-sm font-semibold">What happens next</h3>
              <ol className="mt-4 space-y-4">
                {[
                  ["Choose your repositories", "Approve the GitHub App for the account and repositories you want to include."],
                  ["Match your team", "Link GitHub authors to workspace members so their AI usage can be allocated."],
                  ["Explore work and spend", "Review every granted repository, with verified and estimated costs kept separate."],
                ].map(([title, description], index) => (
                  <li key={title} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">{index + 1}</span>
                    <div><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-sm leading-6 text-muted-foreground">{description}</p></div>
                  </li>
                ))}
              </ol>
            </div>
          </Panel>

          {canManage && loading ? (
            <Panel role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />Checking existing GitHub installations…
            </Panel>
          ) : canManage && loadError ? (
            <Panel role="alert">
              <div className="flex items-start gap-2 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /><p>{loadError}</p></div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">You can still continue to GitHub to choose an account and repositories.</p>
              {onRetry ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button> : null}
            </Panel>
          ) : canManage && installations.length > 0 ? (
            <Panel as="section">
              <h2 className="text-sm font-semibold">Already installed on GitHub</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Connect an existing installation to this workspace.</p>
              <ul className="mt-4 space-y-2">
                {installations.filter((install) => !install.linked).map((install) => (
                  <li key={install.id}>
                    <Button asChild variant="outline" className="h-auto min-h-12 w-full justify-between gap-3 py-3">
                      <a href={`/api/integrations/github/callback?installation_id=${encodeURIComponent(install.id)}`}>
                        <span className="flex min-w-0 items-center gap-2"><Github className="size-4 shrink-0" aria-hidden /><span className="truncate">{install.login}</span></span>
                        <span className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{install.accountType}</span><ArrowRight className="size-4" aria-hidden /></span>
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          <Panel as="section">
            <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" aria-hidden /><h2 className="text-sm font-semibold">Your code stays yours</h2></div>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              {["Read-only. We never change your repositories.", "No source code or raw prompts stored.", "Disconnect from this workspace anytime."].map((item) => (
                <li key={item} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><span className="leading-5">{item}</span></li>
              ))}
            </ul>
          </Panel>

          <Accordion type="multiple" className="border bg-card px-5">
            <AccordionItem value="permissions">
              <AccordionTrigger className="py-4 hover:no-underline"><span className="flex items-center gap-2 text-sm"><Lock className="size-4 text-muted-foreground" aria-hidden />Permissions we request</span></AccordionTrigger>
              <AccordionContent className="pb-5">
                <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">{PERMISSIONS.map((item) => <li key={item}>{item}</li>)}</ul>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="data" className="border-b-0">
              <AccordionTrigger className="py-4 hover:no-underline"><span className="flex items-center gap-2 text-sm"><Database className="size-4 text-muted-foreground" aria-hidden />How your data is used</span></AccordionTrigger>
              <AccordionContent className="pb-5">
                <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">{DATA_POINTS.map((item) => <li key={item}>{item}</li>)}</ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex items-start gap-2 px-1 text-sm leading-6 text-muted-foreground">
            <GitPullRequest className="mt-1 size-4 shrink-0" aria-hidden />
            <p>GitHub returns you here after installation. Your organization may require an owner or admin to approve access.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
