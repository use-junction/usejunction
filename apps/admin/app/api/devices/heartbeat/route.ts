import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import {
  recordDeviceActivityEvent,
} from "@/lib/activity/record-device-activity-event";
import { findDeviceByBearerToken } from "@/lib/auth";
import { updateDirectiveForHeartbeat, normalizeAgentVersion } from "@/lib/agent-updates";
import { revokeDeviceAuth } from "@/lib/devices/decommission";
import { encryptSecret, hashOpaqueToken } from "@/lib/security";
import { limitedJson } from "@/lib/security/http";
import { logServerError } from "@/lib/errors/public";
import { getFullUsageRescanDay } from "@/lib/runtime-settings";
import { applyUserTimeZone } from "@/lib/notifications/preferences";
import { isValidIanaTimeZone } from "@/lib/timezone";
import { notifyServerIssue } from "@/lib/notifications/slack";
import { REMOTE_SYNC_PROTOCOL } from "@/lib/sync/protocol";

type AgentCollectStatus = {
  status: string;
  at?: string;
  durationMs?: number;
  error?: string;
  warnings?: string[];
};

function parseCollectStatus(raw: unknown): AgentCollectStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const status = typeof r.status === "string" ? r.status.slice(0, 32) : "";
  if (!status) return null;
  return {
    status,
    at: typeof r.at === "string" ? r.at.slice(0, 40) : undefined,
    durationMs: typeof r.durationMs === "number" && Number.isFinite(r.durationMs) ? r.durationMs : undefined,
    error: typeof r.error === "string" ? r.error.slice(0, 2000) : undefined,
    warnings: Array.isArray(r.warnings)
      ? r.warnings.filter((w): w is string => typeof w === "string").slice(0, 8).map((w) => w.slice(0, 500))
      : undefined,
  };
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const device = await findDeviceByBearerToken(req, {
      include: { user: { select: { removedAt: true, authUserId: true } } },
    });
    if (!device) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const shouldUninstall = Boolean(device.decommissionedAt || device.user.removedAt);
    if (shouldUninstall) {
      await prisma.$transaction(async (tx) => {
        if (!device.decommissionedAt) {
          await tx.device.update({
            where: { id: device.id },
            data: {
              decommissionedAt: device.user.removedAt ?? new Date(),
              localEndpoint: null,
              localSyncTokenHash: null,
              localSyncTokenEnc: null,
            },
          });
        }
        await revokeDeviceAuth(tx, device.id);
      });
      await recordDeviceActivityEvent({
        orgId: device.orgId,
        developerId: device.userId,
        deviceId: device.id,
        kind: "heartbeat",
        direction: "directive",
        status: "ok",
        summary: `Heartbeat · uninstall directive · ${device.hostname}`,
        requestSummary: { hostname: device.hostname },
        responseSummary: { uninstall: true },
        durationMs: Date.now() - started,
      });
      return NextResponse.json({ ok: true, deviceId: device.id, uninstall: true });
    }

    const parsedBody = await limitedJson(req, 128 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;
    const localEndpoint =
      typeof body.localEndpoint === "string" && body.localEndpoint.startsWith("http://127.0.0.1")
        ? body.localEndpoint.slice(0, 128)
        : undefined;
    const localSyncToken =
      typeof body.localSyncToken === "string" && body.localSyncToken.length >= 16
        ? body.localSyncToken.slice(0, 256)
        : undefined;
    const reportedAgentVersion =
      typeof body.agentVersion === "string" ? normalizeAgentVersion(body.agentVersion) : undefined;
    const remoteSyncProtocol =
      typeof body.remoteSyncProtocol === "number" && Number.isFinite(body.remoteSyncProtocol)
        ? Math.max(0, Math.min(REMOTE_SYNC_PROTOCOL, Math.floor(body.remoteSyncProtocol)))
        : 0;
    // Where the macOS agent runs from, so the dashboard can flag pre-unhide
    // (hidden-dir) installs for repair. Only trust the known values.
    const appLocation =
      body.appLocation === "visible" || body.appLocation === "legacyHidden"
        ? body.appLocation
        : undefined;

    await prisma.$transaction(async (tx) => {
      // Only one agent can own a loopback sync port — drop stale claims so the
      // dashboard never bounces with a token that the running daemon rejects.
      if (localEndpoint) {
        await tx.device.updateMany({
          where: {
            localEndpoint,
            id: { not: device.id },
          },
          data: {
            localEndpoint: null,
            localSyncTokenHash: null,
            localSyncTokenEnc: null,
          },
        });
      }

      await tx.device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          ...(reportedAgentVersion ? { agentVersion: reportedAgentVersion } : {}),
          remoteSyncProtocol,
          ...(body.os ? { os: String(body.os).slice(0, 64) } : {}),
          ...(body.architecture ? { architecture: String(body.architecture).slice(0, 64) } : {}),
          ...(body.hostname ? { hostname: String(body.hostname).slice(0, 255) } : {}),
          ...(appLocation ? { appLocation } : {}),
          ...(localEndpoint ? { localEndpoint } : {}),
          ...(localSyncToken
            ? {
                localSyncTokenHash: hashOpaqueToken(localSyncToken),
                localSyncTokenEnc: encryptSecret(localSyncToken),
              }
            : {}),
        },
      });
    });

    let update = null;
    try {
      update = await updateDirectiveForHeartbeat({
        id: device.id,
        orgId: device.orgId,
        os: typeof body.os === "string" ? body.os : device.os,
        architecture: typeof body.architecture === "string" ? body.architecture : device.architecture,
        agentVersion: reportedAgentVersion ?? device.agentVersion,
      });
    } catch (error) {
      logServerError("devices/heartbeat-update", error);
    }

    const hostname =
      typeof body.hostname === "string" ? body.hostname.slice(0, 255) : device.hostname;
    const agentVersion = reportedAgentVersion ?? device.agentVersion;
    const hasUpdate = Boolean(update);

    await recordDeviceActivityEvent({
      orgId: device.orgId,
      developerId: device.userId,
      deviceId: device.id,
      kind: "heartbeat",
      direction: hasUpdate ? "directive" : "ingest",
      status: "ok",
      summary: hasUpdate
        ? `Heartbeat · update directive · ${hostname} · agent ${agentVersion}`
        : `Heartbeat · ${hostname} · agent ${agentVersion}`,
      requestSummary: {
        hostname,
        os: typeof body.os === "string" ? body.os.slice(0, 64) : device.os,
        architecture:
          typeof body.architecture === "string" ? body.architecture.slice(0, 64) : device.architecture,
        agentVersion,
        remoteSyncProtocol,
        localEndpointPresent: Boolean(localEndpoint),
        localSyncTokenPresent: Boolean(localSyncToken),
      },
      responseSummary: {
        ok: true,
        deviceId: device.id,
        updatePresent: hasUpdate,
        ...(hasUpdate && update && typeof update === "object"
          ? {
              update: {
                version:
                  "targetVersion" in update && typeof update.targetVersion === "string"
                    ? update.targetVersion
                    : null,
                urgency:
                  "urgency" in update && typeof update.urgency === "string" ? update.urgency : null,
              },
            }
          : {}),
      },
      durationMs: Date.now() - started,
    });

    // Agent-reported collect outcome. Alert ops on failures/timeouts so we can
    // ship a fix, rather than letting a broken collect silently fall behind.
    const lastCollect = parseCollectStatus(body.lastCollect);
    if (lastCollect && (lastCollect.status === "failed" || lastCollect.status === "timeout")) {
      notifyServerIssue({
        severity: lastCollect.status === "timeout" ? "warning" : "error",
        scope: "agent/collect",
        error: lastCollect.error || `agent collect ${lastCollect.status}`,
        details: {
          hostname,
          agentVersion,
          deviceId: device.id,
          status: lastCollect.status,
          ...(lastCollect.durationMs != null ? { durationMs: String(lastCollect.durationMs) } : {}),
          ...(lastCollect.at ? { at: lastCollect.at } : {}),
          ...(lastCollect.warnings?.length ? { warnings: lastCollect.warnings.join("\n") } : {}),
        },
      });
    }

    let fullUsageRescanDay: string | null = null;
    try {
      fullUsageRescanDay = await getFullUsageRescanDay();
    } catch (error) {
      logServerError("devices/heartbeat-full-usage-day", error);
    }

    let pendingRemoteSync = false;
    let featuresAuthorSync = false;
    try {
      const [pendingCount, githubAuthor, githubConnection] = await Promise.all([
        prisma.deviceSyncRequestTarget.count({
          where: {
            deviceId: device.id,
            status: "queued",
            syncRequest: { expiresAt: { gt: new Date() } },
          },
        }),
        prisma.externalIdentity.findFirst({
          where: { orgId: device.orgId, provider: "github", developerId: device.userId },
          select: { id: true },
        }),
        prisma.providerConnection.findFirst({
          where: { orgId: device.orgId, provider: "github", status: { not: "disconnected" } },
          select: { id: true },
        }),
      ]);
      pendingRemoteSync = pendingCount > 0;
      featuresAuthorSync = Boolean(githubAuthor && githubConnection);
    } catch (error) {
      logServerError("devices/heartbeat-features-sync", error);
    }

    const reportedTimeZone =
      typeof body.timeZone === "string" ? body.timeZone.trim().slice(0, 64) : "";
    if (reportedTimeZone && isValidIanaTimeZone(reportedTimeZone) && device.user.authUserId) {
      try {
        await applyUserTimeZone({
          userId: device.user.authUserId,
          timeZone: reportedTimeZone,
          source: "agent",
        });
      } catch (error) {
        logServerError("devices/heartbeat-timezone", error);
      }
    }

    return NextResponse.json({
      ok: true,
      deviceId: device.id,
      update,
      ...(fullUsageRescanDay ? { fullUsageRescanDay } : {}),
      ...(pendingRemoteSync ? { pendingRemoteSync: true } : {}),
      ...(featuresAuthorSync ? { featuresAuthorSync: true } : {}),
    });
  } catch (e) {
    logServerError("devices/heartbeat", e);
    return NextResponse.json({ error: "heartbeat failed" }, { status: 500 });
  }
}
