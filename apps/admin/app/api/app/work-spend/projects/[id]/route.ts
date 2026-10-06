import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { appData, appError } from "@/lib/api/app-response";
import {
  loadProjectInspection,
  parseProjectAttributionMode,
  updateProjectAttributionMode,
  WorkFeedInputError,
} from "@/lib/app-pages/work-spend-feed";
import { logServerError } from "@/lib/errors/public";
import { rolesFor } from "@/lib/rbac/permissions";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireAppPrincipal(request, rolesFor("org_overview"));
  if (principal instanceof NextResponse) return principal;
  const { id } = await params;
  try {
    const data = await loadProjectInspection({ orgId: principal.orgId, projectId: id, days: request.nextUrl.searchParams.get("days") });
    if (!data) return appError("NOT_FOUND", "Project not found in this connection.", 404);
    return appData({
      ...data,
      canManage: rolesFor("settings_billing").includes(principal.role),
    });
  } catch (error) {
    if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
    logServerError("work-spend/project", error);
    return appError("LOAD_FAILED", "Couldn’t load this project. Please try again.", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireAppPrincipal(request, rolesFor("settings_billing"));
  if (principal instanceof NextResponse) return principal;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => null);
    const attributionMode = parseProjectAttributionMode(body && typeof body === "object" ? (body as { attributionMode?: unknown }).attributionMode : null);
    const updated = await updateProjectAttributionMode({ orgId: principal.orgId, projectId: id, attributionMode });
    return updated ? appData({ attributionMode }) : appError("NOT_FOUND", "Project not found in this connection.", 404);
  } catch (error) {
    if (error instanceof WorkFeedInputError) return appError("INVALID_INPUT", error.message, 400);
    logServerError("work-spend/project-mode", error);
    return appError("UPDATE_FAILED", "Couldn’t update how this project is split. Please try again.", 500);
  }
}
