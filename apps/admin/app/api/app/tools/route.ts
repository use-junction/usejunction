import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, timingHeader } from "@/lib/api/app-response";
import { loadToolsPage } from "@/lib/app-pages/tools";

export async function GET(request: NextRequest) {
  const started = performance.now();
  const principal = await requireAppPrincipal(request);
  const authenticated = performance.now();
  if (principal instanceof NextResponse) return principal;

  const query = request.nextUrl.searchParams;
  const data = await loadToolsPage(principal, {
    view: query.get("view"),
    days: query.get("days"),
    from: query.get("from"),
    to: query.get("to"),
    team: query.get("team"),
  });
  const loaded = performance.now();
  return appData(data, {
    serverTiming: timingHeader({
      auth: authenticated - started,
      data: loaded - authenticated,
      total: loaded - started,
    }),
  });
}
