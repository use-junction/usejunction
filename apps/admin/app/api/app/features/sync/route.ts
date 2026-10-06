import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { syncConnection } from "@/lib/integrations/sync";
import { audit, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";
import { browserMutationGuard } from "@/lib/security/http";

export const maxDuration = 300;

function mergeCounts(into: Record<string, unknown>, from: Record<string, unknown>) {
  for (const [key, value] of Object.entries(from)) {
    if (typeof value === "number") {
      into[key] = Number(into[key] ?? 0) + value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const current = (into[key] && typeof into[key] === "object" && !Array.isArray(into[key]))
        ? into[key] as Record<string, unknown>
        : {};
      mergeCounts(current, value as Record<string, unknown>);
      into[key] = current;
      continue;
    }
    if (value != null && into[key] == null) into[key] = value;
  }
}

export async function POST(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const connections = await prisma.providerConnection.findMany({
    where: { orgId: principal.orgId, provider: "github", status: { not: "disconnected" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!connections.length) return appError("NOT_FOUND", "Connect GitHub first.", 404);
  try {
    const counts: Record<string, unknown> = {};
    for (const connection of connections) {
      const result = await syncConnection(connection.id, { forceAuthorWake: true, forceProjects: true });
      mergeCounts(counts, result as Record<string, unknown>);
      await audit({
        orgId: principal.orgId,
        actorType: "user",
        actorId: principal.userId,
        action: "integration.synced",
        targetType: "provider_connection",
        targetId: connection.id,
        metadata: result,
      });
    }
    return appData({ ok: true, counts });
  } catch (error) {
    logServerError("features/sync", error);
    return appError("SYNC_FAILED", "GitHub sync failed.", 502);
  }
}
