"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { CollectionNoticeLink, DeviceConnectCard } from "@/components/onboarding/device-connect-card";
import { isReadyDevice, type DeviceConnectSnapshot } from "@/lib/device-connect-state";
import { InviteTeamForm } from "@/components/onboarding/invite-team-form";
import { useOnboardingStatus } from "@/components/onboarding/onboarding-status-provider";
import { hasToolBrandIcon, ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canonicalToolKey } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";
import {
  canChooseOnboardingPath,
  type OrganizationRole,
} from "@/lib/rbac/permissions";

export type OnboardingStatus = {
  configured: boolean;
  role?: string | null;
  onboardingCompletedAt?: string | null;
  organization?: { name: string; slug: string };
  developer?: {
    devices: Array<{
      id: string;
      hostname: string;
      os: string;
      createdAt?: string;
      lastSeenAt: string;
      lastToolsSyncAt?: string | null;
      lastUsageSyncAt?: string | null;
      toolInstallations: Array<{ toolName: string; version?: string | null }>;
    }>;
  } | null;
};

function mapDevicesFromStatus(status: OnboardingStatus): DeviceConnectSnapshot[] {
  return (status.developer?.devices ?? []).map((device) => ({
    id: device.id,
    hostname: device.hostname,
    os: device.os,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    lastToolsSyncAt: device.lastToolsSyncAt ?? null,
    lastUsageSyncAt: device.lastUsageSyncAt ?? null,
    toolInstallations: device.toolInstallations,
  }));
}

type Path = "choose" | "connect" | "invite";

