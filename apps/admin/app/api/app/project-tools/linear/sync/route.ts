import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { syncLinearConnection } from "@/lib/integrations/linear-sync";
import { browserMutationGuard } from "@/lib/security/http";
import { audit, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  try {
    const result = await syncLinearConnection(principal.orgId);
    await audit({
      orgId: principal.orgId,
      actorType: "user",
      actorId: principal.userId,
      action: "integration.linear_synced",
      targetType: "project_tool_connection",
      metadata: result,
    });
    return appData({ ok: true, ...result });
  } catch (error) {
    logServerError("project-tools/linear/sync", error);
    return appError("SYNC_FAILED", "Linear sync failed. Please try again.", 502);
  }
}
