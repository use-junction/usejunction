import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { browserMutationGuard } from "@/lib/security/http";
import { audit, rolesFor } from "@/lib/rbac";
import { disconnectGitHubProjects } from "@/lib/integrations/github-projects";
import { logServerError } from "@/lib/errors/public";

export async function POST(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  try {
    const result = await disconnectGitHubProjects(principal.orgId);
    if (!result.removedProjects) return appError("NOT_FOUND", "No GitHub Projects are selected.", 404);
    await audit({ orgId: principal.orgId, actorType: "user", actorId: principal.userId, action: "integration.github_projects_disconnected", targetType: "provider_connection", metadata: result });
    return appData(result);
  } catch (error) {
    logServerError("project-tools/github-projects/disconnect", error);
    return appError("DISCONNECT_FAILED", "Could not disconnect GitHub Projects.", 502);
  }
}
