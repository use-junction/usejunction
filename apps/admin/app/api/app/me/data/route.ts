import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, timingHeader } from "@/lib/api/app-response";
import { loadMyDataPage } from "@/lib/app-pages/my-data";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest) {
  const started = performance.now();
  const principal = await requireAppPrincipal(request, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;
  const data = await loadMyDataPage(principal);
  return appData(data, {
    serverTiming: timingHeader({ total: performance.now() - started }),
  });
}
