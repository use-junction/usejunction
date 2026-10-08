"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Info, Loader2, MoreHorizontal, RefreshCw, Users } from "lucide-react";
import {
  GitHubProjectsBadge,
  GitHubProjectsButtonLabel,
  IntegrationProviderLogoStack,
  IntegrationProviderMark,
} from "@/components/features/integration-provider-logos";
import { toast } from "sonner";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";
import { GithubInstallReview } from "@/components/features/github-install-review";
import { GitHubAccountsList } from "@/components/features/github-accounts-list";
import { ProjectToolConnectDialog } from "@/components/features/project-tool-connect-dialog";
import { WorkSpendExplorer } from "@/components/features/work-spend-explorer";
import { WorkSpendDestinations } from "@/components/features/work-spend-destinations";
import { WorkSpendMix } from "@/components/features/work-spend-mix";
import { WorkSpendPeoplePanel } from "@/components/features/work-spend-people";
import { WorkSpendProjectView } from "@/components/features/work-spend-project";
import { WorkSpendProjects } from "@/components/features/work-spend-projects";
import { WorkSpendSetupStrip } from "@/components/features/work-spend-setup-strip";
import { WorkSpendStates } from "@/components/features/work-spend-states";
import { WorkSpendTrend } from "@/components/features/work-spend-trend";
import type { WorkFeedItem, WorkLifecycle, WorkSpendPayload } from "@/components/features/work-spend-types";
import type { GitHubConnectionView } from "@/lib/integrations/github-connections";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { browserMutationInit, useAppPageQuery, useInvalidateAppData } from "@/lib/api/client";
import { workSpendKey } from "@/lib/app-pages/query-keys";

