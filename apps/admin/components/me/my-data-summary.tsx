import { DEFAULT_USAGE_RETENTION_DAYS, formatUsageRetention } from "@/lib/legal/versions";
import { formatCompactNumber } from "@/lib/format";
import { formatStoredUsageDay } from "@/lib/privacy/my-data-recency";
import type { MyDataSummary } from "@/lib/privacy/my-data-types";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
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
    <section aria-label="At a glance" className="border-y py-3">
      <p className="text-sm">
        <span className="font-medium">{summary.usageCollectingCount} of {summary.accountCount} logins are sharing usage.</span>{" "}
        <span className="text-muted-foreground">Stored as daily totals, not live activity.</span>
      </p>
      <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs">
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
