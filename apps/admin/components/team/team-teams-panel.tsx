"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserMutationInit, useAppQuery, useInvalidateAppData } from "@/lib/api/client";
import { teamsKey } from "@/lib/app-pages/query-keys";
import { userFacingError } from "@/lib/errors/user-facing";
import type { TeamSummary } from "@/lib/teams";
import { cn } from "@/lib/utils";

const TEAM_COLORS = ["#0F766E", "#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#CA8A04", "#16A34A", "#64748B"];

type Editing = { mode: "create" } | { mode: "rename"; team: TeamSummary } | { mode: "delete"; team: TeamSummary } | null;

/** Teams group people for rollups. One team per person, so team totals never double count. */
export function TeamTeamsPanel({ canManage }: { canManage: boolean }) {
  const invalidateAppData = useInvalidateAppData();
  const query = useAppQuery<{ teams: TeamSummary[] }>(teamsKey, "/api/app/teams");
  const teams = query.data?.teams ?? [];
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TEAM_COLORS[0]!);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: Editing) {
    setError(null);
    setEditing(next);
    if (next?.mode === "rename") {
      setName(next.team.name);
      setColor(next.team.color ?? TEAM_COLORS[0]!);
    } else if (next?.mode === "create") {
      setName("");
      setColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]!);
    }
  }

  async function submit() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    const response = editing.mode === "create"
      ? await fetch("/api/app/teams", browserMutationInit("POST", { name, color }))
      : editing.mode === "rename"
        ? await fetch(`/api/app/teams/${encodeURIComponent(editing.team.id)}`, browserMutationInit("PATCH", { name, color }))
        : await fetch(`/api/app/teams/${encodeURIComponent(editing.team.id)}`, browserMutationInit("DELETE"));
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setError(userFacingError(body.error, "Could not save the team."));
      return;
    }
    toast.success(editing.mode === "create" ? `Created ${name.trim()}.` : editing.mode === "rename" ? "Team updated." : `Deleted ${editing.team.name}.`);
    setEditing(null);
    await invalidateAppData();
  }

  return (
    <Panel as="section" padded={false}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-muted/25 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Teams.</h2>
          <p className="mt-1.5 max-w-xl text-xs text-muted-foreground">
            Group people by squad, department or cost centre. Overview, Adoption and Cost can then be filtered by team. Each person is on one team.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" className="rounded-none" onClick={() => open({ mode: "create" })}>
            <Plus className="size-4" aria-hidden /> New team
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Loading teams…</p>
      ) : !teams.length ? (
        <Empty className="min-h-0 gap-1 border-0 px-5 py-8 md:px-5 md:py-8">
          <EmptyDescription>
            {canManage ? "No teams yet. Create one, then move people into it from Members." : "No teams yet. An owner or admin can create them."}
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="divide-y">
          {teams.map((team) => (
            <li key={team.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="size-3 shrink-0" style={{ background: team.color ?? "var(--muted-foreground)" }} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{team.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {team.memberCount} {team.memberCount === 1 ? "person" : "people"}
                  </span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-3">
                <Link href={`/team?team=${encodeURIComponent(team.id)}`} className="text-xs hover:underline">Members</Link>
                <Link href={`/overview?team=${encodeURIComponent(team.id)}`} className="inline-flex items-center gap-0.5 text-xs hover:underline">
                  Overview <ArrowRight className="size-3" aria-hidden />
                </Link>
                {canManage ? (
                  <>
                    <Button variant="ghost" size="sm" className="h-8 rounded-none px-2" aria-label={`Edit ${team.name}`} onClick={() => open({ mode: "rename", team })}>
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 rounded-none px-2 text-destructive hover:text-destructive" aria-label={`Delete ${team.name}`} onClick={() => open({ mode: "delete", team })}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => { if (!next && !saving) setEditing(null); }}>
        <DialogContent className="max-w-md gap-5 rounded-none">
          {editing?.mode === "delete" ? (
            <DialogHeader>
              <DialogTitle>Delete {editing.team.name}?</DialogTitle>
              <DialogDescription>
                Its {editing.team.memberCount} {editing.team.memberCount === 1 ? "person moves" : "people move"} to No team. Their usage and seats are not touched.
              </DialogDescription>
            </DialogHeader>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{editing?.mode === "rename" ? "Edit team" : "New team"}</DialogTitle>
                <DialogDescription>A short name people recognise, like Platform or Payments.</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="team-name">Name</Label>
                  <Input id="team-name" value={name} maxLength={60} autoFocus onChange={(event) => setName(event.target.value)} className="rounded-none" />
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Colour</legend>
                  <div className="flex flex-wrap gap-2">
                    {TEAM_COLORS.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        aria-label={`Colour ${swatch}`}
                        aria-pressed={color === swatch}
                        onClick={() => setColor(swatch)}
                        className={cn("size-7 border-2", color === swatch ? "border-foreground" : "border-transparent")}
                        style={{ background: swatch }}
                      />
                    ))}
                  </div>
                </fieldset>
              </form>
            </>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button
              variant={editing?.mode === "delete" ? "destructive" : "default"}
              className="rounded-none"
              disabled={saving || (editing?.mode !== "delete" && !name.trim())}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing?.mode === "delete" ? "Delete team" : editing?.mode === "rename" ? "Save" : "Create team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