function TextLink({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ChoiceCard({
  iconSrc,
  title,
  description,
  onClick,
  primary = false,
  dark = false,
}: {
  iconSrc: string;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-[9.5rem] flex-1 flex-col items-start gap-4 border p-4 text-left transition-colors",
        primary
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : dark
            ? "border-neutral-500 border-1 text-black hover:bg-neutral-200/90 transparent"
            : "border-neutral-500 bg-neutral-50 hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <Image src={iconSrc} alt="" width={36} height={36} className="size-9 shrink-0" />
      <span className="mt-auto space-y-1.5">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {title}
          <ArrowRight
            className={cn(
              "size-3.5 transition-transform group-hover:translate-x-0.5",
              primary
                ? "text-primary-foreground/80"
                : dark
                  ? "text-black/80"
                  : "text-muted-foreground",
            )}
          />
        </span>
        <span
          className={cn(
            "block text-xs leading-5",
            primary
              ? "text-primary-foreground/80"
              : dark
                ? "text-black/80"
                : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

function initialPath(status: OnboardingStatus | null, soloMode: boolean): Path | null {
  if (!status?.configured) return null;
  if (soloMode) return "connect";
  return canChooseOnboardingPath(status.role as OrganizationRole | null)
    ? "choose"
    : "connect";
}

export function OnboardingExperience({
  initialStatus,
  needsSessionSync,
  soloMode = false,
}: {
  initialStatus?: OnboardingStatus | null;
  needsSessionSync?: boolean;
  soloMode?: boolean;
}) {
  const bootstrap = useOnboardingStatus();
  const serverStatus = initialStatus ?? bootstrap?.status ?? null;
  const shouldSyncSession =
    needsSessionSync ?? bootstrap?.needsSessionSync ?? false;
  const [status, setStatus] = useState<OnboardingStatus | null>(serverStatus);
  const [loading, setLoading] = useState(!serverStatus?.configured);
  const [invitePending, setInvitePending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [path, setPath] = useState<Path | null>(() => initialPath(serverStatus, soloMode));
  const onboardingPath = soloMode ? "/onboarding?mode=solo" : "/onboarding";

  const refresh = useCallback(async (mode: "bootstrap" | "poll" = "poll") => {
    const response =
      mode === "bootstrap"
        ? await fetch("/api/onboarding", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json",
              "x-requested-with": "usejunction-web",
            },
            body: "{}",
            cache: "no-store",
          })
        : await fetch("/api/onboarding?include=developer", { cache: "no-store" });

    if (response.status === 401) {
      window.location.href = `/login?from=${encodeURIComponent(onboardingPath)}`;
      return;
    }
    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "invite_pending") {
        setInvitePending(true);
        setLoading(false);
        return;
      }
    }

    const next = response.ok ? ((await response.json()) as OnboardingStatus) : null;
    if ((!response.ok || !next?.configured) && mode === "poll") {
      return refresh("bootstrap");
    }
    
    if (next) {
      const role = next.role as OrganizationRole | null;
      const canLeave = Boolean(next.onboardingCompletedAt);
      if (canLeave) {
        window.location.href = "/dashboard";
        return;
      }
      setStatus(next);
      setPath((current) => {
        if (current) return current;
        return initialPath(next, soloMode);
      });
    }
    setLoading(false);
  }, [onboardingPath, soloMode]);

  useEffect(() => {
    if (!serverStatus?.configured) {
      void refresh("bootstrap");
      return;
    }
    if (shouldSyncSession) {
      // The workspace is already rendered from the server result. Refresh in
      // the background only to stamp the workspace onto an older JWT.
      void refresh("bootstrap");
    }
  }, [refresh, serverStatus?.configured, shouldSyncSession]);

  async function finish(action: "complete" | "skip" = "complete") {
    setFinishing(true);
    setFinishError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "usejunction-web",
        },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        setFinishError("Unable to finish onboarding. Check your connection and try again.");
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setFinishError("Unable to finish onboarding. Check your connection and try again.");
    } finally {
      setFinishing(false);
    }
  }

  if (invitePending) {
    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title="Finish your invite first."
        description="Open the invite link from your email or teammate before setting up a personal workspace."
        statement="Visibility before control."
      >
        <p className="text-sm text-muted-foreground">
          Creating a personal workspace is blocked while you have an open invite.
        </p>
      </AuthShell>
    );
  }

  if (loading || !status || !path) {
    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title="Loading your workspace."
        description="Checking devices and membership."
        statement="Visibility before control."
      >
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </AuthShell>
    );
  }

  const role = status.role as OrganizationRole | null;
  const canChoose = canChooseOnboardingPath(role);
  const workspaceName = status.organization?.name ?? "your workspace";
  const device = status.developer?.devices.find((item) => isReadyDevice(item));
  const connectedTools = device
    ? [...new Set(device.toolInstallations.map((tool) => canonicalToolKey(tool.toolName)).filter(hasToolBrandIcon))]
    : [];

  if (device) {
    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title={soloMode ? "Your usage is ready to analyze." : `${device.hostname} is live.`}
        description={
          soloMode
            ? "Your first usage signal is connected. See tools, plan pressure, and spend before you decide what to change."
            : `Reporting to ${workspaceName}. Open the dashboard to see tools and spend.`
        }
        statement={soloMode ? "Start with your own signal." : "First signal. Then the rest."}
      >
        <div className="space-y-5">
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-sm font-medium">{device.hostname}</p>
            <p className="mt-1 text-xs text-muted-foreground">{device.os} · just now</p>
            {connectedTools.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {connectedTools.map((toolKey) => (
                  <ToolLogoTile key={toolKey} tool={toolKey} size="sm" />
                ))}
              </div>
            )}
          </div>
          <Button className="w-full" onClick={() => void finish()} disabled={finishing}>
            {finishing ? <Loader2 className="animate-spin" /> : null}
            {soloMode ? "Analyze my usage" : "Open dashboard"}
            <ArrowRight />
          </Button>
          {finishError ? <p className="text-xs text-destructive">{finishError}</p> : null}
        </div>
      </AuthShell>
    );
  }

  if (path === "connect" || !canChoose) {
    const connectDevices = mapDevicesFromStatus(status);

    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title={soloMode ? "Analyze your own usage first." : "Connect this computer."}
        description={
          <>
            <p>
              {soloMode
                ? "Connect the computer where you use Cursor, Claude Code, or Codex. No teammates or team rollout are needed to start."
                : "Copy the command and paste it in Terminal. We’ll detect the machine automatically."}
            </p>
            <CollectionNoticeLink className="mt-2" />
          </>
        }
        statement={soloMode ? "One developer. Real data." : "One command. Real data."}
      >
        <div className="space-y-5">
          <DeviceConnectCard
            compact
            showNoticeLink={false}
            skipInitialStatusFetch
            initialDevices={connectDevices}
            onConnected={() => {
              void refresh("poll");
            }}
          />
          <div className="space-y-2 pt-2 text-center">
            {canChoose ? (
              <button
                type="button"
                onClick={() => setPath("choose")}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Back to options
              </button>
            ) : null}
            <div>
              <TextLink onClick={() => void finish("skip")} disabled={finishing}>
                {finishing ? "Skipping…" : soloMode ? "Analyze without connecting" : "Skip this step"}
              </TextLink>
            </div>
            {finishError ? <p className="text-xs text-destructive">{finishError}</p> : null}
          </div>
        </div>
      </AuthShell>
    );
  }

  if (path === "invite") {
    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title="Invite teammates."
        description="Share a join link so your team can start reporting."
        statement="Visibility before control."
      >
        <div className="space-y-6">
          <InviteTeamForm variant="dashboard" onInvited={() => void finish()} />
          <div className="space-y-1 pt-2 text-center text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => setPath("choose")}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to options
            </button>
            <div>
              <TextLink onClick={() => void finish("skip")} disabled={finishing}>
                Open dashboard without inviting
              </TextLink>
            </div>
            {finishError ? <p className="text-xs text-destructive">{finishError}</p> : null}
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      size="md"
      accent="cyan"
      contentAlign="top"
      title={`Welcome to ${workspaceName}.`}
      description="How do you want to get started?"
      statement="Visibility before control."
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <ChoiceCard
          primary
          iconSrc="/images/laptop-tile.png"
          title="Connect this computer"
          description="Install the agent and start reporting tools from this machine."
          onClick={() => setPath("connect")}
        />
        <ChoiceCard
          dark
          iconSrc="/images/person-tile.png"
          title="I’m here to manage my team"
          description="Invite teammates and open the workspace without connecting first."
          onClick={() => setPath("invite")}
        />
      </div>
    </AuthShell>
  );
}
