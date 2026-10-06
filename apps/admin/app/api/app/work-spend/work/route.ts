import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { loadWorkSpendFeed, WorkFeedInputError } from "@/lib/app-pages/work-spend-feed";
import { logServerError } from "@/lib/errors/public";
import { canManageSettings, rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const params = request.nextUrl.searchParams;
  const developerId = params.get("developerId");
  if (developerId && !canManageSettings(principal.role)) {
    return appError("FORBIDDEN", "Person allocation is limited to owners and admins.", 403);
  }
  try {
    return appData(await loadWorkSpendFeed({ orgId: principal.orgId, days: params.get("days"), repositoryId: params.get("repositoryId"),
      projectId: params.get("projectId"), developerId, q: params.get("q"), type: params.get("type"), sort: params.get("sort"), cursor: params.get("cursor"), workState: params.get("workState") }));
  } catch (error) {
    if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
    logServerError("work-spend/query", error);
    return appError("LOAD_FAILED", "Couldn’t load work. Please try again.", 500);
  }
}
