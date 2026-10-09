import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { activeDeviceWhere } from "@/lib/devices/decommission";
import { deviceHealthState } from "@/lib/devices/health";
import { resolveLinkedDeveloper } from "@/lib/sync/remote-sync-context";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request);
  if (principal instanceof NextResponse) return principal;

  const developer = await resolveLinkedDeveloper(principal.orgId, principal.userId);
  if (!developer) {
    return appError(
      "LINKED_DEVELOPER_REQUIRED",
      "Link your user to a developer profile before managing devices.",
      409,
    );
  }

  const devices = await prisma.device.findMany({
    where: {
      orgId: principal.orgId,
      userId: developer.id,
      ...activeDeviceWhere,
    },
    select: {
      id: true,
      hostname: true,
      os: true,
      architecture: true,
      lastSeenAt: true,
      appLocation: true,
    },
    orderBy: { lastSeenAt: "desc" },
  });

  return appData({
    devices: devices.map((device) => ({
      id: device.id,
      hostname: device.hostname,
      os: device.os,
      architecture: device.architecture,
      lastSeenAt: device.lastSeenAt.toISOString(),
      state: deviceHealthState(device.lastSeenAt),
      // "legacyHidden" means the macOS agent still runs from ~/.usejunction and
      // should be reconnected to converge on ~/Applications (clears EDR flags).
      legacyLocation: device.appLocation === "legacyHidden",
    })),
  });
}
