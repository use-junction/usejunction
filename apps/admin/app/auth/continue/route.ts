import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeAuthReturnPath } from "@/lib/auth/oauth-account-conflict";
import { resolveOrgId } from "@/lib/require-organization";
import { prisma } from "@usejunction/db";
import { canSeeOrgOverview, type OrganizationRole } from "@/lib/rbac/permissions";

/**
 * Post-auth landing: send first-time / incomplete users straight to onboarding
 * without flashing /dashboard, and everyone else to the home for their role.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const from = safeAuthReturnPath(request.nextUrl.searchParams.get("from") ?? undefined);

  const orgId = await resolveOrgId(session.user.id, session.user.orgId);
  if (!orgId) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_orgId: { userId: session.user.id, orgId } },
    select: { onboardingCompletedAt: true, role: true },
  });

  if (!membership?.onboardingCompletedAt) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // Owners, admins and managers land on the workspace Overview; developers on their own numbers.
  const home = canSeeOrgOverview(membership.role as OrganizationRole) ? "/overview" : "/dashboard";
  const destination = from === "/onboarding" || from === "/dashboard" || from === "/" ? home : from;
  return NextResponse.redirect(new URL(destination, request.url));
}
