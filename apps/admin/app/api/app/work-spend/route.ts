import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError, timingHeader } from "@/lib/api/app-response";
import { loadWorkSpendPage } from "@/lib/app-pages/work-spend";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const started = performance.now();
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  const authenticated = performance.now();
  if (principal instanceof NextResponse) return principal;
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
