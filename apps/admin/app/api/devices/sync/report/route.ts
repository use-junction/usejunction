import { NextRequest, NextResponse } from "next/server";
import { findDeviceByBearerToken } from "@/lib/auth";
import { remapGitHubAuthorAfterUsageSync } from "@/lib/features/pipeline";
import { reportDeviceSyncTargets } from "@/lib/sync/remote-sync";
import { limitedJson } from "@/lib/security/http";
import { logServerError } from "@/lib/errors/public";

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const device = await findDeviceByBearerToken(req, {
      where: { decommissionedAt: null },
      include: { user: { select: { removedAt: true } } },
    });
    if (!device || device.user.removedAt) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const parsed = await limitedJson(req, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as Record<string, unknown>;
    const status = body.status;
    if (status !== "running" && status !== "succeeded" && status !== "failed") {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const leaseToken = typeof body.leaseToken === "string" ? body.leaseToken : "";
    const targetIds = Array.isArray(body.targetIds)
      ? body.targetIds.filter((id): id is string => typeof id === "string").slice(0, 50)
      : [];
    if (!leaseToken || targetIds.length === 0) {
      return NextResponse.json({ error: "leaseToken and targetIds required" }, { status: 400 });
    }
    const result = await reportDeviceSyncTargets({
      device: { id: device.id, orgId: device.orgId },
      leaseToken,
      targetIds,
      status,
      tools: numberValue(body.tools),
      accounts: numberValue(body.accounts),
      quotas: numberValue(body.quotas),
      usageRows: numberValue(body.usageRows),
      warnings: Array.isArray(body.warnings)
        ? body.warnings.filter((item): item is string => typeof item === "string")
        : undefined,
      errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : null,
    });
    if (status === "succeeded") {
      void remapGitHubAuthorAfterUsageSync(device.orgId, device.userId).catch((error) => {
        logServerError("features/remap-after-usage-sync", error, {
          orgId: device.orgId,
          developerId: device.userId,
          deviceId: device.id,
        });
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logServerError("devices/sync/report", error);
    return NextResponse.json({ error: "sync report failed" }, { status: 500 });
  }
}
