"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Expand, Mail } from "lucide-react";
import { Ghost } from "@/components/empty-states/ghost";
import { Panel } from "@/components/panel";
import { SignalsSectionHeader } from "@/components/signals/signals-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AudienceScope } from "@/lib/audience-scope";
import { useAppQuery } from "@/lib/api/client";
import { activityReportsInlineKey } from "@/lib/app-pages/query-keys";
import type { SentReportKindFilter, SentReportListItem } from "@/lib/reports/sent-reports";

type ReportsListResponse = {
  audience: AudienceScope;
  items: SentReportListItem[];
  total: number;
  limit: number;
  offset: number;
};

type ReportPreviewResponse = {
  id: string;
  subject: string;
  html: string;
  sentAt: string;
  recipientEmail: string;
  recipientName: string | null;
};

function kindBadge(item: SentReportListItem) {
  if (item.kind === "personal") return "You · daily";
  return item.period === "week" ? "Team · weekly" : "Team · daily";
}

function formatSentAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const INLINE_LIMIT = 10;

/** Wide enough to show the email side by side with the list; below this the preview collapses to a banner. */
const SPLIT_QUERY = "(min-width: 1024px)";

function ReportEmailFrame({ html, title, className }: { html: string; title: string; className?: string }) {
  return (
    <div className="overflow-hidden border border-border bg-[#f3f2ee]">
      <iframe
        title={title}
        srcDoc={html}
        className={cn("h-[min(520px,55vh)] w-full border-0 bg-[#f3f2ee]", className)}
        sandbox=""
      />
    </div>
  );
}

/** The shape of a digest email (logo, greeting, weekly bars, stat tiles) while its HTML loads. */
function EmailSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("overflow-hidden border border-border bg-[#f3f2ee] px-4 pt-6 sm:px-10", className)}
    >
      <div className="mx-auto flex max-w-[560px] flex-col gap-5 bg-card px-6 py-6 sm:px-10 sm:py-8">
        <Skeleton className="h-6 w-32 rounded-sm" />
        <Skeleton className="h-8 w-3/5 rounded-sm" />
        <Skeleton className="h-4 w-2/5 rounded-sm" />
        <div className="mt-2 flex h-20 items-end gap-2">
          {[35, 80, 55, 20, 20, 20, 20].map((height, index) => (
            <Skeleton key={index} className="flex-1 rounded-sm" style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-16 rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportRowSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-44 rounded-sm" />
        <Skeleton className="h-5 w-16 rounded-sm" />
      </div>
      <Skeleton className="h-3 w-28 rounded-sm" />
    </div>
  );
}

function ReportRowsSkeleton({ count }: { count: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: count }, (_, index) => (
        <ReportRowSkeleton key={index} />
      ))}
    </div>
  );
}

/** Mirrors the loaded split view so nothing jumps when reports arrive. */
function SentReportsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading sent reports"
      className="border-t border-border/70 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start"
    >
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 lg:border-r lg:border-b-0">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-56 rounded-sm" />
            <Skeleton className="h-5 w-16 rounded-sm" />
          </div>
          <Skeleton className="h-3 w-40 rounded-sm" />
        </div>
        <EmailSkeleton className="h-36 lg:h-[min(520px,60vh)]" />
      </div>
      <ReportRowsSkeleton count={6} />
    </div>
  );
}

/**
 * The selected report, opened inline. Side by side with the list on wide screens; on narrow
 * screens it is a short banner cropped to the top of the email that taps open to full screen.
 */
