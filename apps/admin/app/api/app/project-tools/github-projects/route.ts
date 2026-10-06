import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { browserMutationGuard } from "@/lib/security/http";
import { audit, rolesFor } from "@/lib/rbac";
import { GitHubProjectsUnavailable, githubProjectsPicker, saveGitHubProjectSelection, syncGitHubProjects } from "@/lib/integrations/github-projects";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  try {
    const picker = await githubProjectsPicker(principal.orgId);
    return appData({ ...picker, canManage: rolesFor("settings_billing").includes(principal.role) });
  } catch (error) {
    logServerError("project-tools/github-projects", error);
    return appError("PROJECTS_UNAVAILABLE", "Could not list GitHub Projects. Try again.", 502);
  }
}

export async function PUT(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.projectIds) || body.projectIds.some((id: unknown) => typeof id !== "string" || !id || id.length > 300)) {
    return appError("INVALID_SELECTION", "Choose valid GitHub Projects.", 400);
  }
  try {
    const saved = await saveGitHubProjectSelection(principal.orgId, body.projectIds);
    const sync = saved.selected ? await syncGitHubProjects(principal.orgId) : null;
    await audit({ orgId: principal.orgId, actorType: "user", actorId: principal.userId, action: "integration.github_projects_selected", targetType: "provider_connection", metadata: { count: saved.selected, sync } });
    return appData({ ...saved, sync });
  } catch (error) {
    if (error instanceof GitHubProjectsUnavailable) return appError("PROJECTS_UNAVAILABLE", error.message, 409);
    if (error instanceof Error && /Invalid Project selection|Select only Projects/.test(error.message)) return appError("INVALID_SELECTION", error.message, 400);
    logServerError("project-tools/github-projects/save", error);
    return appError("SAVE_FAILED", "Could not save GitHub Projects.", 502);
  }
}
