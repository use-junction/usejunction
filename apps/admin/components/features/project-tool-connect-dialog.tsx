"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Loader2, RefreshCw, Unplug } from "lucide-react";
import { GitHubProjectsButtonLabel } from "@/components/features/integration-provider-logos";
import { toast } from "sonner";
import { browserMutationInit, useAppQuery, useInvalidateAppData } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Project = { id: string; number: number; title: string; url: string; accountLogin?: string; connectionId?: string };
type Selected = { id: string; externalId: string; title: string; syncStatus: string; lastError: string | null };
type Picker = { state: "available" | "not_connected" | "personal_account" | "permission_required"; available: Project[]; selected: Selected[]; canManage: boolean };

function PickerContent({ close, approveUrl, appPermissionsUrl }: { close: () => void; approveUrl?: string | null; appPermissionsUrl?: string | null }) {
  const query = useAppQuery<Picker>(["app", "github-projects-picker"], "/api/app/project-tools/github-projects");
  const invalidate = useInvalidateAppData();
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "sync" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const picker = query.data;
  useEffect(() => { if (picker) setDraft(picker.selected.filter((row) => picker.available.some((project) => project.id === row.externalId)).map((row) => row.externalId)); }, [picker]);

  async function mutate(kind: "save" | "sync" | "disconnect") {
    if (busy) return;
    setBusy(kind);
    const label = kind === "save" ? "Saving GitHub Projects…" : kind === "sync" ? "Syncing GitHub Projects…" : "Disconnecting GitHub Projects…";
    const toastId = toast.loading(label);
    try {
      const path = kind === "save" ? "/api/app/project-tools/github-projects" : "/api/app/project-tools/github-projects/" + kind;
      const response = await fetch(path, browserMutationInit(kind === "save" ? "PUT" : "POST", kind === "save" ? { projectIds: draft } : undefined));
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "Could not update GitHub Projects.");
      await invalidate();
      await query.refetch();
      if (kind === "disconnect") {
        toast.success("GitHub Projects disconnected", { id: toastId, description: "Imported Project titles and statuses were removed." });
        setConfirmDisconnect(false);
        close();
      } else if ((body?.data?.sync?.failed ?? body?.data?.failed ?? 0) > 0) {
        toast.warning("Projects partially synced", { id: toastId, description: "Some Projects could not be refreshed. Check their status here." });
      } else toast.success(kind === "save" ? "Project selection saved" : "GitHub Projects synced", { id: toastId });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update GitHub Projects.", { id: toastId }); }
    finally { setBusy(null); }
  }

  return <>
    <DialogHeader><DialogTitle>{confirmDisconnect ? "Disconnect GitHub Projects?" : "GitHub Projects"}</DialogTitle><DialogDescription>{confirmDisconnect ? "This affects everyone in the workspace." : "Choose organization Projects to show issue titles and status alongside linked work."}</DialogDescription></DialogHeader>
    {confirmDisconnect ? <>
      <p className="border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6">Selected Projects and imported item titles, statuses, and links will be removed from UseJunction. GitHub commits, pull requests, and cost allocations stay intact. This does not uninstall the GitHub App.</p>
      <DialogFooter><Button type="button" variant="outline" disabled={!!busy} onClick={() => setConfirmDisconnect(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={!!busy} onClick={() => void mutate("disconnect")}>{busy === "disconnect" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Unplug className="size-4" aria-hidden />}Disconnect GitHub Projects</Button></DialogFooter>
    </> : <>
      {query.isPending ? <p role="status" className="border-y py-5 text-sm text-muted-foreground">Loading Projects…</p> : query.error ? <p role="alert" className="border-y py-5 text-sm text-destructive">Could not load Projects. Close and retry.</p> : picker?.state === "not_connected" ? <p className="border-y py-5 text-sm text-muted-foreground">Connect GitHub first.</p> : picker?.state === "personal_account" ? <p className="border-y py-5 text-sm text-muted-foreground">Organization Projects require a GitHub organization installation. Personal Projects are not available yet.</p> : picker?.state === "permission_required" ? <div className="border-y py-5 text-sm"><p>The GitHub App needs organization Projects: read. An App owner must add that permission, then the organization installation owner must approve it.</p>{picker.canManage ? <div className="mt-3 flex flex-wrap gap-2">{appPermissionsUrl ? <Button asChild variant="outline" size="sm"><a href={appPermissionsUrl} target="_blank" rel="noreferrer">Configure App permissions <ArrowUpRight className="size-4" aria-hidden /></a></Button> : null}{approveUrl ? <Button asChild variant="outline" size="sm"><a href={approveUrl} target="_blank" rel="noreferrer">Approve installation <ArrowUpRight className="size-4" aria-hidden /></a></Button> : null}</div> : <p className="mt-2 text-xs text-muted-foreground">Ask a workspace admin to arrange GitHub App access.</p>}{picker.canManage && picker.selected.length ? <Button type="button" variant="ghost" size="sm" className="mt-3 text-destructive" onClick={() => setConfirmDisconnect(true)}>Disconnect selected Projects…</Button> : null}</div> : picker ? <>
        <div className="max-h-72 overflow-y-auto border-y divide-y">
          {picker.available.length ? picker.available.map((project) => {
            const selected = picker.selected.find((row) => row.externalId === project.id);
            return <label key={project.id} className="flex cursor-pointer items-start gap-3 py-3 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={draft.includes(project.id)} disabled={!picker.canManage || !!busy} onChange={(event) => setDraft((old) => event.target.checked ? [...old, project.id] : old.filter((id) => id !== project.id))} /><span className="min-w-0 flex-1"><span className="block break-words font-medium">{project.title}</span><span className="block text-xs text-muted-foreground">{project.accountLogin ? `${project.accountLogin} · ` : ""}#{project.number}{selected ? " · " + (selected.syncStatus === "available" ? "Synced" : selected.syncStatus.replaceAll("_", " ")) : ""}</span>{selected?.lastError ? <span role="alert" className="mt-1 block text-xs text-destructive">{selected.lastError}</span> : null}</span></label>;
          }) : <p className="py-5 text-sm text-muted-foreground">No organization Projects are available to this installation.</p>}
          {picker.selected.filter((row) => !picker.available.some((project) => project.id === row.externalId)).map((row) => <div key={row.id} className="py-3 text-sm"><p className="font-medium">{row.title} · Access changed</p><p className="text-xs text-muted-foreground">Save this selection to remove it.</p></div>)}
        </div>
        <p className="text-xs text-muted-foreground">Only Issues and pull requests from granted repositories appear in Work &amp; spend. Descriptions are not imported.</p>
        {picker.canManage ? <DialogFooter className="flex-wrap sm:justify-between"><div className="flex gap-2">{picker.selected.length ? <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void mutate("sync")}><RefreshCw className={busy === "sync" ? "size-4 animate-spin" : "size-4"} aria-hidden />Sync</Button> : null}{picker.selected.length ? <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}>Disconnect…</Button> : null}</div><Button type="button" size="sm" disabled={!!busy || JSON.stringify([...draft].sort()) === JSON.stringify(picker.selected.map((row) => row.externalId).sort())} onClick={() => void mutate("save")}>{busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}Save selection</Button></DialogFooter> : <p className="text-xs text-muted-foreground">A workspace admin can change selected Projects.</p>}
      </> : null}
    </>}
  </>;
}

export function ProjectToolConnectDialog({ children, approveUrl, appPermissionsUrl }: { children?: ReactNode; approveUrl?: string | null; appPermissionsUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{children ?? <Button type="button" variant="outline" size="sm" className="rounded-none"><GitHubProjectsButtonLabel>Connect GitHub Projects</GitHubProjectsButtonLabel></Button>}</DialogTrigger><DialogContent className="sm:max-w-md">{open ? <PickerContent close={() => setOpen(false)} approveUrl={approveUrl} appPermissionsUrl={appPermissionsUrl} /> : null}</DialogContent></Dialog>;
}
