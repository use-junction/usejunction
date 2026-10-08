import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData } from "@/lib/api/app-response";
import { parseAudienceScope } from "@/lib/audience-scope";
import { buildDailyReportEmailDocument } from "@/lib/email/daily-report-html";
import { getPublicAppUrl } from "@/lib/public-url";
import { buildSampleReport } from "@/lib/reports/sample-report";

/** A made-up digest rendered through the real email template, shown while nothing has been sent. */
export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request);
  if (principal instanceof NextResponse) return principal;

  const audience =
    principal.role === "user" ? ("you" as const) : parseAudienceScope(request.nextUrl.searchParams.get("scope"));
  const built = buildDailyReportEmailDocument({
    report: buildSampleReport(audience),
    recipientName: principal.name ?? null,
    appOrigin: getPublicAppUrl(request),
  });

  return appData({ subject: built.subject, html: built.html });
}
