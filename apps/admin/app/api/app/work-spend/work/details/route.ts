import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { loadWorkSpendDetails, WorkFeedInputError } from "@/lib/app-pages/work-spend-feed";
import { logServerError } from "@/lib/errors/public";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const params = request.nextUrl.searchParams;
  try {
    const data = await loadWorkSpendDetails({ orgId: principal.orgId, repositoryId: params.get("repositoryId") ?? "",
      kind: params.get("kind") ?? "", workId: params.get("workId") ?? "", days: params.get("days"),
      cursor: params.get("cursor"), evidenceCursor: params.get("evidenceCursor") });
    return data ? appData(data) : appError("NOT_FOUND", "Work not found in the current repository access and date range.", 404);
  } catch (error) {
    if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
    logServerError("work-spend/query", error);
    return appError("LOAD_FAILED", "Couldn’t load work. Please try again.", 500);
  }
}
