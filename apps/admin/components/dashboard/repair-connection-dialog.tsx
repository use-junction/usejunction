"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlatformCommand } from "@/components/onboarding/platform-command";
import type { PlatformCommands } from "@/lib/connect-command";

const POLL_INTERVAL_MS = 2500;
/** How long to wait for the machine after the command is copied. */
const WAIT_TIMEOUT_MS = 5 * 60_000;

export type RepairDeviceTarget = {
  id: string;
  hostname: string;
};

type RepairCommandResponse = {
  token: string;
  tokenId: string;
  expiresAt: string;
  controlPlaneUrl: string;
  commands: PlatformCommands;
  deviceId: string;
  hostname: string;
};

type RepairStatus = "waiting" | "enrolled" | "syncing" | "connected" | "expired";

type Repair = {
  tokenId: string;
  expiresAt: number;
  commands: PlatformCommands;
};

/**
 * idle: command shown, not copied yet. waiting/enrolled/syncing: polling the machine.
 * timedOut: stopped polling, the token still works. expired: token is dead.
 */
type Phase = "idle" | "waiting" | "enrolled" | "syncing" | "connected" | "timedOut" | "expired";

type Props = {
  device: RepairDeviceTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Called once the machine re-enrolls and finishes a usage sync. */
  onRepaired?: () => void;
};

export function RepairConnectionDialog({ device, onOpenChange, onRepaired }: Props) {
  const [repair, setRepair] = useState<Repair | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const onRepairedRef = useRef(onRepaired);
  onRepairedRef.current = onRepaired;
  // Callers pass a fresh object per render; key everything on the id so a
  // re-render never reissues the token or restarts polling.
  const deviceId = device?.id ?? null;

  useEffect(() => {
    setPhase("idle");
    setDeadline(null);
    if (!deviceId) {
      setRepair(null);
      setRepairError(null);
      setRepairLoading(false);
      return;
    }

    let cancelled = false;
    setRepairLoading(true);
    setRepairError(null);
    setRepair(null);

    void (async () => {
      try {
        const response = await fetch(`/api/me/devices/${deviceId}/repair`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        const payload = (await response.json().catch(() => null)) as RepairCommandResponse | { error?: string } | null;
        if (cancelled) return;
        if (!response.ok) {
          setRepairError(
            payload && typeof payload === "object" && "error" in payload && payload.error
              ? String(payload.error)
              : "Could not generate a repair command.",
          );
          return;
        }
        if (!payload || !("commands" in payload) || !payload.commands) {
          setRepairError("Could not generate a repair command.");
          return;
        }
        setRepair({
          tokenId: payload.tokenId,
          expiresAt: new Date(payload.expiresAt).getTime(),
          commands: payload.commands,
        });
      } catch {
        if (!cancelled) setRepairError("Could not generate a repair command.");
      } finally {
        if (!cancelled) setRepairLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deviceId, requestKey]);

  const startWaiting = useCallback(() => {
    if (!repair) return;
    setDeadline(Math.min(Date.now() + WAIT_TIMEOUT_MS, repair.expiresAt));
    setPhase((current) =>
      current === "enrolled" || current === "syncing" || current === "connected" ? current : "waiting",
    );
  }, [repair]);

  const polling = phase === "waiting" || phase === "enrolled" || phase === "syncing";

  // Poll only while the dialog is open and waiting; closing it unmounts the
  // device, which clears the interval and aborts any in-flight request.
  useEffect(() => {
    if (!deviceId || !repair || !polling) return;
    const controller = new AbortController();
    let inFlight = false;

    async function check() {
      if (inFlight || !repair) return;
      inFlight = true;
      try {
        const response = await fetch(
          `/api/me/devices/${deviceId}/repair?tokenId=${encodeURIComponent(repair.tokenId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (response.status === 404) {
          setRepairError("This repair command is no longer valid. Close and try again.");
          setPhase("idle");
          return;
        }
        if (!response.ok) return; // transient; try again next tick
        const payload = (await response.json()) as { status: RepairStatus };
        if (controller.signal.aborted) return;
        if (payload.status === "connected") {
          setPhase("connected");
          onRepairedRef.current?.();
        } else if (payload.status === "syncing") {
          setPhase("syncing");
        } else if (payload.status === "enrolled") {
          setPhase("enrolled");
        } else if (payload.status === "expired") {
          setPhase("expired");
        }
      } catch {
        /* aborted or offline; the next tick retries */
      } finally {
        inFlight = false;
      }
    }

    void check();
    const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [deviceId, repair, polling]);

  useEffect(() => {
    if (!polling || deadline === null || !repair) return;
    const timeout = window.setTimeout(
      () => setPhase(Date.now() >= repair.expiresAt ? "expired" : "timedOut"),
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [deadline, polling, repair]);

  const hostname = device?.hostname ?? "the affected machine";

  return (
    <Dialog open={Boolean(device)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-5 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Repair connection.</DialogTitle>
          <DialogDescription>
            Run this command on {hostname}. It reissues credentials for this device and restarts the agent.
          </DialogDescription>
        </DialogHeader>
        {device ? (
          repairLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Generating repair command…
            </div>
          ) : repairError ? (
            <p className="text-sm text-destructive">{repairError}</p>
          ) : phase === "connected" ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">{hostname} is reporting again.</p>
                  <p className="mt-0.5 text-muted-foreground">Usage is synced. Dashboards update in a moment.</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : repair ? (
            <div className="flex flex-col gap-4">
              <PlatformCommand
                commands={repair.commands}
                onCopied={startWaiting}
                footerDescription="Your device history stays attached to this machine. The command includes a one-time repair token."
              />
              <RepairProgress
                phase={phase}
                hostname={hostname}
                onKeepWaiting={startWaiting}
                onNewCommand={() => setRequestKey((key) => key + 1)}
              />
            </div>
          ) : null
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RepairProgress({
  phase,
  hostname,
  onKeepWaiting,
  onNewCommand,
}: {
  phase: Phase;
  hostname: string;
  onKeepWaiting: () => void;
  onNewCommand: () => void;
}) {
  if (phase === "waiting" || phase === "enrolled" || phase === "syncing") {
    return (
      <div className="flex items-center gap-2 border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
        {phase === "waiting"
          ? `Waiting for ${hostname} to run the command…`
          : phase === "enrolled"
            ? `${hostname} re-enrolled. Waiting for the agent to check in…`
            : `${hostname} checked in. Scanning tools and uploading usage…`}
      </div>
    );
  }
  if (phase === "timedOut") {
    return (
      <div className="flex flex-col gap-2 border border-border bg-muted/30 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between" role="status">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Clock className="size-4 shrink-0" aria-hidden />
          {`No response from ${hostname} yet. The command still works.`}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={onKeepWaiting}>
          Keep waiting
        </Button>
      </div>
    );
  }
  if (phase === "expired") {
    return (
      <div className="flex flex-col gap-2 border border-border bg-muted/30 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between" role="status">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Clock className="size-4 shrink-0" aria-hidden />
          This command expired before {hostname} used it.
        </span>
        <Button type="button" size="sm" variant="outline" onClick={onNewCommand}>
          New command
        </Button>
      </div>
    );
  }
  return null;
}
