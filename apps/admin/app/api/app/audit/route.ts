import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData } from "@/lib/api/app-response";
import { isAuditCategory, readAuditLog } from "@/lib/audit/read";
import { rolesFor } from "@/lib/rbac/permissions";

/** Workspace audit trail for owners and admins. */
export async function GET(request: NextRequest) {
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  const params = request.nextUrl.searchParams;
  const category = params.get("category");
  const cursor = params.get("cursor");
  const data = await readAuditLog(principal.orgId, {
    category: isAuditCategory(category) ? category : undefined,
    cursor: cursor && cursor.length <= 64 ? cursor : null,
  });
  return appData(data);
}
