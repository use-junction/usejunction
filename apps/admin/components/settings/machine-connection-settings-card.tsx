"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Cable, TriangleAlert } from "lucide-react";
import { RepairConnectionDialog, type RepairDeviceTarget } from "@/components/dashboard/repair-connection-dialog";
import { DeviceConnectCard } from "@/components/onboarding/device-connect-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppPageQuery, useInvalidateAppData } from "@/lib/api/client";
import { meDevicesKey } from "@/lib/app-pages/query-keys";
import type { DeviceHealthState } from "@/lib/devices/health";
import { formatRelativeTime } from "@/lib/format";

export type MeDeviceSummary = {
  id: string;
  hostname: string;
  os: string;
  architecture: string;
  lastSeenAt: string;
  state: DeviceHealthState;
  // The macOS agent still runs from the legacy hidden location (~/.usejunction).
  // Reconnecting converges it on ~/Applications and clears EDR false positives.
  legacyLocation?: boolean;
};

export type MeDevicesPayload = {
  devices: MeDeviceSummary[];
};

const STATE_LABELS: Record<DeviceHealthState, string> = {
  online: "Online",
  auto_recovery: "Stale",
  repair_required: "Needs repair",
};

export function MachineConnectionSettingsCard() {
  const router = useRouter();
  const invalidateAppData = useInvalidateAppData();
  const devicesQuery = useAppPageQuery<MeDevicesPayload>(meDevicesKey, "/api/app/me/devices");
  const [repairDevice, setRepairDevice] = useState<RepairDeviceTarget | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const noDeveloper = devicesQuery.error?.code === "LINKED_DEVELOPER_REQUIRED";
  const devices = devicesQuery.data?.devices ?? [];
  const showConnect = noDeveloper || devices.length === 0;
  const blockingError = devicesQuery.error && !noDeveloper && !devicesQuery.data;

  return (
    <>
      <Panel as="section" className="sm:p-6" aria-labelledby="machine-connection-heading">
        <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
          <div>
            <h2 id="machine-connection-heading" className="text-base font-semibold tracking-tight">
              Machine connection.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Reconnect an enrolled machine to reissue agent credentials and restart reporting.
            </p>
          </div>

          <div className="space-y-4">
            {devicesQuery.isPending && !devicesQuery.data ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-10 w-32" />
              </div>
            ) : blockingError ? (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">Could not load your machines.</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void devicesQuery.refetch()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : showConnect ? (
              <div className="flex flex-col gap-3 rounded-md border px-4 py-4">
                <div className="flex items-start gap-3">
                  <Cable className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">No machines connected yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Run the install command on your computer to enroll the agent and start reporting.
                    </p>
                  </div>
                </div>
                <div>
                  <Button type="button" size="sm" onClick={() => setConnectOpen(true)}>
                    Connect machine
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="divide-y rounded-md border">
                {devices.map((device) => (
                  <li key={device.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{device.hostname}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {device.os} · {STATE_LABELS[device.state]} · Last seen {formatRelativeTime(device.lastSeenAt)}
                      </p>
                      {device.legacyLocation ? (
                        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>
                            Running from a legacy location that some security tools flag. Reconnect to move it
                            to ~/Applications.
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={device.legacyLocation ? "default" : "outline"}
                      className="shrink-0"
                      onClick={() => setRepairDevice({ id: device.id, hostname: device.hostname })}
                    >
                      Reconnect
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <RepairConnectionDialog
        device={repairDevice}
        onOpenChange={(open) => {
          if (!open) setRepairDevice(null);
        }}
        onRepaired={() => {
          void invalidateAppData();
          void devicesQuery.refetch();
          router.refresh();
        }}
      />

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-xl gap-5 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Connect this machine.</DialogTitle>
            <DialogDescription>Run the install command in Terminal. Expires in 15 minutes.</DialogDescription>
          </DialogHeader>
          <DeviceConnectCard
            compact
            title="Connect command"
            description="Installs the agent, configures tools, and starts reporting."
            onConnected={() => {
              void invalidateAppData();
              void devicesQuery.refetch();
              router.refresh();
              setConnectOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
