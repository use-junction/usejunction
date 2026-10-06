import { NextRequest, NextResponse } from "next/server";
import { githubAppOwnerInstallationsUrl, listGitHubAppInstallations } from "@/lib/integrations/github-app";
import { listLinkedGitHubInstallationIds } from "@/lib/integrations/github-connections";
import { requireOrgRole, rolesFor } from "@/lib/rbac";
import { logServerError } from "@/lib/errors/public";

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const slug = process.env.GITHUB_APP_SLUG;
  try {
    const [installations, linked] = await Promise.all([
      listGitHubAppInstallations(),
      listLinkedGitHubInstallationIds(auth.orgId),
    ]);
    return NextResponse.json({
      installations: installations.flatMap((installation) => {
        if (linked.otherWorkspaces.has(installation.id)) return [];
        return [{ ...installation, linked: linked.thisWorkspace.has(installation.id) }];
      }),
      installAppUrl: slug ? githubAppOwnerInstallationsUrl(slug) : null,
    });
  } catch (error) {
    logServerError("integrations/github/installations", error);
    return NextResponse.json({ error: "unable to list GitHub App installations" }, { status: 502 });
  }
}
