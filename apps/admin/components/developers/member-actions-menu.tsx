"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, MoreHorizontal, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { browserMutationInit, useInvalidateAppData } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors/user-facing";
import { canManagePrivacy, type OrganizationRole } from "@/lib/rbac/permissions";

type Pending = "remove" | "erase" | null;

const COPY = {
  remove: {
    title: (name: string) => `Remove ${name}?`,
    body: "They lose workspace access, their device is removed from coverage, and the agent uninstalls on the next heartbeat. Usage history and extracted work stay on this workspace.",
    confirm: "Remove",
    fallback: "Could not remove member.",
  },
  erase: {
    title: (name: string) => `Erase ${name}'s personal data?`,
    body: "Deletes or anonymises their personal data in this workspace. This cannot be undone. Export first if you need a copy.",
    confirm: "Erase data",
    fallback: "Could not erase this member.",
  },
} as const;

/** Rarely used, destructive member actions live behind one menu instead of in the page header. */
export function MemberActionsMenu({
  developerId,
  memberName,
  memberRole,
  viewerRole,
}: {
  developerId: string;
  memberName: string;
  memberRole: OrganizationRole;
  viewerRole: OrganizationRole;
}) {
  const router = useRouter();
  const invalidateAppData = useInvalidateAppData();
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRemove = memberRole !== "owner";
  const canPrivacy = canManagePrivacy(viewerRole);
  if (!canRemove && !canPrivacy) return null;

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    const response = pending === "remove"
      ? await fetch(`/api/developers/${encodeURIComponent(developerId)}`, browserMutationInit("DELETE"))
      : await fetch(`/api/app/developers/${encodeURIComponent(developerId)}/privacy/erase`, browserMutationInit("POST"));
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(userFacingError(body.error, COPY[pending].fallback));
      setSaving(false);
      return;
    }
    setSaving(false);
    setPending(null);
    await invalidateAppData();
    router.push("/team");
    router.refresh();
  }

  const copy = pending ? COPY[pending] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="rounded-none" aria-label={`More actions for ${memberName}`}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {canPrivacy ? (
            <DropdownMenuItem asChild>
              <a href={`/api/app/developers/${encodeURIComponent(developerId)}/privacy/export`}>
                <Download className="size-4" aria-hidden /> Export their data
              </a>
            </DropdownMenuItem>
          ) : null}
          {canPrivacy && canRemove ? <DropdownMenuSeparator /> : null}
          {canRemove ? (
            <DropdownMenuItem variant="destructive" onSelect={() => { setError(null); setPending("remove"); }}>
              <UserMinus className="size-4" aria-hidden /> Remove from team
            </DropdownMenuItem>
          ) : null}
          {canPrivacy ? (
            <DropdownMenuItem variant="destructive" onSelect={() => { setError(null); setPending("erase"); }}>
              <Trash2 className="size-4" aria-hidden /> Erase personal data
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (saving) return;
          if (!next) {
            setPending(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-md gap-5">
          {copy ? (
            <>
              <DialogHeader>
                <DialogTitle>{copy.title(memberName)}</DialogTitle>
                <DialogDescription>{copy.body}</DialogDescription>
              </DialogHeader>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => void confirm()} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : copy.confirm}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
