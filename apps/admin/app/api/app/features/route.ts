import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, timingHeader } from "@/lib/api/app-response";
import { loadFeaturesPage } from "@/lib/app-pages/features";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const started = performance.now();
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  const authenticated = performance.now();
  if (principal instanceof NextResponse) return principal;
  const data = await loadFeaturesPage(principal, { days: request.nextUrl.searchParams.get("days") });
  const loaded = performance.now();
  return appData(data, {
    serverTiming: timingHeader({
      auth: authenticated - started,
      data: loaded - authenticated,
      total: loaded - started,
    }),
  });
}