function InlineReportPreview({
  item,
  preview,
  pending,
  onExpand,
}: {
  item: SentReportListItem;
  preview: ReportPreviewResponse | null;
  pending: boolean;
  onExpand: () => void;
}) {
  return (
    <div className="relative flex flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{preview?.subject ?? (item.label || item.subject)}</span>
            <Badge variant="secondary" className="font-normal">
              {kindBadge(item)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {preview ? `To ${preview.recipientName ?? preview.recipientEmail} · ` : ""}
            {formatSentAt(item.sentAt)}
          </p>
        </div>
        <Expand className="mt-0.5 size-4 shrink-0 text-muted-foreground lg:hidden" aria-hidden />
      </div>

      <div className="relative">
        {preview ? (
          <ReportEmailFrame
            html={preview.html}
            title={preview.subject}
            className="pointer-events-none h-36 lg:pointer-events-auto lg:h-[min(520px,60vh)]"
          />
        ) : (
          pending ? (
            <EmailSkeleton className="h-36 lg:h-[min(520px,60vh)]" />
          ) : (
            <div className="flex h-36 items-center justify-center border border-border bg-[#f3f2ee] text-sm text-muted-foreground lg:h-[min(520px,60vh)]">
              Preview unavailable.
            </div>
          )
        )}
        <div className="pointer-events-none absolute inset-x-px bottom-px h-14 bg-gradient-to-t from-[#f3f2ee] to-transparent lg:hidden" />
      </div>

      <button
        type="button"
        onClick={onExpand}
        className="absolute inset-0 lg:hidden"
        aria-label={`Open ${item.label || item.subject}`}
      />
    </div>
  );
}

function ReportRow({
  item,
  active,
  onSelect,
}: {
  item: SentReportListItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition last:border-b-0 hover:bg-muted/40",
        active && "bg-muted/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{item.label || item.subject}</span>
        <Badge variant="secondary" className="font-normal">
          {kindBadge(item)}
        </Badge>
      </div>
      <span className="text-xs text-muted-foreground">{formatSentAt(item.sentAt)}</span>
    </button>
  );
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Made-up recent sends, drawn faded while nothing has been sent, so the list's shape is visible. */
function sampleReports(audience: AudienceScope): SentReportListItem[] {
  const base = { status: "sent", recipientName: null, recipientEmail: "", subject: "" };
  const at = (days: number) => `${isoDaysAgo(days)}T08:00:00.000Z`;
  if (audience === "you") {
    return [1, 2, 3, 4, 5].map((days) => ({
      ...base, id: `sample-${days}`, kind: "personal", period: "day", localDate: isoDaysAgo(days), sentAt: at(days - 1), label: `Your day · ${isoDaysAgo(days)}`,
    }));
  }
  return [
    { ...base, id: "sample-1", kind: "org", period: "day", localDate: isoDaysAgo(1), sentAt: at(0), label: `Team day · ${isoDaysAgo(1)}` },
    { ...base, id: "sample-2", kind: "personal", period: "day", localDate: isoDaysAgo(1), sentAt: at(0), label: `Your day · ${isoDaysAgo(1)}` },
    { ...base, id: "sample-3", kind: "org", period: "week", localDate: isoDaysAgo(2), sentAt: at(1), label: `Team week · ${isoDaysAgo(8)} – ${isoDaysAgo(2)}` },
    { ...base, id: "sample-4", kind: "org", period: "day", localDate: isoDaysAgo(2), sentAt: at(1), label: `Team day · ${isoDaysAgo(2)}` },
    { ...base, id: "sample-5", kind: "personal", period: "day", localDate: isoDaysAgo(2), sentAt: at(1), label: `Your day · ${isoDaysAgo(2)}` },
  ];
}

function EmptyReports({ audience }: { audience: AudienceScope }) {
  const sample = useAppQuery<{ subject: string; html: string }>(
    ["app", "activity", "reports", "sample", audience],
    `/api/app/activity/reports/sample?scope=${audience}`,
  );
  const samples = sampleReports(audience);
  const featured = samples.find((item) => (audience === "team" ? item.period === "week" : true)) ?? samples[0];

  return (
    <div className="relative border-t border-border/70">
      <div className="lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <Ghost className="flex flex-col gap-3 border-b border-border/70 p-4 opacity-70 lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{sample.data?.subject ?? featured.label}</span>
            <Badge variant="secondary" className="font-normal">
              {kindBadge(featured)}
            </Badge>
            <Badge variant="outline" className="font-normal">
              Sample
            </Badge>
          </div>
          {sample.data ? (
            <ReportEmailFrame
              html={sample.data.html}
              title="Sample report"
              className="h-36 lg:h-[min(520px,60vh)]"
            />
          ) : (
            <EmailSkeleton className="h-36 lg:h-[min(520px,60vh)]" />
          )}
        </Ghost>
        <Ghost fade className="divide-y">
          {samples.map((item) => (
            <ReportRow key={item.id} item={item} active={item.id === featured.id} onSelect={() => {}} />
          ))}
        </Ghost>
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <div className="flex max-w-sm flex-col items-center gap-2 border bg-card px-6 py-5 text-center shadow-sm">
          <Mail className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No reports sent yet.</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {audience === "team"
              ? "Daily and weekly digests land here once machines report usage. Behind this is a sample of the weekly team email."
              : "Your daily usage email lands here once your machine reports. Behind this is a sample of what it looks like."}
          </p>
          <Link href="/settings#email-reports" className="mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline">
            Email schedule <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function SentReportsSection({ audience, title = "Reports." }: { audience: AudienceScope; title?: string }) {
  const searchParams = useSearchParams();
  const deepDate = searchParams.get("date");
  const deepPeriod = searchParams.get("period");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<SentReportKindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [inlineSelectedId, setInlineSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const scopeParam = audience === "you" ? "scope=you" : "scope=team";
  const listBase = `/api/app/activity/reports?${scopeParam}`;

  const inlineQuery = useAppQuery<ReportsListResponse>(
    activityReportsInlineKey(audience),
    `${listBase}&limit=${INLINE_LIMIT}&offset=0&kind=all`,
  );

  const dialogQuery = useAppQuery<ReportsListResponse>(
    ["app", "activity", "reports", audience, "dialog", dialogKind],
    `${listBase}&limit=50&offset=0&kind=${dialogKind}`,
    { enabled: dialogOpen },
  );

  const dialogItems = dialogQuery.data?.items ?? [];
  const effectiveSelectedId = selectedId ?? dialogItems[0]?.id ?? null;

  const previewQuery = useAppQuery<ReportPreviewResponse>(
    ["app", "activity", "reports", "preview", effectiveSelectedId, audience],
    effectiveSelectedId
      ? `/api/app/activity/reports/${effectiveSelectedId}?${scopeParam}`
      : "/api/app/activity/reports/__idle__",
    { enabled: Boolean(effectiveSelectedId && dialogOpen) },
  );

  const items = inlineQuery.data?.items ?? [];
  const total = inlineQuery.data?.total ?? 0;
  const activeInline = items.find((item) => item.id === inlineSelectedId) ?? items[0] ?? null;

  // Same key as the dialog's preview, so a report opened inline is already cached in "View all".
  const inlinePreviewQuery = useAppQuery<ReportPreviewResponse>(
    ["app", "activity", "reports", "preview", activeInline?.id ?? null, audience],
    activeInline ? `/api/app/activity/reports/${activeInline.id}?${scopeParam}` : "/api/app/activity/reports/__idle__",
    { enabled: Boolean(activeInline) },
  );
  const inlinePreview =
    inlinePreviewQuery.data && inlinePreviewQuery.data.id === activeInline?.id ? inlinePreviewQuery.data : null;
  const description =
    audience === "team"
      ? "Team and personal digests sent to your inbox. Filter by kind, or switch to You for personal reports only."
      : "Daily usage emails sent to your inbox.";

  const filterKinds = useMemo(() => {
    if (audience === "team") return ["all", "org", "personal"] as SentReportKindFilter[];
    return ["all", "personal"] as SentReportKindFilter[];
  }, [audience]);

  const selectedPreview = useMemo(() => {
    if (previewQuery.data && previewQuery.data.id === effectiveSelectedId) return previewQuery.data;
    return null;
  }, [effectiveSelectedId, previewQuery.data]);

  // Deep link from email CTA: /reports?scope=…&date=…&period=…
  useEffect(() => {
    if (deepLinkHandled || !deepDate || inlineQuery.isPending) return;
    const match = (inlineQuery.data?.items ?? []).find((item) => {
      if (item.localDate !== deepDate) return false;
      if (deepPeriod === "week") return item.period === "week";
      if (deepPeriod === "day") return item.period === "day";
      return true;
    });
    if (!match && (inlineQuery.data?.items.length ?? 0) === 0) {
      setDeepLinkHandled(true);
      return;
    }
    if (match) {
      setInlineSelectedId(match.id);
      if (!window.matchMedia(SPLIT_QUERY).matches) setExpanded(true);
      setDeepLinkHandled(true);
    } else if (!inlineQuery.isPending) {
      // Date not in first page — still open dialog so user can browse.
      setDialogOpen(true);
      setDeepLinkHandled(true);
    }
  }, [deepDate, deepPeriod, deepLinkHandled, inlineQuery.data, inlineQuery.isPending]);

  function openDialog() {
    setDialogKind("all");
    setSelectedId(items[0]?.id ?? null);
    setDialogOpen(true);
  }

  function selectInline(item: SentReportListItem) {
    setInlineSelectedId(item.id);
    // Narrow screens have no room beside the list, so a tap goes straight to the full email.
    if (!window.matchMedia(SPLIT_QUERY).matches) setExpanded(true);
  }

  return (
    <Panel as="section" className="mt-10" id="reports">
      <SignalsSectionHeader
        title={title}
        description={description}
        bordered={false}
        action={
          total > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={openDialog}>
              {total > INLINE_LIMIT ? `View all (${total})` : "View all"}
            </Button>
          ) : null
        }
      />

      {inlineQuery.isPending ? (
        <SentReportsSkeleton />
      ) : items.length === 0 ? (
        <EmptyReports audience={audience} />
      ) : (
        <div className="border-t border-border/70 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
          {activeInline ? (
            <div className="border-b border-border/70 lg:sticky lg:top-4 lg:border-r lg:border-b-0">
              <InlineReportPreview
                item={activeInline}
                preview={inlinePreview}
                pending={inlinePreviewQuery.isPending}
                onExpand={() => setExpanded(true)}
              />
            </div>
          ) : null}
          <div className="divide-y">
            {items.map((item) => (
              <ReportRow
                key={item.id}
                item={item}
                active={item.id === activeInline?.id}
                onSelect={() => selectInline(item)}
              />
            ))}
          </div>
        </div>
      )}

      <Dialog open={expanded && Boolean(activeInline)} onOpenChange={setExpanded}>
        <DialogContent className="top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 border-0 p-0 sm:max-w-none sm:p-0">
          <DialogHeader className="border-b px-4 py-3 pr-12 text-left">
            <DialogTitle className="truncate text-sm">
              {inlinePreview?.subject ?? activeInline?.label ?? "Report"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {inlinePreview ? `To ${inlinePreview.recipientName ?? inlinePreview.recipientEmail} · ` : ""}
              {activeInline ? formatSentAt(activeInline.sentAt) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-[#f3f2ee]">
            {inlinePreview ? (
              <iframe title={inlinePreview.subject} srcDoc={inlinePreview.html} className="size-full border-0" sandbox="" />
            ) : inlinePreviewQuery.isPending ? (
              <EmailSkeleton className="size-full border-0" />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Preview unavailable.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex min-h-[min(70vh,640px)] max-h-[min(90vh,900px)] w-[min(96vw,1100px)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>Sent reports</DialogTitle>
            <DialogDescription>{description} Select a row to preview the exact email.</DialogDescription>
            <div className="mt-3 flex flex-wrap gap-2">
              {filterKinds.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={dialogKind === kind ? "default" : "outline"}
                  onClick={() => {
                    setDialogKind(kind);
                    setSelectedId(null);
                  }}
                >
                  {kind === "all" ? "All" : kind === "personal" ? "You" : "Team"}
                </Button>
              ))}
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            <div className="min-h-[min(55vh,520px)] max-h-[min(70vh,640px)] overflow-y-auto border-b lg:border-b-0 lg:border-r">
              {dialogQuery.isPending ? (
                <ReportRowsSkeleton count={8} />
              ) : dialogItems.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">No reports match this filter.</p>
              ) : (
                dialogItems.map((item) => (
                  <ReportRow
                    key={item.id}
                    item={item}
                    active={item.id === effectiveSelectedId}
                    onSelect={() => setSelectedId(item.id)}
                  />
                ))
              )}
            </div>

            <div className="flex min-h-[min(55vh,520px)] max-h-[min(70vh,640px)] flex-col overflow-y-auto p-4">
              {previewQuery.isPending ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-64 rounded-sm" />
                  <Skeleton className="mb-1 h-3 w-48 rounded-sm" />
                  <EmailSkeleton className="h-[min(520px,55vh)]" />
                </div>
              ) : selectedPreview ? (
                <>
                  <p className="mb-3 text-sm font-medium">{selectedPreview.subject}</p>
                  <p className="mb-4 text-xs text-muted-foreground">
                    To {selectedPreview.recipientName ?? selectedPreview.recipientEmail} ·{" "}
                    {formatSentAt(selectedPreview.sentAt)}
                  </p>
                  <ReportEmailFrame html={selectedPreview.html} title={selectedPreview.subject} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a report to preview the email.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
