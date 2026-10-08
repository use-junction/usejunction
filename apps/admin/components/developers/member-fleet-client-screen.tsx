"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { ToolBrandLabel } from "@/components/tools/tool-brand-icon";
import { useMemberClientData } from "@/components/developers/member-client-layout";
import { formatCompactNumber, formatRelativeTime, formatUsd } from "@/lib/format";
import { canonicalToolKey } from "@/lib/tools/catalog";
import { signalsProductEnabled } from "@/lib/region";

export default function MemberFleetClientScreen() {
  const { developerId, personal, selectedPeriodLabel } = useMemberClientData();

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Fleet.</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The device reporting into this workspace, plus tool traffic for {selectedPeriodLabel}.
          </p>
        </div>
        {signalsProductEnabled() ? (
        <Link
          href={`/signals/activity?developerId=${encodeURIComponent(developerId)}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Open in Signals
          <ArrowUpRight className="size-3" />
        </Link>
        ) : null}
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <div className="mb-4">
            <h3 className="text-sm font-semibold tracking-tight">Device</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Agent version, last heartbeat, and last sync when available.
            </p>
          </div>
          {personal.developer.devices.length ? (
            <ul>
              {personal.developer.devices.map((device) => {
                const lastSeen = formatRelativeTime(device.lastSeenAt);
                const lastSync = formatRelativeTime(device.lastUsageSyncAt);
                const toolCount = new Set(device.tools.map((tool) => canonicalToolKey(tool.toolName))).size;
                return (
                  <li key={device.id} className="flex items-start justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{device.hostname}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {device.os}
                        {device.architecture ? ` · ${device.architecture}` : ""}
                        {" · "}
                        {toolCount} {toolCount === 1 ? "tool" : "tools"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Agent {device.agentVersion || "—"}
                        {device.remoteSyncProtocol < 1 ? (
                          <span className="font-medium text-warning"> · update needed</span>
                        ) : null}
                        {lastSeen ? ` · seen ${lastSeen}` : ""}
                        {lastSync ? ` · usage sync ${lastSync}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
              <EmptyDescription>No device enrolled yet.</EmptyDescription>
            </Empty>
          )}
        </section>

        <section>
          <div className="mb-4">
            <h3 className="text-sm font-semibold tracking-tight">By tool</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Detected on their device · {selectedPeriodLabel}.
            </p>
          </div>
          {personal.toolsUsage30d.length ? (
            <ul>
              {personal.toolsUsage30d.map((tool) => (
                <li key={canonicalToolKey(tool.toolName)} className="flex items-center justify-between gap-3 py-4">
                  <ToolBrandLabel
                    tool={tool.toolName}
                    light
                    subtitle={
                      [
                        tool.tokens > 0 ? `${formatCompactNumber(tool.tokens)} tokens` : "Detected",
                        tool.cost > 0 ? formatUsd(tool.cost) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || null
                    }
                  />
                  <p className="text-sm font-medium tabular-nums">{formatCompactNumber(tool.requests)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty className="min-h-0 gap-1 border-0 p-6 md:p-6">
              <EmptyDescription>No tools detected yet.</EmptyDescription>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
