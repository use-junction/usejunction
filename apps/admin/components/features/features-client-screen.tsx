"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";
import { GithubInstallReview } from "@/components/features/github-install-review";
import { GitHubAccountsList } from "@/components/features/github-accounts-list";
import { AlertCircle, CheckCircle2, Github, Info, Loader2, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { FeatureWorkExplorer } from "@/components/features/feature-work-explorer";
import { FeatureSpendOverview } from "@/components/features/feature-spend-overview";
import { ProjectToolConnectDialog } from "@/components/features/project-tool-connect-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { browserMutationInit, useAppPageQuery, useInvalidateAppData } from "@/lib/api/client";
import type { FeaturesPagePayload } from "@/lib/app-pages/features";
import type { GitHubConnectionView } from "@/lib/integrations/github-connections";
import { featuresKey } from "@/lib/app-pages/query-keys";

export default function FeaturesClientScreen() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryString = searchParams.toString();
  const query = useAppPageQuery<FeaturesPagePayload>(
    featuresKey(queryString),
    `/api/app/features${queryString ? `?${queryString}` : ""}`,
  );
  useAppQueryErrorToast(query.error);
  const invalidate = useInvalidateAppData();
  const [syncing, setSyncing] = useState(false);
  const operation = useRef(false);
  const connectionButton = useRef<HTMLButtonElement>(null);
  const connectedNotice = useRef(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "warning"; title: string; description: string } | null>(null);
  const [installsLoading, setInstallsLoading] = useState(false);
  const [installsError, setInstallsError] = useState<string | null>(null);
  const [installAttempt, setInstallAttempt] = useState(0);
  const [disconnectTarget, setDisconnectTarget] = useState<GitHubConnectionView | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [mappingLogin, setMappingLogin] = useState<string | null>(null);
  const [githubInstalls, setGithubInstalls] = useState<{
    installations: Array<{ id: string; login: string; accountType: string }>;
    installAppUrl: string | null;
  } | null>(null);
  const connectionState = query.data?.connection.state;

  useEffect(() => {
    if (searchParams.get("connected") !== "github" || connectedNotice.current) return;
    connectedNotice.current = true;
    toast.success("GitHub connected", { description: "Your first sync will prepare the Features view." });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("connected");
    params.delete("connection");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!query.data?.canMapIdentities) return;
    if (connectionState !== "none" && !connectionOpen) return;
    let cancelled = false;
    setInstallsLoading(true);
    setInstallsError(null);
    void Promise.resolve(fetch("/api/integrations/github/installations", { credentials: "include" }))
      .then((response) => {
        if (!response || typeof response !== "object" || !("ok" in response)) return null;
        if (!response.ok) throw new Error("Unable to load GitHub installations. Try again.");
        return response.json();
      })
      .then((payload) => {
        if (cancelled || !payload) return;
        setGithubInstalls({
          installations: Array.isArray(payload.installations) ? payload.installations : [],
          installAppUrl: typeof payload.installAppUrl === "string" ? payload.installAppUrl : null,
        });
      })
      .catch(() => {
        if (!cancelled) setInstallsError("Unable to load GitHub installations. You can retry or connect directly.");
      })
      .finally(() => { if (!cancelled) setInstallsLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [connectionState, connectionOpen, installAttempt, query.data?.canMapIdentities]);

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  if (!query.data) return <AppPageSkeleton />;
  const data = query.data;

  async function syncNow() {
    if (operation.current) return;
    operation.current = true;
    setSyncing(true);
    setNotice(null);
    const toastId = toast.loading("Syncing GitHub…", { description: "Checking repositories and matching work to AI usage. This can take a few minutes." });
    try {
      const response = await fetch("/api/app/features/sync", browserMutationInit("POST"));
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || "GitHub sync failed. Please try again.");
      const counts = payload?.data?.counts;
      if (!counts) throw new Error("We couldn’t confirm the sync result. Refresh the page before trying again.");
      await invalidate();
      if (counts.githubError || counts.githubSkipped || counts.githubFailedRepos > 0) {
        const description = counts.githubFailedRepos > 0
          ? `${counts.githubFailedRepos} repositories could not be checked. Other work has been refreshed; review GitHub connection details and retry.`
          : counts.githubReason === "no_repositories"
          ? "Give the GitHub App access to repositories, then sync again."
          : counts.githubReason === "permission_required"
            ? "Approve the required GitHub permissions, then sync again."
            : "GitHub code could not be fully synced. Check the connection details and try again.";
        setNotice({ kind: "warning", title: "GitHub sync needs attention", description });
        toast.warning("GitHub sync needs attention", { id: toastId, description });
      } else {
        const description = typeof counts.githubCommits === "number" && typeof counts.githubRepos === "number"
          ? `Checked ${counts.githubCommits.toLocaleString()} commits across ${counts.githubRepos.toLocaleString()} repositories. The work view is up to date.`
          : "The work view has been refreshed with the latest available GitHub data.";
        setNotice({ kind: "success", title: "GitHub sync complete", description });
        toast.success("GitHub sync complete", { id: toastId, description });
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "Please try again.";
      setNotice({ kind: "error", title: "Couldn’t sync GitHub", description });
      toast.error("Couldn’t sync GitHub", { id: toastId, description });
    } finally {
      operation.current = false;
      setSyncing(false);
    }
  }

  async function disconnectGithub() {
    if (!disconnectTarget || operation.current) return;
    operation.current = true;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const response = await fetch(`/api/integrations/${disconnectTarget.id}/disconnect`, browserMutationInit("POST"));
      if (!response.ok) throw new Error("Couldn’t disconnect GitHub. Please try again.");
      await invalidate();
      setDisconnectOpen(false);
      setDisconnectTarget(null);
      setConnectionOpen(false);
      setNotice(null);
      toast.success("GitHub disconnected", { description: `${disconnectTarget.githubOrg || "That account"} was removed from this workspace.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t disconnect GitHub. Please try again.";
      setDisconnectError(message);
      toast.error(message);
    } finally {
      operation.current = false;
      setDisconnecting(false);
    }
  }

  async function mapAuthor(identityId: string | null, login: string, developerId: string | null) {
    if (!identityId || operation.current) return;
    operation.current = true;
    setMappingLogin(login);
    try {
      const response = await fetch(
        `/api/app/integrations/github/identities/${identityId}`,
        browserMutationInit("PATCH", { developerId }),
      );
      if (!response.ok) throw new Error("Couldn’t assign this author. Please try again.");
      await invalidate();
      toast.success(developerId ? `${login} assigned` : `${login} left unassigned`, { description: "Feature costs have been refreshed." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t assign this author.");
    } finally {
      operation.current = false;
      setMappingLogin(null);
    }
  }

  const accounts = data.connections ?? (data.connection.id ? [{
    id: data.connection.id,
    githubOrg: data.connection.githubOrg,
    accountType: data.connection.accountType === "User" ? "User" as const : "Organization" as const,
    installationId: data.connection.installationId,
    state: data.connection.state === "none" ? "ready" as const : data.connection.state,
    needsMembers: data.connection.needsMembers,
    approveUrl: data.connection.approveUrl,
    appPermissionsUrl: data.connection.appPermissionsUrl,
    lastSyncedAt: data.connection.lastSyncedAt,
    lastError: data.connection.lastError,
  }] : []);
  const permissionAccount = accounts.find((row) => row.state === "permission_required") ?? null;
  const connectHref = "/api/integrations/github/connect?returnTo=/features";
  const selectedDays = String(data.days ?? 90);

  function setDays(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="min-w-0">
      {data.connection.state === "none" ? (
        <GithubInstallReview installHref={connectHref} installations={githubInstalls?.installations ?? []}
          canManage={data.canMapIdentities} loading={installsLoading} loadError={installsError}
          onRetry={() => setInstallAttempt((attempt) => attempt + 1)} />
      ) : (
        <PageHeader
          title="Features"
          description="See what your team shipped and where the AI spend landed."
          className="mb-5 sm:mb-6"
          actions={
            <div className="flex flex-wrap gap-2">
              <Select value={selectedDays} onValueChange={setDays}>
                <SelectTrigger aria-label="Date range" className="w-[8.5rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={() => void syncNow()} disabled={syncing || disconnecting || !!mappingLogin}>
                <RefreshCw className={syncing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          }
        />
      )}

      {data.connection.state !== "none" ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><Github className="size-4" aria-hidden />{accounts.length > 1 ? `${accounts.length} GitHub accounts` : data.connection.githubOrg || "GitHub"}</span>
            <span className="inline-flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${data.connection.lastError || data.connection.state === "permission_required" ? "bg-amber-500" : "bg-success"}`} />
              {data.connection.state === "permission_required" ? "Permissions needed" : data.connection.lastError ? "Needs attention" : "Connected"}</span>
            <span>{data.connection.lastSyncedAt ? `Last synced ${new Date(data.connection.lastSyncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Awaiting first sync"}</span>
          </div>
          <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}>
            <DialogTrigger asChild><Button ref={connectionButton} variant="ghost" size="sm"><Github aria-hidden />GitHub connection</Button></DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>GitHub accounts</DialogTitle><DialogDescription>Manage connected organizations and personal accounts.</DialogDescription></DialogHeader>
              <GitHubAccountsList
                connections={accounts}
                canManage={data.canMapIdentities}
                installHref={connectHref}
                availableInstalls={githubInstalls?.installations ?? []}
                onDisconnect={(connection) => { setDisconnectTarget(connection); setDisconnectError(null); setConnectionOpen(false); setDisconnectOpen(true); }}
              />
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      <Dialog open={disconnectOpen} onOpenChange={(open) => { if (!disconnecting) { setDisconnectOpen(open); if (!open) setDisconnectTarget(null); } }}>
        <DialogContent showCloseButton={!disconnecting} onCloseAutoFocus={(event) => { event.preventDefault(); connectionButton.current?.focus(); }}>
          <DialogHeader><DialogTitle>Disconnect {disconnectTarget?.githubOrg || "GitHub"}?</DialogTitle><DialogDescription>This affects everyone in your workspace.</DialogDescription></DialogHeader>
          <div className="border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6">
            Imported commits, pull requests, and feature-cost history from {disconnectTarget?.githubOrg || "this account"} will be removed. Other GitHub accounts stay connected. Author matches stay unless this is the last GitHub account.
          </div>
          <p className="text-sm leading-6 text-muted-foreground">Your code on GitHub and collected AI usage will stay intact. This does not uninstall the GitHub App.</p>
          {disconnectError ? <p role="alert" className="text-sm text-destructive">{disconnectError}</p> : null}
          <DialogFooter><Button variant="outline" disabled={disconnecting} onClick={() => setDisconnectOpen(false)}>Cancel</Button><Button variant="destructive" disabled={disconnecting} onClick={() => void disconnectGithub()}>{disconnecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{disconnecting ? "Disconnecting…" : `Disconnect ${disconnectTarget?.githubOrg || "GitHub"}`}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {syncing ? <div role="status" className="mb-6 flex items-start gap-3 border bg-muted/30 p-4"><Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /><div><p className="text-sm font-medium">Syncing GitHub…</p><p className="mt-1 text-xs text-muted-foreground">Checking repositories and matching work to AI usage. This can take a few minutes.</p></div></div> : null}
      {notice ? <div role={notice.kind === "success" ? "status" : "alert"} className={`mb-6 flex items-start gap-3 border p-4 ${notice.kind === "error" ? "border-destructive/20 bg-destructive/5" : notice.kind === "warning" ? "bg-brand-yellow-pale" : "bg-muted/30"}`}>
        {notice.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{notice.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{notice.description}</p></div>
        <Button variant="ghost" size="sm" onClick={() => setNotice(null)} aria-label="Dismiss sync notification">Dismiss</Button>
      </div> : null}
      {data.connection.lastError && !notice && !syncing ? <div role="alert" className="mb-6 flex items-start gap-3 border bg-brand-yellow-pale p-4"><AlertCircle className="size-4 shrink-0" aria-hidden /><div><p className="text-sm font-medium">The last GitHub sync needs attention</p><p className="mt-1 text-xs text-muted-foreground">Open GitHub connection for details, then try Sync now.</p></div></div> : null}
      {data.connection.state === "syncing" && !syncing ? <div className="mb-6 flex items-start gap-3 border bg-muted/30 p-4"><Info className="size-4 shrink-0" aria-hidden /><div><p className="text-sm font-medium">Your work view is getting ready</p><p className="mt-1 text-xs text-muted-foreground">The first sync hasn’t completed yet. Use Sync now to fetch your GitHub work.</p></div></div> : null}

      {data.connection.state === "permission_required" ? (
        <Panel className="mb-6">
          <h2 className="text-base font-semibold">
            {permissionAccount?.needsMembers ? "Approve organization member access" : "Approve GitHub permissions"}
          </h2>
          {!data.canMapIdentities ? <p className="mt-2 text-sm text-muted-foreground">Ask a workspace admin to approve the GitHub App permissions, then sync again.</p> : permissionAccount?.needsMembers ? (
            <div className="mt-1 space-y-2 text-sm text-muted-foreground">
              <p>
                Member access is missing or awaiting approval{permissionAccount.githubOrg ? ` for ${permissionAccount.githubOrg}` : ""}. It lets UseJunction match organization authors to your team.
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Approve the requested Members permission in your GitHub organization’s installation settings.
                </li>
                <li>
                  If Members is not listed, ask the GitHub App owner to enable read-only Members access in App permissions. Then approve access and sync again.
                </li>
              </ol>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Cost per feature needs Contents and Pull requests read
              {permissionAccount?.githubOrg ? ` for ${permissionAccount.githubOrg}` : ""}.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {data.canMapIdentities && permissionAccount?.needsMembers && permissionAccount.appPermissionsUrl ? (
              <Button asChild>
                <a href={permissionAccount.appPermissionsUrl} target="_blank" rel="noreferrer">
                  Open App permissions
                </a>
              </Button>
            ) : null}
            {data.canMapIdentities && permissionAccount?.approveUrl ? (
              <Button asChild variant={permissionAccount.needsMembers ? "outline" : "default"}>
                <a href={permissionAccount.approveUrl} target="_blank" rel="noreferrer">
                  {permissionAccount.needsMembers ? "Approve on GitHub org" : "Approve permissions"}
                </a>
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {data.connection.state !== "none" ? (
        <>
          <FeatureSpendOverview data={data} />

          <FeatureWorkExplorer data={data} />

          {data.unmappedAuthors.length === 0 ? (
            <div id="github-authors" className="mb-6 flex items-center gap-2 border-b px-1 py-4 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-success" aria-hidden /><span>All GitHub authors matched to your team</span></div>
          ) : <Panel className="mb-6 mt-6" id="github-authors">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Users className="size-4 text-muted-foreground" aria-hidden /> Author matching {data.unmappedAuthors.length > 0 ? <span className="rounded-full bg-brand-yellow-pale px-2 py-0.5 text-xs">{data.unmappedAuthors.length} to review</span> : null}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Match GitHub authors to workspace members so their AI usage can be allocated to their work.
            </p>
            {data.unmappedAuthors.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No authors need matching.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.unmappedAuthors.map((author) => (
                  <li key={author.login} className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{author.login}</div>
                      <div className="text-sm text-muted-foreground">{author.commitCount} commits</div>
                    </div>
                    {data.canMapIdentities && author.identityId ? (
                      <Select
                        disabled={!!mappingLogin || syncing || disconnecting}
                        onValueChange={(value) => void mapAuthor(author.identityId, author.login, value === "none" ? null : value)}
                      >
                        <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={`Assign ${author.login}`} >
                          <SelectValue placeholder={mappingLogin === author.login ? "Assigning…" : "Assign workspace member"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {data.developers.map((developer) => (
                            <SelectItem key={developer.id} value={developer.id}>
                              {developer.name}{developer.id === author.suggestedDeveloperId ? " (suggested)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">{data.canMapIdentities ? "Sync GitHub to enable matching" : "Ask a workspace admin to assign this author"}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>}

          <details className="border-t py-4 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer font-medium text-foreground">How feature costs are calculated</summary>
            <p className="mt-3 max-w-3xl leading-5">Verified and estimated usage stay separate. Unattributed spend is already included in those totals. Matching spend to a commit does not mean it has a ticket.</p>
            <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-4">{data.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
          </details>
        </>
      ) : null}
    </div>
  );
}
