"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { browserMutationInit, useInvalidateAppData } from "@/lib/api/client";
import { canManagePrivacy, type OrganizationRole } from "@/lib/rbac/permissions";
import { userFacingError } from "@/lib/errors/user-facing";

export function MemberPrivacyActions({
  developerId,
  role,
}: {
  developerId: string;
  role: OrganizationRole;
}) {
  const router = useRouter();
  const invalidateAppData = useInvalidateAppData();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!canManagePrivacy(role)) return null;

  async function erase() {
    if (!window.confirm("Erase this member's personal data? This cannot be undone.")) return;
    setPending(true);
    setError(null);
    const response = await fetch(
      `/api/app/developers/${encodeURIComponent(developerId)}/privacy/erase`,
      browserMutationInit("POST"),
    );
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(userFacingError(body.error, "Could not erase this member."));
      return;
    }
    await invalidateAppData();
    router.push("/team");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm" className="rounded-none">
        <a href={`/api/app/developers/${encodeURIComponent(developerId)}/privacy/export`}>
          Export data
        </a>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={pending}
        onClick={() => void erase()}
      >
        Erase data
      </Button>
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
