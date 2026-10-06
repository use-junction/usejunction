"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { RepairConnectionDialog } from "@/components/dashboard/repair-connection-dialog";
import { Button } from "@/components/ui/button";
import type { DeviceRecoverySummary } from "@/lib/sync/remote-sync-context";

const HIDE_KEY_PREFIX = "uj:hide-repair-banner:";

type Props = {
  recoveryDevices?: DeviceRecoverySummary[];
  scope?: "team" | "you";
};

export function ConnectionRepairBanner({ recoveryDevices = [], scope = "you" }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hidden, setHidden] = useState(true);
  const [repairDevice, setRepairDevice] = useState<DeviceRecoverySummary | null>(null);

  const ownedRecoveryDevice = recoveryDevices.find((device) => device.isCurrentUser) ?? null;
  const canRepairFromHere = scope === "you" || Boolean(ownedRecoveryDevice);
  const primaryDevice = ownedRecoveryDevice ?? recoveryDevices[0] ?? null;
  const deviceKey = recoveryDevices.map((device) => device.id).sort().join(",");

  useEffect(() => {
    if (!deviceKey) {
      setHidden(true);
      return;
    }
    try {
      setHidden(window.sessionStorage.getItem(`${HIDE_KEY_PREFIX}${deviceKey}`) === "1");
    } catch {
      setHidden(false);
    }
  }, [deviceKey]);

  useEffect(() => {
    const requestedId = searchParams.get("repair");
    if (!requestedId || repairDevice || recoveryDevices.length === 0) return;
    const requested = recoveryDevices.find((device) => device.id === requestedId);
    if (requested) setRepairDevice(requested);
  }, [recoveryDevices, repairDevice, searchParams]);

  if (recoveryDevices.length === 0 || hidden) return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(`${HIDE_KEY_PREFIX}${deviceKey}`, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  }

  return (
    <>
      <div className="mb-6 flex w-full flex-col gap-3 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-800 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {canRepairFromHere
                ? "Connection needs attention."
                : `${recoveryDevices.length} machine${recoveryDevices.length === 1 ? "" : "s"} need${recoveryDevices.length === 1 ? "s" : ""} attention.`}
            </p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
              {canRepairFromHere
                ? `${primaryDevice?.hostname ?? "This machine"} has not reported for 2 days.`
                : "The machine owner has been notified to repair the existing agent enrollment."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canRepairFromHere ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-500/40 bg-background text-foreground hover:bg-amber-500/10"
              onClick={() => setRepairDevice(primaryDevice)}
            >
              Repair connection
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-500/40 bg-background text-foreground hover:bg-amber-500/10"
              onClick={() => router.push("/team")}
            >
              Review machines
            </Button>
          )}
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <RepairConnectionDialog
        device={repairDevice ? { id: repairDevice.id, hostname: repairDevice.hostname } : null}
        onOpenChange={(open) => {
          if (!open) setRepairDevice(null);
        }}
        onRepaired={() => router.refresh()}
      />
    </>
  );
}
