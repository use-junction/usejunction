"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, GitCommitHorizontal, GitPullRequest, Info, Layers3, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { appFetch } from "@/lib/api/client";
import { formatMicrosAsCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkSpendSheet } from "./work-spend-sheet";
import type { WorkFeedItem, WorkFeedPage, WorkSpendPayload } from "./work-spend-types";

const money = formatMicrosAsCurrency;
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "—";
const typeLabel = (value: string) => value === "No recognized prefix" ? "Unclassified" : value;
const colors: Record<string, string> = { Features: "bg-brand-yellow-dark", Fixes: "bg-slate-600", Refactoring: "bg-stone-500", Tests: "bg-slate-400", Documentation: "bg-stone-400", Performance: "bg-emerald-700", "No recognized prefix": "bg-muted-foreground/25" };

function Cost({ verified, estimated, current = true }: { verified: string; estimated: string; current?: boolean }) {
  if (!current) return <span className="text-xs text-muted-foreground">Updating cost…</span>;
  const hasVerified = BigInt(verified) !== BigInt(0);
  const hasEstimated = BigInt(estimated) !== BigInt(0);
  if (!hasVerified && !hasEstimated) return <span className="text-xs text-muted-foreground">Not allocated</span>;
  return <div className="space-y-0.5 text-sm tabular-nums">
    <p className="font-medium">{money((BigInt(verified) + BigInt(estimated)).toString())}</p>
    <p className="text-xs text-muted-foreground">{money(verified)} verified · {money(estimated)} est.</p>
  </div>;
}

