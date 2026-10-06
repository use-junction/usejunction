import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appError } from "@/lib/api/app-response";
import { loadWorkSpendExport, WorkFeedInputError } from "@/lib/app-pages/work-spend-feed";
import { logServerError } from "@/lib/errors/public";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  try {
    const csv = await loadWorkSpendExport({ orgId: principal.orgId, days: request.nextUrl.searchParams.get("days") });
    const days = request.nextUrl.searchParams.get("days") === "30" ? "30" : "90";
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="work-spend-${days}d.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
    logServerError("work-spend/export", error);
    return appError("LOAD_FAILED", "Couldn’t export work allocations. Please try again.", 500);
  }
}
