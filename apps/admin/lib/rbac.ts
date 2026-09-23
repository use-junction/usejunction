import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@usejunction/db";
import { getWorkspaceContext } from "@/lib/workspace-context";
import type { OrganizationRole } from "@/lib/rbac/permissions";
import { browserMutationGuard } from "@/lib/security/http";

export type { OrganizationRole, Capability } from "@/lib/rbac/permissions";
export {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  ORGANIZATION_ROLES,
  canManageSettings,
  canManagePrivacy,
  canSeeOrgOverview,
  hasCapability,
  isAssignableRole,
  isSelfScopedRole,
  rolesFor,
} from "@/lib/rbac/permissions";

export async function requireOrgRole(
  req: NextRequest,
  allowed: readonly OrganizationRole[]
): Promise<{ email: string; userId: string; orgId: string; role: OrganizationRole } | NextResponse> {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const ctx = await getWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.orgId) return NextResponse.json({ error: "organization setup required" }, { status: 409 });

  const role = ctx.role;
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return { email: ctx.email, userId: ctx.userId, orgId: ctx.orgId, role };
}

export async function audit(input: {
  orgId: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({ data: input });
}