function shortDate(value: string | null) { return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not yet"; }
type Notice = { kind: "success" | "warning" | "error"; title: string; description: string };

export default function WorkSpendClientScreen() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const summaryParams = new URLSearchParams();
  if (searchParams.get("days")) summaryParams.set("days", searchParams.get("days")!);
  if (searchParams.get("repositoryId")) summaryParams.set("repositoryId", searchParams.get("repositoryId")!);
  const queryString = summaryParams.toString();
  const query = useAppPageQuery<WorkSpendPayload>(workSpendKey(queryString), `/api/app/work-spend${queryString ? `?${queryString}` : ""}`);
  useAppQueryErrorToast(query.error);
  const invalidate = useInvalidateAppData();
  const operation = useRef(false);
  const callbackNotice = useRef(false);
  const connectionButton = useRef<HTMLButtonElement>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<GitHubConnectionView | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mappingLogin, setMappingLogin] = useState<string | null>(null);
  const [installsLoading, setInstallsLoading] = useState(false);
  const [installsError, setInstallsError] = useState<string | null>(null);
  const [installAttempt, setInstallAttempt] = useState(0);
  const [githubInstalls, setGithubInstalls] = useState<{ installations: Array<{ id: string; login: string; accountType: string }> } | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkFeedItem | null>(null);
  const connectionState = query.data?.connection.state;

  useEffect(() => {
    if (callbackNotice.current) return;
    const github = searchParams.get("connected");
    if (!github) return;
    callbackNotice.current = true;
    if (github === "github") toast.success("GitHub connected", { description: "Sync to load your repositories and work." });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("connected"); params.delete("connection");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!query.data?.canMapIdentities) return;
    if (connectionState !== "none" && !connectionOpen) return;
    let cancelled = false;
    setInstallsLoading(true); setInstallsError(null);
    void Promise.resolve(fetch("/api/integrations/github/installations", { credentials: "include" }))
      .then((response) => { if (!response || typeof response !== "object" || !("ok" in response)) return null; if (!response.ok) throw new Error("Unable to load GitHub installations."); return response.json(); })
      .then((body) => { if (!cancelled && body) setGithubInstalls({ installations: Array.isArray(body.installations) ? body.installations : [] }); })
      .catch(() => { if (!cancelled) setInstallsError("Unable to load GitHub installations. You can retry or connect directly."); })
      .finally(() => { if (!cancelled) setInstallsLoading(false); });
    return () => { cancelled = true; };
  }, [connectionState, connectionOpen, installAttempt, query.data?.canMapIdentities]);

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <AppPageSkeleton />;
  const data = query.data;
  const canManage = data.canMapIdentities;
  const selectedDays = String(data.days || 90);
  const workStateParam = searchParams.get("workState");
  const workState: WorkLifecycle | null = workStateParam === "shipped" || workStateParam === "in_flight" || workStateParam === "stalled" ? workStateParam : null;
  const projectId = searchParams.get("projectId");
  const developerId = data.canViewPeople ? searchParams.get("developerId") : null;
  const repoCount = data.repositoryOptions.length;
  const requestedBy = searchParams.get("trendBy");
  const trendBy = requestedBy === "person" && data.canViewPeople ? "person" as const
    : requestedBy === "project" ? "project" as const
    : requestedBy === "repository" && repoCount > 1 ? "repository" as const
    : repoCount > 1 ? "repository" as const : "project" as const;
  const detailed = searchParams.get("explore") === "1";
  const projectView = searchParams.get("projectView");

  function setViewParams(values: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("cursor");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  function setDays(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", next);
    params.delete("cursor");
    router.replace(`${pathname}?${params}`);
  }

  async function syncNow() {
    if (operation.current) return;
    operation.current = true; setSyncing(true); setNotice(null);
    const toastId = toast.loading("Syncing GitHub…", { description: "Checking granted repositories and matching work to AI usage." });
    try {
      const response = await fetch("/api/app/features/sync", browserMutationInit("POST"));
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "GitHub sync failed. Please try again.");
      const counts = body?.data?.counts;
      if (!counts) throw new Error("Couldn’t confirm the sync result. Refresh before trying again.");
      await invalidate();
      if (counts.githubError || counts.githubSkipped || counts.githubFailedRepos > 0 || counts.githubProjects?.failed > 0 || counts.githubProjectsError) {
        const description = counts.githubFailedRepos > 0 ? `${counts.githubFailedRepos} repositories could not be checked. Other repositories were refreshed.` : counts.githubProjects?.failed > 0 ? `${counts.githubProjects.failed} selected Projects could not be refreshed. Repository work was refreshed.` : counts.githubProjectsError ? "Selected Projects could not be refreshed. Repository work was refreshed." : counts.githubReason === "no_repositories" ? "Grant repository access to the GitHub App, then sync again." : counts.githubReason === "permission_required" ? "Approve the required GitHub permissions, then sync again." : "Some GitHub work could not be refreshed. Check the connection and retry.";
        setNotice({ kind: "warning", title: "Sync partially complete", description });
        toast.warning("Sync partially complete", { id: toastId, description });
      } else {
        const description = `Checked ${Number(counts.githubRepos ?? 0).toLocaleString()} repositories and ${Number(counts.githubCommits ?? 0).toLocaleString()} commits.`;
        setNotice({ kind: "success", title: "GitHub sync complete", description });
        toast.success("GitHub sync complete", { id: toastId, description });
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "Please try again.";
      setNotice({ kind: "error", title: "Couldn’t sync GitHub", description });
      toast.error("Couldn’t sync GitHub", { id: toastId, description });
    } finally { operation.current = false; setSyncing(false); }
  }

  async function disconnectGithub() {
    if (!disconnectTarget || operation.current) return;
    operation.current = true; setDisconnecting(true); setDisconnectError(null);
    try {
      const response = await fetch(`/api/integrations/${disconnectTarget.id}/disconnect`, browserMutationInit("POST"));
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "Couldn’t disconnect GitHub.");
      await invalidate();
      setDisconnectOpen(false); setDisconnectTarget(null); setConnectionOpen(false); setNotice(null);
      toast.success("GitHub disconnected", { description: `${disconnectTarget.githubOrg || "That account"} was removed from this workspace.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t disconnect GitHub.";
      setDisconnectError(message); toast.error(message);
    } finally { operation.current = false; setDisconnecting(false); }
  }

  async function mapAuthor(identityId: string | null, login: string, developerId: string | null) {
    if (!identityId || operation.current) return;
    operation.current = true; setMappingLogin(login);
    try {
      const response = await fetch(`/api/app/integrations/github/identities/${identityId}`, browserMutationInit("PATCH", { developerId }));
      if (!response.ok) throw new Error("Couldn’t assign this author.");
      await invalidate();
      toast.success(developerId ? `${login} assigned` : `${login} left unassigned`, { description: "Work allocation was refreshed." });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn’t assign this author."); }
    finally { operation.current = false; setMappingLogin(null); }
  }

  if (data.connection.state === "none") return <GithubInstallReview installHref="/api/integrations/github/connect?returnTo=/work-spend" installations={githubInstalls?.installations ?? []} canManage={canManage} loading={installsLoading} loadError={installsError} onRetry={() => setInstallAttempt((value) => value + 1)} spendMicros={data.coverage?.eligibleMicros ?? null} days={data.days} />;

  const hasWork = data.repositories.some((repo) => repo.commitCount || repo.pullRequestCount);
  const repositoryErrors = data.repositories.filter((repo) => repo.lastError || ["error", "failed"].includes(repo.syncStatus));
  const githubNeedsAttention = ["permission_required", "partial"].includes(data.connection.state) || Boolean(data.connection.lastError);
  const projectsNeedAttention = ["permission_required", "partial"].includes(data.projects.state);
  const attentionCount = Number(githubNeedsAttention) + repositoryErrors.length + Number(projectsNeedAttention);

  return <div className="min-w-0 pb-8">
      <PageHeader title="Work." description="Where AI spend landed: repositories, pull requests and issues." actions={<div className="flex flex-wrap items-center gap-2">
        <Select value={selectedDays} onValueChange={setDays}><SelectTrigger aria-label="Date range" className="h-9 w-28 sm:w-36"><SelectValue><span className="sm:hidden">{selectedDays} days</span><span className="hidden sm:inline">Last {selectedDays} days</span></SelectValue></SelectTrigger><SelectContent><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem></SelectContent></Select>
        <Button type="button" size="sm" variant="outline" onClick={() => void syncNow()} disabled={syncing || disconnecting || !!mappingLogin}><RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} aria-hidden />{syncing ? "Syncing…" : "Sync now"}</Button>
        <Button ref={connectionButton} type="button" size="sm" variant="outline" className="rounded-none border-brand-olive-border bg-brand-olive/5 hover:bg-brand-olive/10" onClick={() => setConnectionOpen(true)}><IntegrationProviderLogoStack />Integrations{attentionCount ? <span aria-label={`${attentionCount} items need attention`} className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-yellow-pale px-1.5 text-xs text-foreground">{attentionCount}</span> : null}</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label="More options"><MoreHorizontal className="size-4" aria-hidden /><span className="sm:hidden">More</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-48"><DropdownMenuItem asChild><a href={`/api/app/work-spend/export?days=${selectedDays}`}><Download className="size-4" aria-hidden />Export CSV</a></DropdownMenuItem><p className="px-2 py-1.5 text-xs text-muted-foreground">Synced {shortDate(data.connection.lastSyncedAt)}</p></DropdownMenuContent></DropdownMenu>
      </div>} />

    <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}>
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); connectionButton.current?.focus(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg [&_[data-slot=dialog-close]]:rounded-none">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><IntegrationProviderLogoStack size="md" />Integrations</DialogTitle><DialogDescription>Manage connected tools, repository access, project boards, and sync health.</DialogDescription></DialogHeader>
        <section className="space-y-3" aria-labelledby="github-connection-heading">
          <h2 id="github-connection-heading" className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 shrink-0 items-center justify-center border border-border/50 bg-white" aria-hidden><IntegrationProviderMark provider="github" size={14} /></span>GitHub accounts</h2>
          <GitHubAccountsList
            connections={data.connections}
            canManage={canManage}
            installHref="/api/integrations/github/connect?returnTo=/work-spend"
            availableInstalls={githubInstalls?.installations ?? []}
            onDisconnect={(connection) => { setDisconnectTarget(connection); setDisconnectError(null); setConnectionOpen(false); setDisconnectOpen(true); }}
          />
          {repositoryErrors.length ? <ul className="space-y-2 text-xs">{repositoryErrors.map((repo) => <li key={repo.id}><strong>{repo.fullName}</strong><p className="mt-0.5 break-words text-muted-foreground">{repo.lastError || "Latest sync failed. Last successful data is still available."}</p></li>)}</ul> : null}
        </section>
        <section className="space-y-2 border-t pt-4" aria-labelledby="projects-heading"><h2 id="projects-heading"><GitHubProjectsBadge className="text-sm" /></h2><p className="text-sm text-muted-foreground">{data.projects.state === "permission_required" ? "GitHub Projects read access needs approval. Repository work is still available." : data.projects.state === "personal_account" ? "GitHub Projects are available for organization installations." : data.projects.selected.length ? `${data.projects.selected.length} selected GitHub Projects add issue titles and status to linked work.` : "Add issue titles and GitHub Project status to work already in your repositories."}</p>
          <ProjectToolConnectDialog approveUrl={data.connections.find((row) => row.accountType === "Organization")?.approveUrl ?? data.connection.approveUrl} appPermissionsUrl={data.connection.appPermissionsUrl}><Button type="button" variant="outline" size="sm" className="rounded-none"><GitHubProjectsButtonLabel>{projectsNeedAttention ? "Review GitHub Projects access" : data.projects.selected.length ? "Manage GitHub Projects" : "Connect GitHub Projects"}</GitHubProjectsButtonLabel></Button></ProjectToolConnectDialog>
        </section>
        {data.attention.unmappedAuthors.length ? <div className="border-t pt-4"><Button type="button" size="sm" variant="ghost" className="rounded-none" onClick={() => { setConnectionOpen(false); setAuthorsOpen(true); }}><span className="flex size-6 items-center justify-center bg-brand-yellow-pale" aria-hidden><Users className="size-3.5" /></span>Match authors ({data.attention.unmappedAuthors.length})</Button></div> : null}
      </DialogContent>
    </Dialog>

    <Dialog open={disconnectOpen} onOpenChange={(next) => { if (!disconnecting) { setDisconnectOpen(next); if (!next) setDisconnectTarget(null); } }}><DialogContent showCloseButton={!disconnecting} onCloseAutoFocus={(event) => { event.preventDefault(); connectionButton.current?.focus(); }}><DialogHeader><DialogTitle>Disconnect {disconnectTarget?.githubOrg || "GitHub"}?</DialogTitle><DialogDescription>This affects everyone in this workspace.</DialogDescription></DialogHeader><p className="border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6">Imported commits, pull requests, and selected Projects from {disconnectTarget?.githubOrg || "this account"} will be removed. Other GitHub accounts stay connected. This does not uninstall the GitHub App.</p><p className="text-sm leading-6 text-muted-foreground">Your code on GitHub and collected AI usage stay intact.</p>{disconnectError ? <p role="alert" className="text-sm text-destructive">{disconnectError}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={disconnecting} onClick={() => setDisconnectOpen(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={disconnecting} onClick={() => void disconnectGithub()}>{disconnecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{disconnecting ? "Disconnecting…" : `Disconnect ${disconnectTarget?.githubOrg || "GitHub"}`}</Button></DialogFooter></DialogContent></Dialog>

    {notice ? <div role="status" className="mb-4 flex items-start gap-2 text-xs text-muted-foreground"><Info className="size-4 shrink-0" aria-hidden /><span className="flex-1"><strong className="text-foreground">{notice.title}.</strong> {notice.description}</span><button type="button" className="underline underline-offset-4" onClick={() => setNotice(null)}>Dismiss</button></div> : null}
    {!hasWork && data.connection.state === "permission_required" ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 border-l-2 border-amber-500 bg-brand-yellow-pale px-3 py-2 text-sm"><p>GitHub permissions are needed to load work.</p><Button type="button" variant="ghost" size="sm" onClick={() => setConnectionOpen(true)}>Review access</Button></div> : null}
    {!hasWork && data.connection.state === "syncing" ? <p role="status" className="mb-4 text-sm text-muted-foreground">First sync has not completed. Sync now to load repository work.</p> : null}

    {searchParams.get("repositoryId") && !data.selectedRepositoryId ? <div role="status" className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">Repository access changed. Showing granted work. <button type="button" className="underline underline-offset-4" onClick={() => setViewParams({ repositoryId: null })}>Clear selection</button></div> : null}
    {projectView ? <div><Button variant="ghost" size="sm" className="mb-3" onClick={() => setViewParams({ projectView: null })}><ArrowLeft className="size-4" />Spend overview</Button><WorkSpendProjectView projectId={projectView} days={data.days} allocationCurrent={data.allocationCurrent} /></div> : detailed ? <div><Button variant="ghost" size="sm" className="mb-3" onClick={() => setViewParams({ explore: null, view: null, q: null, type: null, sort: null, workState: null, projectId: null, developerId: null })}><ArrowLeft className="size-4" />Spend overview</Button><WorkSpendExplorer data={data} /></div> : <>
      <div className="grid items-stretch gap-6 xl:grid-cols-[1.45fr_1fr]">
        <WorkSpendTrend days={data.days} by={trendBy} canViewPeople={data.canViewPeople} repositoryCount={repoCount} allocatedMicros={data.coverage.attributedMicros} onBy={(next) => setViewParams({ trendBy: next })} />
        <WorkSpendStates data={data} selected={workState} onSelect={(state) => setViewParams({ workState: state })} />
      </div>
      <div className={`mt-10 grid gap-4 ${data.canViewPeople ? "xl:grid-cols-2" : ""}`}>
        <Panel as="section" className="min-w-0">
          <WorkSpendProjects
            data={data}
            selectedProjectId={projectId}
            selectedWorkState={workState}
            onSelect={(nextProject, nextState) => setViewParams({ projectId: nextProject, workState: nextState })}
            onOpen={(next) => setViewParams({ projectView: next, explore: null })}
          />
        </Panel>
        {data.canViewPeople ? (
          <Panel as="section" className="min-w-0">
            <WorkSpendPeoplePanel
              data={data}
              selectedDeveloperId={developerId}
              onSelect={(next) => setViewParams({ developerId: next, trendBy: next ? "person" : null })}
              onAuthors={() => setAuthorsOpen(true)}
            />
          </Panel>
        ) : null}
      </div>
      <div className="mt-10 grid gap-4 xl:grid-cols-[7fr_3fr]">
        <Panel as="section" className="min-w-0">
          <WorkSpendMix data={data} />
        </Panel>
        <div className="relative min-h-0 max-xl:min-h-[22rem] xl:min-h-[12rem]">
          <Panel as="section" className="flex min-h-0 flex-col overflow-hidden max-xl:max-h-[28rem] xl:absolute xl:inset-0">
            <WorkSpendDestinations data={data} workState={workState} projectId={projectId} developerId={developerId} onExplore={() => setViewParams({ explore: "1", sort: "cost" })} onSync={() => void syncNow()} selectedItem={selectedItem} onSelectedItem={setSelectedItem} />
          </Panel>
        </div>
      </div>
      <WorkSpendSetupStrip data={data} onAuthors={() => setAuthorsOpen(true)} onConnections={() => setConnectionOpen(true)} />
    </>}

    <Dialog open={authorsOpen} onOpenChange={setAuthorsOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Match GitHub authors</DialogTitle><DialogDescription>Assign authors to workspace members so their AI usage can be allocated to work.</DialogDescription></DialogHeader><ul className="divide-y">{data.attention.unmappedAuthors.map((author) => <li key={author.login} className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="text-sm"><strong>@{author.login}</strong><span className="ml-2 text-xs text-muted-foreground">{author.commitCount} commits</span></span>{canManage && author.identityId ? <Select disabled={!!mappingLogin || syncing || disconnecting} onValueChange={(value) => void mapAuthor(author.identityId, author.login, value === "none" ? null : value)}><SelectTrigger size="sm" aria-label={`Assign ${author.login}`} className="w-full sm:w-56"><SelectValue placeholder={mappingLogin === author.login ? "Assigning…" : "Assign team member"} /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{data.attention.developers.map((developer) => <SelectItem key={developer.id} value={developer.id}>{developer.name}{developer.id === author.suggestedDeveloperId ? " (suggested)" : ""}</SelectItem>)}</SelectContent></Select> : <span className="text-xs text-muted-foreground">{canManage ? "Sync GitHub to enable matching" : "Ask a workspace admin to assign this author"}</span>}</li>)}</ul>{!data.attention.unmappedAuthors.length ? <p className="text-sm text-muted-foreground">All authors in this work scope are matched.</p> : null}</DialogContent></Dialog>
  </div>;
}
