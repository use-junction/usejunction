import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole, audit, rolesFor } from "@/lib/rbac";
import { getPublicAppUrl } from "@/lib/public-url";
import {
  exchangeLinearCode,
  LINEAR_CONNECT_COOKIE,
  LINEAR_RETURN_PATH,
  verifyLinearState,
} from "@/lib/integrations/linear";
import { saveLinearConnection, syncLinearConnection } from "@/lib/integrations/linear-sync";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 300;

function returnUrl(request: NextRequest, status: string) {
  const url = new URL(LINEAR_RETURN_PATH, getPublicAppUrl(request));
  url.searchParams.set("linear", status);
  return url;
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set({
    name: LINEAR_CONNECT_COOKIE,
    value: "",
    path: "/api/integrations/linear",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) {
    if (auth.status === 401) {
      const login = new URL("/login", getPublicAppUrl(req));
      login.searchParams.set("from", `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
    return auth;
  }
  const queryState = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(LINEAR_CONNECT_COOKIE)?.value;
  if (!queryState || !cookieState || queryState !== cookieState) {
    return NextResponse.json({ error: "invalid Linear connection state" }, { status: 400 });
  }
  let state;
  try {
    state = verifyLinearState(queryState);
  } catch {
    return NextResponse.json({ error: "invalid or expired Linear connection state" }, { status: 400 });
  }
  if (state.orgId !== auth.orgId || state.userId !== auth.userId) {
    return NextResponse.json({ error: "Linear connection state does not match this administrator" }, { status: 403 });
  }
  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError || !code) {
    return clearStateCookie(NextResponse.redirect(returnUrl(req, oauthError === "access_denied" ? "denied" : "error")));
  }
  try {
    const redirectUri = new URL("/api/integrations/linear/callback", getPublicAppUrl(req)).toString();
    const tokens = await exchangeLinearCode(code, redirectUri);
    const connection = await saveLinearConnection(auth.orgId, auth.userId, tokens);
    await audit({
      orgId: auth.orgId,
      actorType: "user",
      actorId: auth.userId,
      action: "integration.linear_connected",
      targetType: "project_tool_connection",
      targetId: connection.id,
      metadata: { workspaceId: connection.externalWorkspaceId },
    });
    let status = "connected";
    try {
      await syncLinearConnection(auth.orgId);
    } catch (error) {
      logServerError("integrations/linear/initial-sync", error);
      status = "sync_error";
    }
    return clearStateCookie(NextResponse.redirect(returnUrl(req, status)));
  } catch (error) {
    logServerError("integrations/linear/callback", error);
    return clearStateCookie(NextResponse.redirect(returnUrl(req, "error")));
  }
}
