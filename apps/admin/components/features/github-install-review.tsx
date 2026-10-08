"use client";

import type React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { IntegrationProviderMark } from "@/components/features/integration-provider-logos";
import { WorkSpendKpi, WorkSpendMeter, WORK_STATE_COLORS, WORK_STATE_LABELS } from "@/components/features/work-spend-ui";
import { WorkSpendPreview } from "@/components/features/work-spend-preview";
import { formatMicrosAsCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATES = ["shipped", "in_flight", "stalled"] as const;


type Installation = { id: string; login: string; accountType: string; linked?: boolean };

function installHrefFor(id: string) {
  return `/api/integrations/github/callback?installation_id=${encodeURIComponent(id)}`;
}

const secondaryClass = "inline-flex h-10 items-center gap-2 border bg-background px-3.5 text-sm font-medium hover:bg-accent";

function ComingSoon({ provider, label }: { provider: "linear" | "jira"; label: string }) {
  return (
    <span className={cn(secondaryClass, "cursor-default text-muted-foreground hover:bg-background")} aria-disabled="true">
      <IntegrationProviderMark provider={provider} size={14} className="opacity-60" />{label}<span className="bg-muted px-1.5 py-px text-[10px] uppercase tracking-[0.08em]">Soon</span>
    </span>
  );
}

/** The global `a { color: inherit }` rule is unlayered and beats Tailwind's text-white, so color is set inline. */
function BlackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{ color: "#fff" }}
      className="inline-flex h-10 items-center gap-2 bg-black px-4 text-sm font-medium transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
    </a>
  );
}

export function GithubInstallReview({
  installHref,
  installations = [],
  canManage = true,
  loading = false,
  loadError = null,
  onRetry,
  spendMicros = null,
  days = 30,
}: {
  installHref: string;
  installations?: Installation[];
  canManage?: boolean;
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  /** AI spend already collected in the period, used to make the pitch concrete. */
  spendMicros?: string | null;
  days?: number;
}) {
  const ready = installations.filter((install) => !install.linked);
  const spend = spendMicros && BigInt(spendMicros) > 0n ? formatMicrosAsCurrency(spendMicros) : null;

  return (
    <div className="min-w-0 pb-6">
      <PageHeader title="What did it produce?" />

      <Panel padded={false} className="grid min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="flex flex-col justify-center p-5 sm:p-7 xl:border-r">
          <h2 className="max-w-lg text-xl font-semibold leading-snug tracking-tight">
            {spend ? (
              <>Your team used <span className="tabular-nums">{spend}</span> of AI in the last {days} days. See what it went into.</>
            ) : (
              <>See which pull requests your AI spend went into.</>
            )}
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Connect GitHub and each pull request gets its share of the spend, split by whether it merged, is still open, or stalled.
          </p>

          <div className="mt-6">
            {!canManage ? (
              <p className="max-w-lg border-l-2 border-brand-yellow-dark bg-brand-yellow-pale px-3 py-2 text-sm leading-6">
                Ask a workspace owner or admin to connect GitHub.
              </p>
            ) : loading ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />Checking for an existing GitHub install…
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {ready.length ? ready.map((install, index) => index === 0 ? (
                    <BlackLink key={install.id} href={installHrefFor(install.id)}>
                      <IntegrationProviderMark provider="github" size={16} className="fill-white" />Connect {install.login}
                    </BlackLink>
                  ) : (
                    <a key={install.id} href={installHrefFor(install.id)} className={secondaryClass}>
                      <IntegrationProviderMark provider="github" size={16} />Connect {install.login}
                    </a>
                  )) : (
                    <BlackLink href={installHref}>
                      <IntegrationProviderMark provider="github" size={16} className="fill-white" />Connect GitHub
                    </BlackLink>
                  )}
                  <ComingSoon provider="linear" label="Linear" />
                  <ComingSoon provider="jira" label="Jira" />
                </div>
                {loadError ? (
                  <p role="alert" className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                    <span>
                      Couldn&apos;t check for an existing install ({loadError}). You can still continue to GitHub.
                      {onRetry ? <button type="button" className="ml-1 underline underline-offset-4" onClick={onRetry}>Try again</button> : null}
                    </span>
                  </p>
                ) : null}
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Includes GitHub Projects. Read-only metadata, never your source code or prompts.
              {ready.length && canManage && !loading ? <> <a href={installHref} className="underline underline-offset-4 hover:text-foreground">Install on another GitHub account</a></> : null}
            </p>
          </div>
        </section>

        <section aria-label="Where the work stands" className="relative grid min-h-[16rem] grid-cols-2 grid-rows-2 border-t xl:border-t-0">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-[1] w-px -translate-x-1/2 bg-border" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-px -translate-y-1/2 bg-border" />
          <WorkSpendKpi
            label="AI spend"
            value={spend ?? "$0.00"}
            hero
            accent
            compactMobile
            className="h-full px-3 sm:px-4"
            sub={`Last ${days} days · not linked to work`}
          />
          {STATES.map((state) => (
            <WorkSpendKpi
              key={state}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0" style={{ background: WORK_STATE_COLORS[state] }} aria-hidden />
                  {WORK_STATE_LABELS[state]}
                </span>
              }
              value={<span className="text-muted-foreground/50">—</span>}
              compactMobile
              className="h-full px-3 sm:px-4"
              sub="Needs GitHub"
              footer={<WorkSpendMeter size="sm" value={0} color={WORK_STATE_COLORS[state]} label={`${WORK_STATE_LABELS[state]} share of spend on work`} />}
            />
          ))}
        </section>
      </Panel>

      <WorkSpendPreview />
    </div>
  );
}
