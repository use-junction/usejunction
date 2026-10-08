import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData } from "@/lib/api/app-response";
import { loadToolAccountsPage } from "@/lib/app-pages/tool-accounts";
import { rolesFor } from "@/lib/rbac/permissions";

/** Company vs personal AI-tool logins, for owners and admins. */
export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  return appData(await loadToolAccountsPage(principal));
}
