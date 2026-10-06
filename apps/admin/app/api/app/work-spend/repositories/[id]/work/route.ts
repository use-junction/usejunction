import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import { loadRepositoryWork } from "@/lib/app-pages/work-spend-detail";
import { prisma } from "@usejunction/db";
import { loadWorkSpendFeed, WorkFeedInputError } from "@/lib/app-pages/work-spend-feed";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const { id } = await params;
  const query = request.nextUrl.searchParams;
  // Continue in-flight legacy cursors and PR drill-downs; new lists share the
  // workspace feed's ownership, filters, ordering and pagination.
  let legacyCursor = false;
  try { legacyCursor = !!query.get("cursor") && !JSON.parse(Buffer.from(query.get("cursor")!, "base64url").toString()).scope; } catch { /* validated by feed */ }
  if (!query.get("pullRequestId") && !legacyCursor) {
    const access = await prisma.gitHubRepositoryAccess.findFirst({ where: { orgId: principal.orgId, repositoryId: id, connection: { provider: "github", status: { not: "disconnected" } } }, select: { id: true } });
    if (!access) return appError("NOT_FOUND", "Repository not found in this connection.", 404);
    try {
      const data = await loadWorkSpendFeed({ orgId: principal.orgId, repositoryId: id, days: query.get("days"), cursor: query.get("cursor"), q: query.get("q"), type: query.get("type"), projectId: query.get("projectId"), sort: query.get("sort") });
      return appData({ ...data, allocationContext: [] });
    } catch (error) {
      if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
      throw error;
    }
  }
  const data = await loadRepositoryWork({
    orgId: principal.orgId,
    repositoryId: id,
    days: request.nextUrl.searchParams.get("days"),
    cursor: request.nextUrl.searchParams.get("cursor"),
    type: request.nextUrl.searchParams.get("type"),
    pullRequestId: request.nextUrl.searchParams.get("pullRequestId"),
    projectId: request.nextUrl.searchParams.get("projectId"),
  });
  if (!data) return appError("NOT_FOUND", "Repository or pull request not found in this connection.", 404);
  return appData(data);
}
