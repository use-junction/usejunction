"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/panel";
import { userFacingError } from "@/lib/errors/user-facing";

const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** Every IANA zone the browser knows, so nobody is stuck with a neighbouring city's offset. */
function allTimeZones(): string[] {
  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (zones?.length) return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
  } catch {
    // Older browsers: fall back to the common list below.
  }
  return COMMON_TIMEZONES;
}

export type EmailReportsPrefs = {
  timeZone: string;
  timeZoneManual: boolean;
  role: string;
  dailyPersonalEnabled: boolean;
  dailyOrgEnabled: boolean;
};

export function EmailReportsSettingsCard({ initial }: { initial: EmailReportsPrefs }) {
  const [timeZone, setTimeZone] = useState(initial.timeZone || "UTC");
  const [personal, setPersonal] = useState(initial.dailyPersonalEnabled);
  const [org, setOrg] = useState(initial.dailyOrgEnabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const showOrg = initial.role === "owner" || initial.role === "admin";

  const [available] = useState(allTimeZones);
  const zones = available.includes(timeZone) ? available : [timeZone, ...available];

  function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const response = await fetch("/api/app/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeZone,
          dailyPersonalEnabled: personal,
          dailyOrgEnabled: org,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string } | string;
        data?: EmailReportsPrefs;
      };
      if (!response.ok || !body.data) {
        const message = typeof body.error === "string" ? body.error : body.error?.message;
        setError(userFacingError(message, "Could not save email report settings."));
        return;
      }
      setTimeZone(body.data.timeZone);
      setPersonal(body.data.dailyPersonalEnabled);
      setOrg(body.data.dailyOrgEnabled);
      setSaved(true);
    });
  }

  return (
    <Panel as="section" className="sm:p-6" aria-labelledby="email-reports-heading">
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <div>
          <h2 id="email-reports-heading" className="text-base font-semibold tracking-tight">
            Email reports.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You get a daily email at 19:00 local. Team digests land Sundays at 19:00 with the week’s numbers.
            Turn either off anytime.
          </p>
        </div>
        <form className="space-y-5" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="report-timezone">Timezone</Label>
            <select
              id="report-timezone"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Detected from your browser or connected machine. Saving here locks the timezone.
            </p>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
            <span>
              <span className="block text-sm font-medium">You — daily report</span>
              <span className="block text-xs text-muted-foreground">Your usage for the local day.</span>
            </span>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={personal}
              onChange={(e) => setPersonal(e.target.checked)}
            />
          </label>

          {showOrg ? (
            <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
              <span>
                <span className="block text-sm font-medium">Team — weekly report</span>
                <span className="block text-xs text-muted-foreground">
                  Mon–Sun org rollup for owners and admins. Sent Sundays at 19:00.
                </span>
              </span>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={org}
                onChange={(e) => setOrg(e.target.checked)}
              />
            </label>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {saved ? (
            <p className="text-sm text-muted-foreground" role="status">
              Saved.
            </p>
          ) : null}

          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save email reports
          </Button>
        </form>
      </div>
    </Panel>
  );
}
