"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, GitCommitHorizontal, GitPullRequest, Search, FolderGit2, Sparkles } from "lucide-react";
import { Panel } from "@/components/panel";
import { ProjectToolConnectDialog } from "@/components/features/project-tool-connect-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FeaturesPagePayload } from "@/lib/app-pages/features";
import { commitChangeType, compareCost, groupWorkByRepository, type WorkCommit } from "@/lib/features/work-explorer";
import { formatMicrosAsCurrency } from "@/lib/format";

function Costs({ verified, estimated }: { verified: string | bigint; estimated: string | bigint }) {
  return (
    <dl className="grid shrink-0 grid-cols-2 gap-x-6 text-right sm:gap-x-8">
      <div><dt className="text-[11px] text-muted-foreground">Verified</dt><dd className="mt-0.5 text-sm font-medium tabular-nums">{formatMicrosAsCurrency(String(verified))}</dd></div>
      <div><dt className="text-[11px] text-muted-foreground">Estimated</dt><dd className="mt-0.5 text-sm font-medium tabular-nums text-muted-foreground">{formatMicrosAsCurrency(String(estimated))}</dd></div>
    </dl>
  );
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function CommitList({ commits }: { commits: WorkCommit[] }) {
  const [visible, setVisible] = useState(4);
  return (
    <div className="border-t bg-muted/20 px-4 sm:px-5">
      <ul className="divide-y divide-border/60">
        {commits.slice(0, visible).map((commit) => (
          <li key={`${commit.repository?.owner}/${commit.repository?.name}/${commit.sha}`} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              {commit.repository ? (
                <a href={`https://github.com/${encodeURIComponent(commit.repository.owner)}/${encodeURIComponent(commit.repository.name)}/commit/${encodeURIComponent(commit.sha)}`} target="_blank" rel="noreferrer" className="group/link inline-flex max-w-full items-start gap-1 text-sm font-medium hover:underline focus-visible:outline-ring">
                  <span className="break-words">{commit.headline || "Untitled commit"}</span><ArrowUpRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="sr-only"> (opens on GitHub in a new tab)</span>
                </a>
              ) : <p className="break-words text-sm font-medium">{commit.headline || "Untitled commit"}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <code>{commit.sha.slice(0, 7)}</code><span aria-hidden="true">·</span>
                <span>{commit.authorLogin ? `@${commit.authorLogin}` : commit.developers.join(", ") || "Unknown author"}</span><span aria-hidden="true">·</span>
                <time dateTime={commit.authoredAt} title={`${commit.authoredAt} (UTC)`}>{shortDate(commit.authoredAt)}</time>
                <span className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px]">{commitChangeType(commit.headline)}</span>
              </div>
            </div>
            <Costs verified={commit.verifiedMicros} estimated={commit.estimatedMicros} />
          </li>
        ))}
      </ul>
      {visible < commits.length ? <div className="border-t py-3 text-center"><Button variant="ghost" size="sm" onClick={() => setVisible((count) => count + 10)}>Show more changes ({commits.length - visible} remaining)</Button></div> : null}
    </div>
  );
}

function EmptyWork({ title, description, reset }: { title: string; description: string; reset?: () => void }) {
  return <div className="flex flex-col items-center px-6 py-12 text-center"><div className="mb-4 flex size-10 items-center justify-center rounded-lg border bg-muted/40"><GitPullRequest aria-hidden="true" className="size-5 text-muted-foreground" /></div><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>{reset ? <Button onClick={reset} variant="outline" size="sm" className="mt-4">Clear filters</Button> : null}</div>;
}

export function FeatureWorkExplorer({ data }: { data: FeaturesPagePayload }) {
  const [view, setView] = useState(data.features.length ? "tickets" : "repositories");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("cost");
  const [changeType, setChangeType] = useState("all");
  const groups = useMemo(() => groupWorkByRepository(data.unlinkedCommits, search, changeType)
    .sort((a, b) => sort === "commits" ? b.commits.length - a.commits.length || compareCost(a, b) : compareCost(a, b) || b.latestAt.localeCompare(a.latestAt)), [data.unlinkedCommits, search, changeType, sort]);
  const features = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.features.filter((feature) => `${feature.ticketKey} ${feature.developers.join(" ")}`.toLowerCase().includes(query))
      .sort((a, b) => sort === "commits" ? b.commitCount - a.commitCount || compareCost(a, b) : compareCost(a, b) || b.commitCount - a.commitCount);
  }, [data.features, search, sort]);
  const changeTypes = useMemo(() => [...new Set(data.unlinkedCommits.map((commit) => commitChangeType(commit.headline)))].sort(), [data.unlinkedCommits]);
  const shownCommits = groups.reduce((count, group) => count + group.commits.length, 0);
  const totalCommits = data.features.reduce((count, feature) => count + feature.commitCount, data.unlinkedCommits.length);
  const changeMix = [...groups.reduce((mix, group) => {
    for (const [type, count] of group.changes) mix.set(type, (mix.get(type) ?? 0) + count);
    return mix;
  }, new Map<string, number>())].sort((left, right) => right[1] - left[1]);
  const filtered = Boolean(search.trim() || (view === "repositories" && changeType !== "all"));
  const reset = () => { setSearch(""); setChangeType("all"); };

  return (
    <Panel as="section" padded={false} className="mb-6 overflow-hidden" aria-labelledby="work-explorer-title">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">The work behind the spend</p>
          <h2 id="work-explorer-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{totalCommits.toLocaleString()} synced {totalCommits === 1 ? "change" : "changes"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Explore by ticket or see what changed in each repository.</p>
        </div>
        <ProjectToolConnectDialog />
      </div>
      {data.features.length === 0 && data.unlinkedCommits.length > 0 ? (
        <div className="mx-5 mb-5 flex flex-col gap-3 border-l-[3px] border-brand-yellow-dark bg-brand-yellow-pale px-4 py-3.5 sm:mx-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><Sparkles className="mt-0.5 size-4 shrink-0 text-brand-yellow-dark" aria-hidden /><div><p className="text-sm font-semibold">Ticketed features need ticket keys.</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">All {data.unlinkedCommits.length.toLocaleString()} changes here have no ticket key. Add one like ENG-123 to a commit message to group future work as a feature.</p></div></div>
          <span className="shrink-0 rounded-sm border border-brand-yellow-dark/20 bg-background px-2 py-1 font-mono text-[11px]">ENG-123 Add invitations</span>
        </div>
      ) : null}
      <Tabs value={view} onValueChange={(next) => { setView(next); reset(); }} className="gap-0">
        <div className="border-b bg-muted/20 px-5 sm:px-6">
          <TabsList variant="line" className="h-auto max-w-full gap-5 pb-2">
            <TabsTrigger value="tickets" className="px-0 text-xs sm:text-sm">Ticketed features <span className="rounded bg-background px-1.5 py-0.5 text-[10px] tabular-nums">{data.features.length}</span></TabsTrigger>
            <TabsTrigger value="repositories" className="px-0 text-xs sm:text-sm">Without tickets <span className="rounded bg-background px-1.5 py-0.5 text-[10px] tabular-nums">{data.unlinkedCommits.length}</span></TabsTrigger>
          </TabsList>
        </div>
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
          <div className="relative min-w-0 sm:min-w-56 sm:flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} type="search" aria-label={view === "tickets" ? "Search tickets or contributors" : "Search commits, repositories or authors"} placeholder={view === "tickets" ? "Search tickets or contributors…" : "Search commits, repositories or authors…"} className="bg-background pl-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            {view === "repositories" ? <Select value={changeType} onValueChange={setChangeType}><SelectTrigger className="w-40 bg-background" aria-label="Filter by change type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All change types</SelectItem>{changeTypes.map((type) => <SelectItem value={type} key={type}>{type}</SelectItem>)}</SelectContent></Select> : null}
            <Select value={sort} onValueChange={setSort}><SelectTrigger className="w-36 bg-background" aria-label="Sort work"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost">Highest cost</SelectItem><SelectItem value="commits">Most commits</SelectItem></SelectContent></Select>
          </div>
        </div>
        <TabsContent value="tickets">
          {features.length ? <>
            <p className="px-5 py-3 text-xs text-muted-foreground sm:px-6" aria-live="polite">{features.length} {features.length === 1 ? "feature" : "features"}{filtered ? " matching your search" : " linked by ticket keys in commit messages"}</p>
            <ul className="divide-y border-t">
              {features.map((feature) => <li key={feature.ticketKey} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex min-w-0 items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"><GitPullRequest aria-hidden="true" className="size-4 text-muted-foreground" /></div><div className="min-w-0"><h3 className="text-sm font-semibold">{feature.ticketKey}</h3><p className="mt-1 text-xs text-muted-foreground">{feature.commitCount} {feature.commitCount === 1 ? "commit" : "commits"}{feature.developers.length ? ` · ${feature.developers.join(", ")}` : " · No contributor cost attribution yet"}</p></div></div><Costs verified={feature.verifiedMicros} estimated={feature.estimatedMicros} /></li>)}
            </ul>
          </> : filtered ? <EmptyWork title="No matching features" description="Try another ticket key or contributor name." reset={reset} /> : <EmptyWork title="No ticketed features yet" description={data.emptyReason === "unmapped" ? "Match GitHub authors to team members below so their work can be included here." : data.emptyReason === "no_usage" ? "Features appear when synced commits include a ticket key such as PROJ-123. AI costs appear after usage is reported." : data.emptyReason === "stale_usage" ? `AI usage was last reported on ${data.lastUsageAt?.slice(0, 10) ?? "an earlier date"}. Sync usage to attribute costs to recent work.` : "Include a ticket key such as PROJ-123 in commit messages to group related changes. You can already explore work without tickets by repository."} />}
        </TabsContent>
        <TabsContent value="repositories">
          {groups.length ? <>
            <div className="grid gap-6 border-b px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Change mix</p><p className="mt-1 text-sm text-muted-foreground">{shownCommits} changes across {groups.length} {groups.length === 1 ? "repository" : "repositories"}{filtered ? " match your filters" : ""}. Categories use commit prefixes.</p></div>
              <div className="space-y-2.5" aria-label="Changes by category">
                {changeMix.slice(0, 4).map(([type, count]) => (
                  <div key={type} className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_2rem] items-center gap-3 text-xs">
                    <span className="truncate text-muted-foreground">{type}</span><div className="h-1.5 bg-muted"><div className="h-full bg-brand-yellow-dark" style={{ width: `${Math.max(3, count / Math.max(1, shownCommits) * 100)}%` }} /></div><span className="text-right font-semibold tabular-nums">{count}</span>
                  </div>
                ))}
                {changeMix.length > 4 ? <p className="text-right text-[11px] text-muted-foreground">+ {changeMix.length - 4} more categories in repository details</p> : null}
              </div>
            </div>
            <div className="divide-y border-t">
              {groups.map((group, index) => <details key={group.repository} className="group/repo" open={index === 0 ? true : undefined}>
                <summary className="flex cursor-pointer list-none flex-col gap-4 px-5 py-5 transition-colors hover:bg-muted/30 focus-visible:outline focus-visible:outline-ring sm:flex-row sm:items-center sm:justify-between sm:px-6 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30"><FolderGit2 aria-hidden="true" className="size-4 text-muted-foreground" /></div><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{group.repository}</h3><p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><GitCommitHorizontal aria-hidden="true" className="size-3.5" />{group.commits.length} commits</span>{group.contributors.size ? <span>· {group.contributors.size} {group.contributors.size === 1 ? "contributor" : "contributors"}</span> : null}<span>· Latest {shortDate(group.latestAt)}</span></p><div className="mt-2 flex flex-wrap gap-1.5">{[...group.changes].sort((a, b) => b[1] - a[1]).map(([type, count]) => <span key={type} className="rounded-sm border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">{type} <span className="ml-1 font-medium text-foreground">{count}</span></span>)}</div></div></div>
                  <div className="flex shrink-0 items-center justify-between gap-5"><Costs verified={group.verifiedMicros} estimated={group.estimatedMicros} /><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/repo:rotate-180" /></div>
                </summary>
                <CommitList key={`${search}:${changeType}`} commits={group.commits} />
              </details>)}
            </div>
          </> : filtered ? <EmptyWork title="No matching work" description="Try a different search or change type to find the commits you need." reset={reset} /> : <EmptyWork title="No work without tickets" description={data.features.length ? "All synced, mapped commits in this period have ticket keys." : "Synced commits from mapped team members will appear here. Try a longer date range or sync GitHub."} />}
        </TabsContent>
      </Tabs>
      <div className="border-t bg-muted/15 px-5 py-3 text-xs leading-relaxed text-muted-foreground sm:px-6">Verified usage and estimated API costs are shown separately. {view === "repositories" ? `Repository totals reflect ${filtered ? "matching" : "listed"} commits without ticket keys; change types come from commit prefixes.` : "Ticket keys come from commit messages. Feature names and project status are not available from GitHub commits."}</div>
    </Panel>
  );
}
