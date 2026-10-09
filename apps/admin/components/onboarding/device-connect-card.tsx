"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Info, Loader2 } from "lucide-react";
import { hasToolBrandIcon, ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { Panel } from "@/components/panel";
import { PlatformCommand } from "@/components/onboarding/platform-command";
import { buildPlatformInstallCommands, buildPlatformResumeCommands } from "@/lib/connect-command";
import {
  getDeviceConnectStage,
  isEnrollmentTokenStale,
  isReadyDevice,
  shouldEnterSyncWait,
  shouldServeCachedEnrollmentToken,
  type DeviceConnectStage,
  type DeviceConnectSnapshot,
} from "@/lib/device-connect-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { canonicalToolKey } from "@/lib/tools/catalog";
import { userFacingError } from "@/lib/errors/user-facing";
import { browserMutationInit } from "@/lib/api/client";
import type { CollectionNoticeCopy } from "@/lib/privacy/collection-notice";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 2500;
const POLL_DURATION_MS = 60_000;
/** After this long, stop presenting an endless spinner; background polling continues. */
const SYNC_LONG_WAIT_MS = 120_000;

type Device = DeviceConnectSnapshot;

type EnrollmentCredentials = {
  token: string;
  controlPlaneUrl: string;
  expiresAt: string;
};

export type DeviceConnectEnrollmentCredentials = EnrollmentCredentials;

type Props = {
  title?: string;
  description?: string;
  footerDescription?: string;
  compact?: boolean;
  /** Render the "What this collects" link above the command. Off when the parent shows it. */
  showNoticeLink?: boolean;
  /** Only poll for enrollment after the connect command is copied. */
  pollAfterCopy?: boolean;
  /** Hide the inline waiting row (e.g. when parent renders status elsewhere). */
  hideInlineStatus?: boolean;
  /** Devices from parent bootstrap — skips mount-time status fetch when set. */
  initialDevices?: Device[];
  /** Token prefetched by parent after bootstrap. */
  initialCredentials?: EnrollmentCredentials | null;
  /** When true with initialDevices, do not GET /api/onboarding on mount. */
  skipInitialStatusFetch?: boolean;
  onPollingStateChange?: (state: {
    isPolling: boolean;
    waitingForTools: boolean;
    /** Device row exists — user should not re-run enroll command. */
    deviceEnrolled: boolean;
    /** Post-enroll sync is taking longer than usual (informational only). */
    syncTakingLong: boolean;
    stage: DeviceConnectStage;
  }) => void;
  onConnected?: (device: Device) => void;
};

export type DeviceConnectCardHandle = {
  checkConnection: () => void;
};

export const DeviceConnectCard = forwardRef<DeviceConnectCardHandle, Props>(function DeviceConnectCard(
  {
    title = "Connect command",
    description = "Choose this device's platform, then run the command. It installs the agent, enables reporting, and starts it in the background. Expires in 15 minutes.",
    footerDescription,
    compact = false,
    showNoticeLink = true,
    pollAfterCopy = false,
    hideInlineStatus = false,
    initialDevices,
    initialCredentials = null,
    skipInitialStatusFetch = false,
    onPollingStateChange,
    onConnected,
  },
  ref,
) {
  const [device, setDevice] = useState<Device | null>(null);
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);
  const [controlPlaneUrl, setControlPlaneUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<CollectionNoticeCopy | null>(null);
  const [loading, setLoading] = useState(true);
  const [waitingForTools, setWaitingForTools] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollSession, setPollSession] = useState(0);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [syncTakingLong, setSyncTakingLong] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  /** Device row exists — enrollment token must not be reused. */
  const [deviceEnrolled, setDeviceEnrolled] = useState(false);
  /** Only flip after onConnected — keeps loading UI until the parent can take over. */
  const [fullyConnected, setFullyConnected] = useState(false);
  const notifiedRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<EnrollmentCredentials | null> | null>(null);
  const waitingStartedAtRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  const markEnrollmentConsumed = useCallback(() => {
    setDeviceEnrolled((current) => {
      if (current) return current;
      setToken(null);
      setExpiresAt(null);
      setIsPolling(false);
      return true;
    });
  }, []);

  const beginSyncWait = useCallback((candidate: Device, progress: string | null = null) => {
    if (!waitingStartedAtRef.current) {
      const enrolledAt = candidate.createdAt ? Date.parse(candidate.createdAt) : Number.NaN;
      waitingStartedAtRef.current = Number.isFinite(enrolledAt) ? enrolledAt : Date.now();
      setSyncTakingLong(false);
    }
    setWaitingForTools(true);
    setDevice(candidate);
    setImportProgress(progress);
  }, []);

  const markConnected = useCallback(
    (candidate: Device) => {
      setWaitingForTools(false);
      setIsPolling(false);
      setImportProgress(null);
      setSyncTakingLong(false);
      waitingStartedAtRef.current = null;
      setFullyConnected(true);
      if (notifiedRef.current !== candidate.id) {
        notifiedRef.current = candidate.id;
        onConnected?.(candidate);
      }
    },
    [onConnected],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/onboarding?include=developer", { cache: "no-store" });
      if (!response.ok) {
        setPollError("We couldn’t check setup status. Check your connection and try again.");
        return null;
      }
      const data = await response.json();
      const devices = (data.developer?.devices as Device[] | undefined) ?? [];
      const next = devices[0] ?? null;
      setDevice(next);
      setPollError(null);
      return { next, devices };
    } catch {
      setPollError("We couldn’t check setup status. Check your connection and try again.");
      return null;
    }
  }, []);

  const checkEnrollment = useCallback(async () => {
    const status = await refreshStatus();
    const devices = status?.devices ?? [];
    const fresh = devices.find((item) => !knownIds.has(item.id)) ?? null;
    const candidate = fresh ?? devices.find((item) => item.id === device?.id) ?? status?.next ?? null;

    if (candidate) {
      markEnrollmentConsumed();
    }

    if (candidate && !knownIds.has(candidate.id)) {
      setKnownIds(new Set(devices.map((item) => item.id)));
    }

    if (candidate && !isReadyDevice(candidate)) {
      beginSyncWait(
        candidate,
        candidate.lastToolsSyncAt ? "Waiting for first usage sync…" : null,
      );
      return;
    }

    if (candidate && isReadyDevice(candidate)) {
      setDevice(candidate);
      markConnected(candidate);
      return;
    }
  }, [beginSyncWait, device?.id, knownIds, markConnected, markEnrollmentConsumed, refreshStatus]);

  const generateToken = useCallback(async (rotate = false): Promise<EnrollmentCredentials | null> => {
    if (deviceEnrolled) {
      setError("This device is already enrolled. Wait for sync to finish.");
      return null;
    }

    setError(null);

    const response = await fetch("/api/me/enrollment-token", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "usejunction-web",
      },
      body: JSON.stringify({ rotate }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = "/login?from=/onboarding";
      return null;
    }
    if (!response.ok) {
      setError(userFacingError(data.error, "Unable to create a connect command."));
      return null;
    }

    const credentials: EnrollmentCredentials = {
      token: data.token,
      expiresAt: data.expiresAt,
      controlPlaneUrl: data.controlPlaneUrl || window.location.origin,
    };
    setToken(credentials.token);
    setExpiresAt(credentials.expiresAt);
    setControlPlaneUrl(credentials.controlPlaneUrl);
    return credentials;
  }, [deviceEnrolled]);

  const ensureFreshEnrollment = useCallback(async (): Promise<EnrollmentCredentials | null> => {
    if (
      shouldServeCachedEnrollmentToken({
        token,
        controlPlaneUrl,
        expiresAt,
        enrollmentConsumed: deviceEnrolled,
      })
    ) {
      return { token: token!, controlPlaneUrl, expiresAt: expiresAt! };
    }

    if (deviceEnrolled) {
      return null;
    }

    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const pending = generateToken().finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = pending;
    return pending;
  }, [controlPlaneUrl, deviceEnrolled, expiresAt, generateToken, token]);

  const resolveCommandForCopy = useCallback(
    async (platform: "macosLinux" | "windows") => {
      const credentials = await ensureFreshEnrollment();
      if (!credentials) {
        throw new Error(
          deviceEnrolled
            ? "Device already enrolled — wait for sync to finish."
            : "Unable to refresh connect command.",
        );
      }
      return buildPlatformInstallCommands(credentials.token, credentials.controlPlaneUrl)[platform];
    },
    [deviceEnrolled, ensureFreshEnrollment],
  );

  /** Records that the collection notice was shown; the token route requires it. */
  const acknowledgeNotice = useCallback(async () => {
    const response = await fetch("/api/me/collection-notice", browserMutationInit("POST", { accept: true }));
    const body = (await response.json().catch(() => ({}))) as { acknowledged?: boolean; error?: string };
    if (!response.ok || !body.acknowledged) {
      setError(userFacingError(body.error, "Unable to create a connect command."));
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    void (async () => {
      let devices: Device[];
      let existing: Device | null;

      if (skipInitialStatusFetch && initialDevices !== undefined) {
        devices = initialDevices;
        existing = devices[0] ?? null;
        setKnownIds(new Set(devices.map((item) => item.id)));
      } else {
        const status = await refreshStatus();
        devices = status?.devices ?? [];
        existing = status?.next ?? null;
        setKnownIds(new Set(devices.map((item) => item.id)));
      }

      const noticeResponse = await fetch("/api/me/collection-notice", { credentials: "same-origin" });
      const noticeBody = (await noticeResponse.json().catch(() => ({}))) as {
        acknowledged?: boolean;
        notice?: CollectionNoticeCopy;
      };
      if (noticeBody.notice) setNotice(noticeBody.notice);
      const acked = noticeBody.acknowledged === true;

      if (initialCredentials) {
        setToken(initialCredentials.token);
        setExpiresAt(initialCredentials.expiresAt);
        setControlPlaneUrl(initialCredentials.controlPlaneUrl);
      }

      if (existing) {
        markEnrollmentConsumed();
        setDevice(existing);
        if (shouldEnterSyncWait(existing)) {
          beginSyncWait(existing);
        }
      } else if (!initialCredentials && (acked || (await acknowledgeNotice()))) {
        await generateToken();
      }

      setLoading(false);
    })();
  }, [
    acknowledgeNotice,
    beginSyncWait,
    generateToken,
    initialCredentials,
    initialDevices,
    markEnrollmentConsumed,
    refreshStatus,
    skipInitialStatusFetch,
  ]);

  useEffect(() => {
    if (fullyConnected) return;
    const waitForCopy = pollAfterCopy && pollSession === 0 && !deviceEnrolled;
    if (waitForCopy) return;

    void checkEnrollment();
    const interval = window.setInterval(() => void checkEnrollment(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [checkEnrollment, deviceEnrolled, fullyConnected, pollAfterCopy, pollSession]);

  useEffect(() => {
    if (!pollAfterCopy || pollSession === 0 || deviceEnrolled) return;

    setIsPolling(true);
    const timeout = window.setTimeout(() => {
      setIsPolling(false);
      if (device && isReadyDevice(device) && notifiedRef.current !== device.id) {
        markConnected(device);
      }
    }, POLL_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [device, deviceEnrolled, markConnected, pollAfterCopy, pollSession]);

  /** Informational only — never reset to re-enroll after a device exists. */
  useEffect(() => {
    if (!waitingForTools || fullyConnected) return;

    const startedAt = waitingStartedAtRef.current ?? Date.now();
    waitingStartedAtRef.current = startedAt;
    const remaining = Math.max(0, SYNC_LONG_WAIT_MS - (Date.now() - startedAt));

    const timeout = window.setTimeout(() => setSyncTakingLong(true), remaining);
    return () => window.clearTimeout(timeout);
  }, [fullyConnected, waitingForTools]);

  const handleCopied = useCallback(() => {
    if (!pollAfterCopy) return;
    setPollSession((current) => current + 1);
  }, [pollAfterCopy]);

  const checkConnection = useCallback(() => {
    if (deviceEnrolled) {
      void checkEnrollment();
      return;
    }
    if (!pollAfterCopy || isReadyDevice(device)) return;
    setPollSession((current) => current + 1);
  }, [checkEnrollment, device, deviceEnrolled, pollAfterCopy]);

  useImperativeHandle(ref, () => ({ checkConnection }), [checkConnection]);

  const connectionStage = getDeviceConnectStage(device, { stalled: syncTakingLong });

  useEffect(() => {
    onPollingStateChange?.({
      isPolling,
      waitingForTools,
      deviceEnrolled,
      syncTakingLong,
      stage: connectionStage,
    });
  }, [connectionStage, deviceEnrolled, isPolling, onPollingStateChange, syncTakingLong, waitingForTools]);

  const commands = useMemo(() => {
    if (deviceEnrolled || !token || !controlPlaneUrl) return null;
    return buildPlatformInstallCommands(token, controlPlaneUrl);
  }, [controlPlaneUrl, deviceEnrolled, token]);
  const resumeCommands = useMemo(
    () =>
      buildPlatformResumeCommands(
        controlPlaneUrl || (typeof window !== "undefined" ? window.location.origin : ""),
      ),
    [controlPlaneUrl],
  );

  if (loading) {
    return (
      <Panel padded={false} className="flex items-center gap-3 border-border px-4 py-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" />
        Checking device…
      </Panel>
    );
  }

  if (fullyConnected && device && isReadyDevice(device)) {
    const connectedTools = [
      ...new Set((device.toolInstallations ?? []).map((tool) => canonicalToolKey(tool.toolName)).filter(hasToolBrandIcon)),
    ];
    return (
      <Panel padded={false} className="border-border p-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-primary">Connected</p>
        <p className="mt-2 text-sm font-medium">{device.hostname}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {device.os} · last seen {new Date(device.lastSeenAt).toLocaleString()}
        </p>
        {connectedTools.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {connectedTools.map((toolKey) => (
              <ToolLogoTile key={toolKey} tool={toolKey} size="sm" />
            ))}
          </div>
        )}
      </Panel>
    );
  }

  const expired = isEnrollmentTokenStale(expiresAt);
  const showWaiting = pollAfterCopy ? isPolling && !deviceEnrolled : !deviceEnrolled;
  const showStatusRow = !hideInlineStatus && (showWaiting || expired);
  const enrolledAwaitingTools = waitingForTools && Boolean(device) && !fullyConnected;
  const stage = connectionStage;

  return (
    <div className={cn(compact ? "space-y-0" : "space-y-4")}>
      {!compact && !enrolledAwaitingTools && (
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      )}
      {enrolledAwaitingTools ? (
        <div className="space-y-3">
          <div
            className={cn(
              "flex items-center gap-2 border px-4 py-3 text-sm",
              syncTakingLong
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-success/30 bg-success/10 text-success",
            )}
          >
            {syncTakingLong ? (
              <AlertCircle className="size-4 shrink-0" aria-hidden />
            ) : (
              <Check className="size-4 shrink-0" aria-hidden />
            )}
            <span>
              {syncTakingLong
                ? "Setup has not reported successfully yet."
                : importProgress ??
                  (stage === "syncing"
                    ? "Device enrolled — waiting for first usage sync…"
                    : "Device enrolled — waiting for tool inventory…")}
            </span>
            {!syncTakingLong ? (
              <Loader2 className="size-4 shrink-0 animate-spin opacity-80" aria-hidden />
            ) : null}
          </div>
          {pollError ? <p className="text-xs leading-relaxed text-destructive">{pollError}</p> : null}
          <div className="space-y-3">
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => setShowRecovery((current) => !current)}
            >
              Having trouble? Finish setup
            </button>
            {showRecovery ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Copy this command into Terminal. It resumes from the existing enrollment and does not create another device.
                </p>
                <PlatformCommand
                  commands={resumeCommands}
                  onCopied={() => {
                    waitingStartedAtRef.current = Date.now();
                    setSyncTakingLong(false);
                    setPollError(null);
                    void checkEnrollment();
                  }}
                />
              </div>
            ) : null}
          </div>
          {syncTakingLong || pollError ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void checkEnrollment()}>
              Check again
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {notice && showNoticeLink ? (
            <div className={cn(compact && "mb-3")}>
              <CollectionNoticeDialog notice={notice} />
            </div>
          ) : null}
          {commands ? (
            <PlatformCommand
              commands={commands}
              resolveCommandForCopy={resolveCommandForCopy}
              onCopied={handleCopied}
              footerDescription={footerDescription}
            />
          ) : deviceEnrolled ? null : (
            <div className="border border-brand-olive bg-brand-olive p-4 font-mono text-xs text-primary-foreground">
              Preparing commands…
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {showStatusRow ? (
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              {showWaiting ? (
                <div className="flex w-full items-center justify-between gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    Waiting for enroll…
                  </div>
                  {!expired ? (
                    <span className="shrink-0 font-mono text-[0.65rem]">Expires in 15 minutes</span>
                  ) : null}
                </div>
              ) : (
                <div />
              )}
              {expired && !deviceEnrolled ? (
                <Button variant="outline" size="sm" onClick={() => void generateToken(true)}>
                  Refresh expired command
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
});

/** Standalone link for parents that place the notice next to their own copy. */
export function CollectionNoticeLink({ className }: { className?: string }) {
  const [notice, setNotice] = useState<CollectionNoticeCopy | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/collection-notice", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((body: { notice?: CollectionNoticeCopy }) => {
        if (!cancelled && body.notice) setNotice(body.notice);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;
  return <CollectionNoticeDialog notice={notice} className={className} />;
}

function CollectionNoticeDialog({ notice, className }: { notice: CollectionNoticeCopy; className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
            className,
          )}
        >
          <Info className="size-3.5 shrink-0" aria-hidden />
          What this collects from this device
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{notice.title}</DialogTitle>
          <DialogDescription className="leading-6">{notice.summary}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">Collected</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 leading-5 text-muted-foreground">
              {notice.collects.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">Never collected</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 leading-5 text-muted-foreground">
              {notice.neverCollects.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
          <p>{notice.whoSees}</p>
          <p>{notice.retention}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
