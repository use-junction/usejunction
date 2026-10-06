"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SignalsSectionHeader } from "@/components/signals/signals-ui";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import type {
  DeviceActivityFeed as DeviceActivityFeedData,
  DeviceActivityItem,
} from "@/lib/queries/activity/device-activity-types";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ScrollFadeList } from "./scroll-fade-list";

function itemBadge(item: DeviceActivityItem): {
  label: string;
  variant: "success" | "warning" | "error" | "default";
} {
  if (item.kind === "heartbeat") {
    return { label: "heartbeat", variant: "default" };
  }
  if (item.status === "error" || item.errorCode) {
    return { label: item.errorCode ?? "error", variant: "error" };
  }
  if (item.source === "observed") {
    return { label: item.kind.split("_")[0] ?? "observed", variant: "default" };
  }
  return { label: item.kind.replaceAll("_", " "), variant: "default" };
}

function detailLines(item: DeviceActivityItem): string[] {
  const lines: string[] = [];
  const details = item.details;

  const pushList = (label: string, value: unknown) => {
    if (Array.isArray(value) && value.length) {
      const rendered = value
        .slice(0, 8)
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            const row = entry as Record<string, unknown>;
            return [
              row.toolName ?? row.modelName ?? row.model ?? row.provider ?? row.date,
              row.email,
              row.plan,
              row.version,
              row.windowType,
              row.title,
              typeof row.requests === "number" ? `${row.requests} req` : null,
              typeof row.tokens === "number" ? `${row.tokens} tok` : null,
            ]
              .filter(Boolean)
              .join(" · ");
          }
          return String(entry);
        })
        .filter(Boolean);
      if (rendered.length) lines.push(`${label}: ${rendered.join("; ")}`);
    }
  };

  if (typeof details.hostname === "string") {
    lines.push(`Host: ${details.hostname}`);
  }
  pushList("Tools", details.names ?? details.tools);
  pushList("Models", details.models ?? details.sample);
  pushList("Accounts", details.sample);
  pushList("Quotas", details.sample);
  if (typeof details.toolName === "string") {
    lines.push(
      [
        details.toolName,
        typeof details.model === "string" ? details.model : null,
        typeof details.title === "string" ? details.title : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  if (typeof details.aiTool === "string") {
    lines.push(
      [
        details.domainBefore ?? details.appBefore ?? "unknown",
        details.aiTool,
        details.domainAfter ?? details.appAfter ?? "unknown",
      ]
        .map(String)
        .join(" → "),
    );
  }
  if (typeof details.eventType === "string") {
    lines.push(`Event: ${details.eventType.replaceAll("_", " ")}`);
  }
  if (item.durationMs != null) {
    lines.push(`Duration: ${item.durationMs < 1000 ? `${item.durationMs}ms` : `${Math.round(item.durationMs / 1000)}s`}`);
  }
  if (typeof details.href === "string") {
    lines.push(`Open: ${details.href}`);
  }

  return lines.slice(0, 12);
}

function InspectPayload({ item }: { item: DeviceActivityItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
      >
        Inspect payload
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 space-y-3">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Requested</p>
            <pre className="overflow-x-auto bg-muted/40 p-3 font-mono text-[11px] leading-5 text-foreground/90">
              {JSON.stringify(item.inspect.requestSummary, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Returned</p>
            <pre className="overflow-x-auto bg-muted/40 p-3 font-mono text-[11px] leading-5 text-foreground/90">
              {JSON.stringify(item.inspect.responseSummary, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EventDetails({ item }: { item: DeviceActivityItem }) {
  const lines = detailLines(item);
  const href = typeof item.details.href === "string" ? item.details.href : null;

  return (
    <div className="mt-4 space-y-3 border-t border-border/70 pt-4 text-xs">
      <div>
        <p className="mb-2 font-medium uppercase tracking-[0.06em] text-muted-foreground">What happened</p>
        {lines.length ? (
          <ul className="space-y-1.5 font-mono text-[11px] leading-5 text-foreground/90">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{item.summary}</p>
        )}
        {href ? (
          <p className="mt-2">
            <Link href={href} className="text-xs underline underline-offset-2">
              Open work session
            </Link>
          </p>
        ) : null}
      </div>
      <InspectPayload item={item} />
    </div>
  );
}

function FeedRow({
  item,
  showDeveloper,
}: {
  item: DeviceActivityItem;
  showDeveloper: boolean;
}) {
  const [open, setOpen] = useState(false);
  const badge = itemBadge(item);

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-3 px-3 py-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium capitalize">{item.title}</p>
            <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
            <ChevronDown
              className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")}
            />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{item.summary}</p>
          {showDeveloper && item.developer ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.developer.name} · {item.developer.email}
            </p>
          ) : null}
          {item.errorCode ? (
            <p className="mt-1 font-mono text-[11px] text-destructive">{item.errorCode}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">{formatRelativeTime(item.at)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">{formatDateTime(item.at)}</p>
        </div>
      </button>
      {open ? (
        <div className="px-3 pb-4">
          <EventDetails item={item} />
        </div>
      ) : null}
    </li>
  );
}

function feedStatusSummary(items: DeviceActivityItem[]) {
  if (!items.length) {
    return { line: "No device exchanges or observed activity yet.", count: 0 };
  }

  const latestHeartbeat = items.find((item) => item.kind === "heartbeat");
  const latestExchange = items.find((item) => item.source === "exchange" && item.kind !== "heartbeat");
  const parts: string[] = [];

  if (latestHeartbeat) {
    parts.push(`${latestHeartbeat.device.hostname} heartbeat · ${formatRelativeTime(latestHeartbeat.at)}`);
  }
  if (latestExchange) {
    parts.push(`Last ${latestExchange.title.toLowerCase()} ${formatRelativeTime(latestExchange.at)}`);
  }
  if (!parts.length) {
    parts.push(`Latest event ${formatRelativeTime(items[0]!.at)}`);
  }

  return {
    line: parts.join(" · "),
    count: items.length,
  };
}

export function DeviceActivityFeed({
  feed,
  showDeveloper = false,
}: {
  feed: DeviceActivityFeedData;
  showDeveloper?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = useMemo(() => feedStatusSummary(feed.items), [feed.items]);

  return (
    <>
      <Panel as="section" className="mt-10">
        <SignalsSectionHeader
          title="Device activity."
          description="Requests UseJunction made to connected machines, what came back, and observed activity on those machines."
          bordered={false}
          action={
            feed.items.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-none"
                onClick={() => setOpen(true)}
              >
                View device activity
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{status.line}</p>
        </div>
        {status.count > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {status.count} {status.count === 1 ? "event" : "events"} in the recent feed
            {feed.presenceFallback ? " (presence fallback until the next collect)." : "."}
          </p>
        ) : null}
      </Panel>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b border-border/70 p-5 text-left">
            <SheetTitle className="text-lg font-semibold tracking-tight">Device activity</SheetTitle>
            <SheetDescription>
              Machine exchanges UseJunction requested and what was returned, plus gateway requests when
              available. Open a row for details and Inspect for the sanitized payload.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden p-5">
            {feed.items.length ? (
              <ScrollFadeList
                maxHeightClassName="max-h-[calc(100vh-10rem)]"
                countLabel={
                  feed.items.length === 1
                    ? "Showing 1 recent event"
                    : `Showing ${feed.items.length} recent events`
                }
              >
                <ul>
                  {feed.items.map((item) => (
                    <FeedRow key={item.id} item={item} showDeveloper={showDeveloper} />
                  ))}
                </ul>
              </ScrollFadeList>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">
                No device exchanges or observed activity yet.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export { ScrollableMetricList } from "./scroll-fade-list";
