import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { browserMutationGuard } from "@/lib/security/http";
import { audit, rolesFor } from "@/lib/rbac";
import { GitHubProjectsUnavailable, syncGitHubProjects } from "@/lib/integrations/github-projects";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  try {
    const result = await syncGitHubProjects(principal.orgId);
    await audit({ orgId: principal.orgId, actorType: "user", actorId: principal.userId, action: "integration.github_projects_synced", targetType: "provider_connection", metadata: result });
    return appData(result);
  } catch (error) {
    if (error instanceof GitHubProjectsUnavailable) return appError("PROJECTS_UNAVAILABLE", error.message, 409);
    logServerError("project-tools/github-projects/sync", error);
    return appError("SYNC_FAILED", "Could not sync GitHub Projects.", 502);
  }
}
