import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createGitHubState,
  githubAppInstallUrl,
  GITHUB_CONNECT_COOKIE,
  GITHUB_RETURN_PATHS,
} from "@/lib/integrations/github-app";
import { requireOrgRole, rolesFor } from "@/lib/rbac";

const query = z.object({
  returnTo: z.enum(GITHUB_RETURN_PATHS).default("/work-spend"),
});

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const parsed = query.safeParse({
    returnTo: req.nextUrl.searchParams.get("returnTo") ?? "/work-spend",
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid GitHub return path" }, { status: 400 });
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ error: "GITHUB_APP_SLUG is not configured" }, { status: 503 });

  const state = createGitHubState({
    orgId: auth.orgId,
    userId: auth.userId,
    returnTo: parsed.data.returnTo,
    expiresAt: Date.now() + 10 * 60_000,
  });

  const response = NextResponse.redirect(githubAppInstallUrl(slug, state));
  response.cookies.set({
    name: GITHUB_CONNECT_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
