import { DEFAULT_USAGE_RETENTION_DAYS, formatUsageRetention } from "@/lib/legal/versions";
import { formatCompactNumber } from "@/lib/format";
import { formatStoredUsageDay } from "@/lib/privacy/my-data-recency";
import type { MyDataSummary } from "@/lib/privacy/my-data-types";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

export function MyDataSummary({
  summary,
  region,
}: {
  summary: MyDataSummary;
  region: string | null;
  retentionDays: number | null;
}) {
  const lastHeard = summary.lastDeviceSeenAt
    ? new Date(summary.lastDeviceSeenAt).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "never";
  const latestUsage = summary.latestStoredUsageDay ? formatStoredUsageDay(summary.latestStoredUsageDay) : "none yet";
  const requests = summary.storedRequests ?? 0;

  return (
    <section aria-label="At a glance">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        {summary.usageCollectingCount} of {summary.accountCount} logins are sharing usage.
        Stored usage is daily totals, not live activity.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        <Fact
          label="Devices"
          value={`${summary.deviceCount} enrolled · last heard ${lastHeard}`}
        />
        <Fact label="Latest stored usage day" value={latestUsage} />
        <Fact
          label="Requests stored"
          value={requests > 0 ? `${formatCompactNumber(requests)} within retention` : "None yet"}
        />
        <Fact
          label="Workspace"
          value={`${(region ?? "us").toUpperCase()} · usage kept ${formatUsageRetention(DEFAULT_USAGE_RETENTION_DAYS)}`}
        />
      </dl>
    </section>
  );
}
