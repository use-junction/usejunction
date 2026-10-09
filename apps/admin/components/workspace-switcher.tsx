"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkspaceColorSwatches, WorkspaceIcon } from "@/components/workspace-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { userFacingError } from "@/lib/errors/user-facing";
import { activateWorkspace } from "@/lib/api/client";
import { canManageSettings } from "@/lib/rbac/permissions";
import {
  WORKSPACE_COLORS,
  resolveWorkspaceColor,
  type WorkspaceColor,
} from "@/lib/workspace-colors";
import { cn } from "@/lib/utils";

const CREATE_WORKSPACE_VALUE = "__create_workspace__";
const EDIT_WORKSPACE_VALUE = "__edit_workspace__";

export type WorkspaceOption = {
  id: string;
  name: string;
  color?: string | null;
  role: string;
};

type WorkspaceFormMode = "create" | "edit";

export function WorkspaceSwitcher({
  organizations,
  currentOrgId,
  role,
  className,
}: {
  organizations: WorkspaceOption[];
  currentOrgId: string | null;
  role?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const value = currentOrgId ?? organizations[0]?.id;
  const current = organizations.find((org) => org.id === value) ?? organizations[0];
  const canEdit = canManageSettings(role as "owner" | "admin" | "manager" | "user" | null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<WorkspaceFormMode>("create");
  const [name, setName] = useState("");
  const [color, setColor] = useState<WorkspaceColor>(WORKSPACE_COLORS[2]!);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function openCreate() {
    setFormMode("create");
    setName("");
    setColor(WORKSPACE_COLORS[2]!);
    setError(null);
    setFormOpen(true);
  }

  function openEdit() {
    if (!current) return;
    setFormMode("edit");
    setName(current.name);
    setColor(resolveWorkspaceColor(current.id, current.color));
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setName("");
    setColor(WORKSPACE_COLORS[2]!);
    setError(null);
  }

  async function switchWorkspace(orgId: string) {
    if (orgId === value) return;
    try {
      await activateWorkspace(orgId);
      queryClient.clear();
      // The role can differ per workspace, so let the server pick the right home.
      window.location.assign("/auth/continue?from=%2Fdashboard");
    } catch {
      // Keep the current workspace selected when the server rejects the switch.
    }
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a workspace name.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      if (formMode === "create") {
        const response = await fetch("/api/organizations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed, color }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; orgId?: string };
        if (!response.ok) {
          setError(userFacingError(payload.error, "Could not create workspace."));
          return;
        }
        if (!payload.orgId) {
          setError("Could not activate the new workspace.");
          return;
        }
        await activateWorkspace(payload.orgId);
        closeForm();
        queryClient.clear();
        router.push("/onboarding?resume=1");
        router.refresh();
        return;
      }

      const response = await fetch("/api/organizations/current", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, color }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(userFacingError(payload.error, "Could not update workspace."));
        return;
      }
      closeForm();
      await queryClient.invalidateQueries({ queryKey: ["app"] });
      router.refresh();
    } catch {
      setError(formMode === "create" ? "Could not create workspace." : "Could not update workspace.");
    } finally {
      setPending(false);
    }
  }

  if (!organizations.length || !value || !current) {
    return (
      <Skeleton
        className={cn("h-9 w-[clamp(5.25rem,27vw,9rem)] sm:h-9 sm:w-48", className)}
        aria-hidden
      />
    );
  }

  return (
    <>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === CREATE_WORKSPACE_VALUE) {
            openCreate();
            return;
          }
          if (next === EDIT_WORKSPACE_VALUE) {
            openEdit();
            return;
          }
          void switchWorkspace(next);
        }}
      >
        <SelectTrigger
          size="sm"
          className={cn(
            "h-9 min-w-[12rem] max-w-[18rem] border-border bg-background text-sm font-medium text-foreground shadow-none",
            className,
          )}
          aria-label="Workspace"
        >
          <SelectValue placeholder="Select workspace" />
        </SelectTrigger>
        <SelectContent position="popper">
          {organizations.map((org) => (
            <SelectItem key={org.id} value={org.id}>
              <WorkspaceIcon id={org.id} color={org.color} />
              <span className="truncate">{org.name}</span>
            </SelectItem>
          ))}
          <SelectSeparator />
          {canEdit ? (
            <SelectItem value={EDIT_WORKSPACE_VALUE}>
              <Pencil className="size-4" />
              Edit workspace
            </SelectItem>
          ) : null}
          <SelectItem value={CREATE_WORKSPACE_VALUE}>
            <Plus className="size-4" />
            Create workspace
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (open) setFormOpen(true);
          else closeForm();
        }}
      >
        <DialogContent className="max-w-md gap-5">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" ? "Create a workspace." : "Edit workspace."}
            </DialogTitle>
            <DialogDescription>
              {formMode === "create"
                ? "Start a separate organization for another team, product, or client."
                : "Update the name and color for this workspace."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitForm}>
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <div className="flex items-center gap-3">
                <WorkspaceIcon
                  id={formMode === "edit" ? current.id : "new-workspace"}
                  color={color}
                  size="lg"
                />
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acme"
                  autoFocus
                  maxLength={80}
                  disabled={pending}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <WorkspaceColorSwatches value={color} onChange={setColor} disabled={pending} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeForm} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending
                  ? formMode === "create"
                    ? "Creating…"
                    : "Saving…"
                  : formMode === "create"
                    ? "Create workspace"
                    : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
