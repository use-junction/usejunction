import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole, rolesFor } from "@/lib/rbac";
import { getPublicAppUrl } from "@/lib/public-url";
import {
  createLinearState,
  linearAuthorizationUrl,
  linearConfigured,
  LINEAR_CONNECT_COOKIE,
} from "@/lib/integrations/linear";

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  if (!linearConfigured()) {
    return NextResponse.json({ error: "Linear connection is not configured" }, { status: 503 });
  }
  const state = createLinearState(auth.orgId, auth.userId);
  const redirectUri = new URL("/api/integrations/linear/callback", getPublicAppUrl(req)).toString();
  const response = NextResponse.redirect(linearAuthorizationUrl(state, redirectUri));
  response.cookies.set({
    name: LINEAR_CONNECT_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    path: "/api/integrations/linear",
    maxAge: 10 * 60,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
