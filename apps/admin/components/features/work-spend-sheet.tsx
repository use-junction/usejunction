"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { appFetch } from "@/lib/api/client";
import { formatMicrosAsCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { WorkDetailsPage, WorkFeedItem } from "./work-spend-types";

const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const money = formatMicrosAsCurrency;

export function WorkSpendSheet({ item, days, allocationCurrent, onClose, onReturnFocus }: { item: WorkFeedItem | null; days: number; allocationCurrent: boolean; onClose: () => void; onReturnFocus: () => void }) {
  return <Sheet open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }} className="gap-0 sm:w-[38rem] sm:max-w-[38rem]">
      {item ? <WorkDetails key={`${item.id}:${days}`} item={item} days={days} allocationCurrent={allocationCurrent} /> : null}
    </SheetContent>
  </Sheet>;
}

function WorkDetails({ item, days, allocationCurrent }: { item: WorkFeedItem; days: number; allocationCurrent: boolean }) {
  const [page, setPage] = useState<WorkDetailsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"commits" | "evidence" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams({ repositoryId: item.repository.id, kind: item.kind, workId: item.workId, days: String(days) });
  const url = `/api/app/work-spend/work/details?${params}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void appFetch<WorkDetailsPage>(url, controller.signal).then(setPage)
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Couldn’t load work details."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, attempt]);

  async function loadMore(kind: "commits" | "evidence") {
    const cursor = kind === "commits" ? page?.nextCursor : page?.evidenceNextCursor;
    if (!cursor || busy) return;
    setBusy(kind); setError(null);
    try {
      const result = await appFetch<WorkDetailsPage>(`${url}&${kind === "commits" ? "cursor" : "evidenceCursor"}=${encodeURIComponent(cursor)}`);
      setPage((current) => current ? kind === "commits"
        ? { ...current, commits: [...current.commits, ...result.commits], nextCursor: result.nextCursor }
        : { ...current, evidence: [...current.evidence, ...result.evidence], evidenceNextCursor: result.evidenceNextCursor } : result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t load more details."); }
    finally { setBusy(null); }
  }

  return <>
    <SheetHeader className="border-b p-5 pr-12">
      <p className="text-xs text-muted-foreground">{item.repository.fullName}{item.ticketKey ? ` · ${item.ticketKey}` : ""}</p>
      <SheetTitle className="break-words text-xl leading-7">{item.title}</SheetTitle>
      <SheetDescription>{item.kind === "ticket" ? "Ticketed work" : item.kind === "pull_request" ? "Pull request" : "Commit"}{item.kind === "pull_request" && item.state ? ` · ${item.state.toLowerCase().replaceAll("_", " ")}` : ""} · {dateLabel(item.activityAt)}</SheetDescription>
      {item.url ? <a className="mt-1 inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4" href={item.url} target="_blank" rel="noreferrer">Open on GitHub <ArrowUpRight className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span></a> : null}
    </SheetHeader>
    <div className="space-y-6 p-5">
      {allocationCurrent ? <section aria-label="Allocated cost"><h3 className="text-sm font-semibold">Allocated cost</h3><dl className="mt-3 grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">Verified</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(item.verifiedMicros)}</dd></div><div><dt className="text-xs text-muted-foreground">Estimated</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(item.estimatedMicros)}</dd></div></dl><p className="mt-3 text-xs leading-5 text-muted-foreground">AI usage assigned to this work during the selected {days} days. Verified describes the source usage, not a measured bill for this work. Usage is split across matched commits on each UTC day.</p></section> : <p className="text-sm text-muted-foreground">Cost allocations need refreshing. Close this sheet and sync GitHub to update them.</p>}
      {item.projectLinks.length ? <section><h3 className="text-sm font-semibold">GitHub Projects</h3><ul className="mt-2 divide-y">{item.projectLinks.map((link) => <li key={`${link.projectId}:${link.url}`} className="py-2.5"><div className="flex items-start justify-between gap-3"><a href={link.projectUrl} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">{link.projectTitle} ↗</a>{link.status ? <span className="shrink-0 bg-muted px-2 py-0.5 text-xs">{link.status}</span> : null}</div><a href={link.url} target="_blank" rel="noreferrer" className="mt-1 block break-words text-sm text-muted-foreground hover:underline">{link.title} ↗</a></li>)}</ul></section> : <section><h3 className="text-sm font-semibold">GitHub Projects</h3><p className="mt-2 text-sm text-muted-foreground">Not on a project.</p></section>}
      {item.pullRequests?.length ? <section><h3 className="text-sm font-semibold">Related pull requests</h3><ul className="mt-2 divide-y">{item.pullRequests.map((pr) => <li key={pr.id} className="flex items-start justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 break-words">{pr.url ? <a href={pr.url} target="_blank" rel="noreferrer" className="hover:underline">{pr.title} ↗</a> : pr.title}</span><span className="shrink-0 text-xs text-muted-foreground">{pr.state?.toLowerCase()}</span></li>)}</ul></section> : null}
      {loading ? <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading commits and cost details…</p> : null}
      {error ? <div role="alert" className="text-sm text-destructive">{error}{!page ? <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button> : null}</div> : null}
      {page ? <>
        <section><h3 className="text-sm font-semibold">Commits</h3>{page.commits.length ? <ul className="mt-2 divide-y">{page.commits.map((commit) => <li key={commit.id} className="py-3"><p className="break-words text-sm">{commit.url ? <a href={commit.url} target="_blank" rel="noreferrer" className="hover:underline">{commit.title} ↗</a> : commit.title}</p><p className="mt-1 text-xs text-muted-foreground"><code>{commit.sha.slice(0, 7)}</code>{commit.authorLogin ? ` · @${commit.authorLogin}` : ""} · {dateLabel(commit.activityAt)}</p></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No commits assigned to this work in the selected period.</p>}{page.nextCursor ? <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void loadMore("commits")}>{busy === "commits" ? "Loading…" : "More commits"}</Button> : null}</section>
        {allocationCurrent ? <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-semibold">How this cost was allocated</summary>{item.ticketSource ? <p className="mt-3 text-xs text-muted-foreground">Ticket key from {item.ticketSource.replaceAll("_", " ")}.</p> : null}{page.evidence.length ? <ul className="mt-2 divide-y">{page.evidence.map((row, index) => <li key={`${row.date}:${row.developerName}:${row.costKind}:${index}`} className="py-3"><div className="flex justify-between gap-3 text-sm"><span>{row.developerName}</span><strong className="font-medium tabular-nums">{money(row.costMicros)}</strong></div><p className="mt-1 text-xs text-muted-foreground">{dateLabel(row.date)} · {row.costKind === "verified_usage" ? "Verified" : "Estimated"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{["commit_split", "commit_weight"].includes(row.method) ? "Split by commit count" : row.method.replaceAll("_", " ")} · weight {row.weight} {row.weight === 1 ? "commit" : "commits"}{row.ticketSource ? ` · key from ${row.ticketSource.replaceAll("_", " ")}` : ""}</p></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No AI usage has been allocated to this work in this period.</p>}{page.evidenceNextCursor ? <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void loadMore("evidence")}>{busy === "evidence" ? "Loading…" : "More allocation details"}</Button> : null}</details> : null}
      </> : null}
    </div>
  </>;
}
