"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { browserMutationInit, useInvalidateAppData } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors/user-facing";

const OPTIONS = [
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1095, label: "3 years" },
] as const;

type PrivacySettings = { usageRetentionDays: number; dataRegion: string; enforcementEnabled?: boolean };

/** How long daily usage is kept before the retention job removes it. Owners and admins only. */
export function DataRetentionSettingsCard() {
  const invalidateAppData = useInvalidateAppData();
  // This route answers with a bare object rather than the { data } envelope.
  const query = useQuery<PrivacySettings>({
    queryKey: ["app", "settings", "privacy"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/app/settings/privacy", { credentials: "same-origin", signal });
      if (!response.ok) throw new Error("Could not load retention settings.");
      return (await response.json()) as PrivacySettings;
    },
  });
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = query.data ? String(query.data.usageRetentionDays) : null;
  const selected = value ?? current;
  const enforced = Boolean(query.data?.enforcementEnabled);
  const shorter = enforced && selected && current && Number(selected) < Number(current);

  async function save() {
    if (!selected) return;
    setSaving(true);
    const response = await fetch(
      "/api/app/settings/privacy",
      browserMutationInit("PATCH", { usageRetentionDays: Number(selected) }),
    );
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      toast.error(userFacingError(body.error, "Could not save retention."));
      return;
    }
    toast.success("Retention updated.");
    setValue(null);
    await query.refetch();
    await invalidateAppData();
  }

  return (
    <Panel as="section" className="sm:p-6" aria-labelledby="data-retention-heading">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div>
          <h2 id="data-retention-heading" className="text-lg font-semibold tracking-tight">Data retention.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How long daily usage totals are kept for this workspace. Members see this period on My data.
          </p>
        </div>
        <div className="space-y-3">
          {query.data ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Select value={selected ?? undefined} onValueChange={setValue}>
                  <SelectTrigger className="h-9 w-44 rounded-none" aria-label="Keep usage for">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPTIONS.map((option) => (
                      <SelectItem key={option.days} value={String(option.days)}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button className="rounded-none" size="sm" disabled={saving || !value || value === current} onClick={() => void save()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : "Save retention"}
                </Button>
              </div>
              {shorter ? (
                <p className="text-sm text-warning">
                  Usage older than the new limit will be deleted on the next run. This cannot be undone.
                </p>
              ) : null}
              {!enforced ? (
                <p className="text-sm text-muted-foreground">
                  Automatic deletion of older usage is not switched on for this deployment yet, so this sets the published policy only.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">Data region: {query.data.dataRegion.toUpperCase()}. Changes are recorded in the audit log.</p>
            </>
          ) : query.isError ? (
            <p className="text-sm text-muted-foreground">Retention settings are unavailable right now.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
