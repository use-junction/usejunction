import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { loadWorkSpendDistribution } from "@/lib/app-pages/work-spend-feed";
import { logServerError } from "@/lib/errors/public";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  try { return appData(await loadWorkSpendDistribution({ orgId: principal.orgId, days: request.nextUrl.searchParams.get("days") })); }
  catch (error) {
    logServerError("work-spend/distribution", error);
    return appError("LOAD_FAILED", "Couldn’t load the Project breakdown. Please try again.", 500);
  }
}
