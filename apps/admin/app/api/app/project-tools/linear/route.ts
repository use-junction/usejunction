import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData } from "@/lib/api/app-response";
import { linearConnectionSummary } from "@/lib/integrations/linear-sync";
import { linearConfigured } from "@/lib/integrations/linear";
import { rolesFor } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const summary = await linearConnectionSummary(principal.orgId);
  return appData({ ...summary, available: linearConfigured(), canManage: rolesFor("settings_billing").includes(principal.role) });
}
