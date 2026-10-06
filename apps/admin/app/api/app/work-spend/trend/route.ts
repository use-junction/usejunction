import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { loadWorkSpendTrend, WorkFeedInputError } from "@/lib/app-pages/work-spend-feed";
import { logServerError } from "@/lib/errors/public";
import { canManageSettings, rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const by = request.nextUrl.searchParams.get("by") ?? "repository";
  if (by !== "repository" && by !== "project" && by !== "person") {
    return appError("INVALID_INPUT", "Trend grouping must be repository, project, or person.", 400);
  }
  if (by === "person" && !canManageSettings(principal.role)) {
    return appError("FORBIDDEN", "Person allocation is limited to owners and admins.", 403);
  }
  try {
    return appData(await loadWorkSpendTrend({ orgId: principal.orgId, days: request.nextUrl.searchParams.get("days"), by }));
  } catch (error) {
    if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
    logServerError("work-spend/trend", error);
    return appError("LOAD_FAILED", "Couldn’t load the allocation trend. Please try again.", 500);
  }
}