export function WorkSpendExplorer({ data }: { data: WorkSpendPayload }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryString = params.toString();
  const view = params.get("view") === "repositories" ? "repositories" : "work";
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "all";
  const projectId = params.get("projectId") ?? "all";
  const developerId = params.get("developerId");
  const sort = params.get("sort") === "cost" ? "cost" : "activity";
  const [search, setSearch] = useState(q);
  const [mixInfoOpen, setMixInfoOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<WorkFeedItem | null>(null);
  const activeRow = useRef<HTMLButtonElement | null>(null);

  const update = useCallback((values: Record<string, string | null>) => {
    const next = new URLSearchParams(queryString);
    for (const [key, value] of Object.entries(values)) { if (!value || value === "all" || (key === "view" && value === "work") || (key === "sort" && value === "activity")) next.delete(key); else next.set(key, value); }
    next.delete("cursor");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }, [pathname, queryString, router]);

  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => update({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [q, search, update]);

  const feedParams = new URLSearchParams({ days: String(data.days), sort });
  if (data.selectedRepositoryId) feedParams.set("repositoryId", data.selectedRepositoryId);
  if (projectId !== "all") feedParams.set("projectId", projectId);
  if (developerId && data.canViewPeople) feedParams.set("developerId", developerId);
  if (type !== "all") feedParams.set("type", type);
  if (q) feedParams.set("q", q);
  const feedUrl = `/api/app/work-spend/work?${feedParams}`;

  const feed = useInfiniteQuery({
    queryKey: ["app", "work-spend-feed", feedUrl],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => appFetch<WorkFeedPage>(`${feedUrl}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, signal),
    getNextPageParam: (page) => page.nextCursor,
    enabled: view === "work",
  });
  const page = feed.data ? { items: feed.data.pages.flatMap((page) => page.items), totalCount: feed.data.pages[0].totalCount, nextCursor: feed.data.pages.at(-1)?.nextCursor } : null;
  const loading = feed.isPending;
  const loadingMore = feed.isFetchingNextPage;
  const error = feed.error?.message;
  useEffect(() => { setSelected(null); }, [feedUrl, view]);

  const repositories = useMemo(() => data.repositories.filter((repo) => (!q || repo.fullName.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => {
    if (sort === "cost") { const left = BigInt(a.verifiedMicros) + BigInt(a.estimatedMicros); const right = BigInt(b.verifiedMicros) + BigInt(b.estimatedMicros); return left === right ? a.fullName.localeCompare(b.fullName) : left > right ? -1 : 1; }
    return (b.latestActivityAt ?? "").localeCompare(a.latestActivityAt ?? "") || a.fullName.localeCompare(b.fullName);
  }), [data.repositories, q, sort]);
  const totalChanges = data.changeMix.reduce((sum, part) => sum + part.count, 0);
  const classified = totalChanges - (data.changeMix.find((part) => part.type === "No recognized prefix")?.count ?? 0);
  const personName = developerId && data.canViewPeople
    ? data.attention.developers.find((developer) => developer.id === developerId)?.name ?? "This person"
    : null;
  const filterCount = Number(type !== "all") + Number(projectId !== "all") + Number(!!data.selectedRepositoryId) + Number(!!personName);
  const hasFilters = !!q || filterCount > 0;

  return <section aria-label="Explore work" className="min-w-0">
    <Tabs value={view} onValueChange={(value) => update({ view: value })} className="gap-0">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <TabsList variant="line" className="gap-4 p-0"><TabsTrigger value="work" className="rounded-none border-0 px-0">Work{page ? <span className="text-xs text-muted-foreground">{page.totalCount}</span> : null}</TabsTrigger><TabsTrigger value="repositories" className="rounded-none border-0 px-0">Repositories <span className="text-xs text-muted-foreground">{data.repositoryOptions.length}</span></TabsTrigger></TabsList>
        <p className="hidden text-xs text-muted-foreground sm:block">{view === "work" ? "Tickets, pull requests and standalone commits" : "Every repository granted to GitHub"}</p>
      </div>

      <div className="flex flex-wrap gap-2 py-3">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden /><Input value={search} onChange={(event) => setSearch(event.target.value)} type="search" aria-label={view === "work" ? "Search work" : "Search repositories"} placeholder={view === "work" ? "Search work, tickets or repositories…" : "Search repositories…"} className="h-10 pl-9 text-sm" /></div>
        <Button variant="outline" className="h-10 sm:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal className="size-4" />Filters{filterCount ? ` (${filterCount})` : ""}</Button>
        <div className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap gap-2 sm:flex sm:w-auto`}>
          {data.repositoryOptions.length > 1 ? <Select value={data.selectedRepositoryId ?? "all"} onValueChange={(value) => update({ repositoryId: value })}><SelectTrigger aria-label="Repository" className="h-10 w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All repositories</SelectItem>{data.repositoryOptions.map((repo) => <SelectItem key={repo.id} value={repo.id}>{repo.fullName}</SelectItem>)}</SelectContent></Select> : null}
          {data.projects.selected.length ? <Select value={projectId} onValueChange={(value) => update({ projectId: value })}><SelectTrigger aria-label="GitHub Project" className="h-10 w-full sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Projects</SelectItem><SelectItem value="__none__">Work without a Project</SelectItem>{data.projects.selected.map((project) => <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>)}</SelectContent></Select> : null}
          <Select value={sort} onValueChange={(value) => update({ sort: value })}><SelectTrigger aria-label="Sort work" className="h-10 w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="activity">Recent activity</SelectItem><SelectItem value="cost">Highest allocated cost</SelectItem></SelectContent></Select>
        </div>
      </div>

      {totalChanges > 0 && view === "work" ? <div className="mb-3" aria-label="Change mix">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">{data.changeMix.map((part) => <button key={part.type} type="button" aria-pressed={type === part.type} onClick={() => update({ type: type === part.type ? null : part.type })} className={`inline-flex min-h-7 items-center gap-1.5 text-xs underline-offset-4 focus-visible:outline focus-visible:outline-ring ${type === part.type ? "font-semibold underline" : "text-muted-foreground hover:text-foreground"}`}><span className={`size-1.5 shrink-0 ${colors[part.type] ?? "bg-slate-500"}`} aria-hidden />{typeLabel(part.type)} <span className="tabular-nums">{part.count}</span></button>)}<span className="inline-flex min-h-7 items-center gap-1 text-xs text-muted-foreground">{classified} of {totalChanges} commits classified<button aria-label="About change mix" aria-expanded={mixInfoOpen} aria-controls="work-change-mix-help" onClick={() => setMixInfoOpen(!mixInfoOpen)} className="inline-flex size-7 items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-ring"><Info className="size-3.5" /></button></span></div>
        {mixInfoOpen ? <p id="work-change-mix-help" className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Types come from commit prefixes, such as feat: and fix:. Unclassified commits have no recognized prefix. Selecting a type shows work containing that type and keeps its complete allocated cost. This breakdown follows the period and repository selection.</p> : null}
      </div> : null}
      {(hasFilters || projectId !== "all" || personName) ? <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{personName ? `${personName} · ` : ""}{type !== "all" ? `${typeLabel(type)} · ` : ""}{view === "repositories" ? "Project and change-type filters apply in Work. Repository totals show all work in the period." : "Matching work keeps its full allocated cost. Workspace totals are unchanged."}</span><button className="min-h-7 text-foreground underline underline-offset-4" onClick={() => { setSearch(""); update({ q: null, repositoryId: null, projectId: null, type: null, developerId: null }); }}>Clear filters</button></div> : null}

      <TabsContent value="work" className="mt-0">
        <div className="hidden grid-cols-[minmax(0,1fr)_6rem_13rem_5rem] gap-4 border-y py-2 text-xs text-muted-foreground md:grid"><span>Work</span><span>State / type</span><span className="text-right">Allocated AI cost</span><span className="text-right">Latest activity</span></div>
        {loading ? <div role="status" className="flex min-h-32 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading work…</div> : null}
        {!loading && !error && !page?.items.length ? <div className="py-8"><h3 className="text-sm font-medium">{hasFilters ? "No work matches these filters" : "No work in this period"}</h3><p className="mt-1 text-sm text-muted-foreground">{hasFilters ? "Try another search or clear the filters." : data.repositoryOptions.length ? "Try a longer date range or sync GitHub. Your connected repositories are in the Repositories tab." : "Grant repository access in Integrations, then sync GitHub."}</p></div> : null}
        {!loading && page?.items.length ? <ul className="divide-y border-b">{page.items.map((item) => {
          const Icon = item.kind === "ticket" ? Layers3 : item.kind === "pull_request" ? GitPullRequest : GitCommitHorizontal;
          const state = (item.kind === "pull_request" ? item.state?.toLowerCase().replaceAll("_", " ") : null) || (item.kind === "ticket" ? "Ticket group" : item.kind === "pull_request" ? "Pull request" : "Commit");
          return <li key={item.id}><button type="button" onClick={(event) => { activeRow.current = event.currentTarget; setSelected(item); }} className="grid w-full min-w-0 gap-x-4 gap-y-2 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring md:grid-cols-[minmax(0,1fr)_6rem_13rem_5rem] md:items-center">
            <div className="min-w-0"><div className="flex items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="line-clamp-2 break-words text-sm font-medium leading-5">{item.title}</span></div><p className="ml-6 mt-1 truncate text-xs text-muted-foreground">{item.repository.fullName}{item.ticketKey ? ` · ${item.ticketKey}` : ""} · {item.commitCount} {item.commitCount === 1 ? "commit" : "commits"}{item.projectLinks.length ? ` · ${new Set(item.projectLinks.map((link) => link.projectId)).size} Projects` : ""}</p></div>
            <span className="ml-6 text-xs capitalize text-muted-foreground md:ml-0">{state}</span>
            <div className="ml-6 flex items-center justify-between gap-4 md:ml-0 md:justify-end md:text-right"><Cost verified={item.verifiedMicros} estimated={item.estimatedMicros} current={data.allocationCurrent} /><span className="text-xs text-muted-foreground md:hidden">{dateLabel(item.activityAt)}</span></div>
            <span className="hidden text-right text-xs text-muted-foreground md:block">{dateLabel(item.activityAt)}</span>
          </button></li>;
        })}</ul> : null}
        {error ? <div role="alert" className="flex items-center gap-2 py-4 text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())}>Retry</Button></div> : null}
        {page?.nextCursor && !loading ? <div className="flex items-center justify-between py-3"><span className="text-xs text-muted-foreground">{page.items.length} of {page.totalCount} work items</span><Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void feed.fetchNextPage()}>{loadingMore ? "Loading…" : "Load more work"}</Button></div> : null}
      </TabsContent>

      <TabsContent value="repositories" className="mt-0">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_13rem_5rem] gap-4 border-y py-2 text-xs text-muted-foreground md:grid"><span>Repository</span><span>Activity</span><span className="text-right">Allocated AI cost</span><span className="text-right">Latest activity</span></div>
        {repositories.length ? <ul className="divide-y border-b">{repositories.map((repo) => <li key={repo.id} className="py-3"><button className="grid w-full min-w-0 gap-2 text-left hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring md:grid-cols-[minmax(0,1fr)_9rem_13rem_5rem] md:items-center md:gap-4" onClick={() => { setSearch(""); update({ view: "work", repositoryId: repo.id, q: null }); }}><div className="min-w-0"><p className="flex items-center gap-2 break-all text-sm font-medium">{repo.fullName}<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" /></p><p className="mt-1 text-xs text-muted-foreground">{repo.contributorCount} {repo.contributorCount === 1 ? "contributor" : "contributors"}{(repo.lastError || ["error", "failed"].includes(repo.syncStatus)) ? <span className="ml-2 text-amber-700">Sync needs attention</span> : repo.syncStatus === "syncing" ? " · Syncing…" : !repo.commitCount && !repo.pullRequestCount ? " · No recent work" : ""}</p></div><p className="text-xs text-muted-foreground">{repo.pullRequestCount} PRs · {repo.commitCount} commits</p><div className="flex items-center justify-between md:justify-end md:text-right"><Cost verified={repo.verifiedMicros} estimated={repo.estimatedMicros} current={data.allocationCurrent} /><span className="text-xs text-muted-foreground md:hidden">{dateLabel(repo.latestActivityAt)}</span></div><span className="hidden text-right text-xs text-muted-foreground md:block">{dateLabel(repo.latestActivityAt)}</span></button>{repo.lastError || ["error", "failed"].includes(repo.syncStatus) ? <p className="mt-2 text-xs text-amber-700">{repo.lastError || "Latest sync failed. Last successful work is shown."}</p> : null}</li>)}</ul> : <div className="py-8 text-sm text-muted-foreground">{hasFilters ? "No repositories match these filters." : "No repositories granted. Manage GitHub access in Integrations."}</div>}
      </TabsContent>
    </Tabs>
    <WorkSpendSheet item={selected} days={data.days} allocationCurrent={data.allocationCurrent} onClose={() => setSelected(null)} onReturnFocus={() => activeRow.current?.focus()} />
  </section>;
}
