import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { disconnectLinearConnection } from "@/lib/integrations/linear-sync";
import { browserMutationGuard } from "@/lib/security/http";
import { audit, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";

export async function POST(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  try {
    const result = await disconnectLinearConnection(principal.orgId);
    if (!result.disconnected) return appError("NOT_FOUND", "Linear is not connected.", 404);
    await audit({
      orgId: principal.orgId,
      actorType: "user",
      actorId: principal.userId,
      action: "integration.linear_disconnected",
      targetType: "project_tool_connection",
      metadata: { revoked: result.revoked, removedIssues: result.removedIssues },
    });
    return appData({ ok: true, ...result });
  } catch (error) {
    logServerError("project-tools/linear/disconnect", error);
    return appError("DISCONNECT_FAILED", "Could not disconnect Linear.", 502);
  }
}
