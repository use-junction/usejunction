import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@usejunction/db";
import {
  getGitHubInstallation,
  GITHUB_CONNECT_COOKIE,
  GITHUB_RETURN_PATHS,
  normalizeGitHubAccountType,
  type GitHubReturnTo,
  verifyGitHubState,
} from "@/lib/integrations/github-app";
import { findClaimedGitHubInstallation, findGitHubConnectionByAccount } from "@/lib/integrations/github-connections";
import { requireOrgRole, audit, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";

/**
 * Completes a GitHub App install.
 *
 * Preferred: GitHub redirects here with `installation_id` + `state` after
 * Connect GitHub (Setup URL + Redirect on update).
 *
 * Fallback: signed-in owners/admins can finish a stuck install with only
 * `installation_id` (GitHub left them on the installation settings page).
 */
export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) {
    if (auth.status === 401) {
      const from = `${req.nextUrl.pathname}${req.nextUrl.search}`;
      const login = new URL("/login", req.nextUrl.origin);
      login.searchParams.set("from", from);
      return NextResponse.redirect(login);
    }
    return auth;
  }
  const installationId = req.nextUrl.searchParams.get("installation_id");
  if (!installationId) {
    return NextResponse.json({ error: "missing installation_id" }, { status: 400 });
  }

  const queryState = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get(GITHUB_CONNECT_COOKIE)?.value;
  const stateValue = queryState ?? cookieState;
  let returnTo: GitHubReturnTo = "/work-spend";
  if (stateValue) {
    try {
      const state = verifyGitHubState(stateValue);
      if (state.userId !== auth.userId || state.orgId !== auth.orgId) {
        return NextResponse.json({ error: "GitHub connection state does not match the signed-in administrator" }, { status: 403 });
      }
      if (state.returnTo && GITHUB_RETURN_PATHS.includes(state.returnTo)) returnTo = state.returnTo;
    } catch (error) {
      if (queryState) {
        logServerError("integrations/github/callback", error);
        return NextResponse.json({ error: "invalid GitHub connection state" }, { status: 400 });
      }
    }
  }

  let installation: Record<string, any>;
  try {
    installation = await getGitHubInstallation(installationId);
  } catch (error) {
    logServerError("integrations/github/callback", error);
    return NextResponse.json({ error: "unable to load GitHub installation" }, { status: 502 });
  }

  const accountLogin = String(installation.account?.login ?? "");
  const accountType = normalizeGitHubAccountType(installation.account?.type);
  if (!accountLogin || !accountType) {
    return NextResponse.json({ error: "Install the GitHub App on a personal account or organization" }, { status: 422 });
  }

  const config = {
    product: "copilot",
    org: accountLogin,
    installationId,
    accountType,
  } as Prisma.InputJsonValue;

  const claimed = await findClaimedGitHubInstallation(installationId, auth.orgId);
  if (claimed) {
    return NextResponse.json({ error: "This GitHub installation is already connected to another workspace" }, { status: 409 });
  }

  const existing = await findGitHubConnectionByAccount(auth.orgId, accountLogin);
  const data = {
    method: "oauth" as const,
    status: "pending" as const,
    externalOrgId: accountLogin,
    credentialCiphertext: null,
    credentialFingerprint: `app:${installationId.slice(-8)}`,
    config,
    permissions: installation.permissions as Prisma.InputJsonValue,
    nextSyncAt: new Date(),
    lastError: null,
  };
  const connection = existing
    ? await prisma.providerConnection.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    })
    : await prisma.providerConnection.create({
      data: {
        orgId: auth.orgId,
        provider: "github",
        product: "copilot",
        createdByUserId: auth.userId,
        ...data,
      },
      select: { id: true },
    });

  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: "integration.github_app_installed",
    targetType: "provider_connection",
    targetId: connection.id,
    metadata: { installationId, githubAccount: accountLogin, accountType, hadState: Boolean(stateValue) },
  });

  const redirect = NextResponse.redirect(new URL(`${returnTo}?connected=github&connection=${connection.id}`, req.nextUrl.origin));
  redirect.cookies.delete(GITHUB_CONNECT_COOKIE);
  return redirect;
}
