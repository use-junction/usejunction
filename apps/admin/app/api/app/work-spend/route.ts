import { NextRequest, NextResponse, after } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError, timingHeader } from "@/lib/api/app-response";
import { loadWorkSpendPage } from "@/lib/app-pages/work-spend";
import { resyncStaleGitHubConnections } from "@/lib/integrations/stale-resync";
import { rolesFor } from "@/lib/rbac/permissions";

/** Overdue GitHub connections resync after the response; give that work the full function window. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const started = performance.now();
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  const authenticated = performance.now();
  if (principal instanceof NextResponse) return principal;
  // Claim before loading so a connection the scheduler missed reads as syncing, not stuck.
  await resyncStaleGitHubConnections(principal.orgId, after);
  const data = await loadWorkSpendPage(principal, {
    days: request.nextUrl.searchParams.get("days"),
    repositoryId: request.nextUrl.searchParams.get("repositoryId"),
  });
  const requestedRepository = request.nextUrl.searchParams.get("repositoryId");
  if (requestedRepository && data.selectedRepositoryId !== requestedRepository) {
    return appError("NOT_FOUND", "Repository is not granted to this GitHub connection.", 404);
  }
  return appData(data, { serverTiming: timingHeader({ auth: authenticated - started, data: performance.now() - authenticated }) });
}
