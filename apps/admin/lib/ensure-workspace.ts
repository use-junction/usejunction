import { randomBytes } from "crypto";
import { prisma } from "@usejunction/db";
import {
  AuthUserNotFoundError,
  isMissingAuthUserPrismaError,
  resolveAuthUser,
  type AuthUserInput,
  type ResolvedAuthUser,
} from "@/lib/ensure-auth-user";
import { logServerError } from "@/lib/errors/public";
import { hasPendingWorkspaceInvite } from "@/lib/onboarding-status";
import { deploymentRegion } from "@/lib/region";

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || `org-${randomBytes(3).toString("hex")}`
  );
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Default workspace label from the person's name, or email local-part.
 * e.g. "Dinu Devs" → "Dinu Devs workspace"; "dinu.dayan" → "Dinu Dayan workspace"
 */
export function suggestedWorkspaceName(user: { email: string; name?: string | null }) {
  const fromName = user.name?.trim();
  if (fromName) {
    return `${fromName} workspace`.slice(0, 80);
  }

  const local = user.email.split("@")[0] ?? "";
  const cleaned = local
    .replace(/[._+\-]+/g, " ")
    .replace(/\d+/g, " ")
    .trim();
  const person = titleCaseWords(cleaned) || "My";
  return `${person} workspace`.slice(0, 80);
}

export type WorkspaceUser = AuthUserInput;

export class PendingInviteError extends Error {
  readonly code = "invite_pending" as const;

  constructor(message = "invite_pending") {
    super(message);
    this.name = "PendingInviteError";
  }
}

export function isPendingInviteError(error: unknown): error is PendingInviteError {
  return error instanceof PendingInviteError;
}

export type ProvisionOnCreateResult =
  | { provisioned: true }
  | { provisioned: false; reason: "missing_identity" | "invite_pending" | "error" };

/**
 * Best-effort personal workspace for OAuth createUser.
 * Invitees are skipped; other failures are logged and do not fail Auth.js signup.
 */
export async function provisionWorkspaceOnCreateUser(user: {
  id?: string | null;
  email?: string | null;
  name?: string | null;
}): Promise<ProvisionOnCreateResult> {
  if (!user.id || !user.email) {
    return { provisioned: false, reason: "missing_identity" };
  }

  try {
    await ensureOwnerWorkspace(
      { id: user.id, email: user.email, name: user.name },
      { rejectPendingInvite: true },
    );
    return { provisioned: true };
  } catch (error) {
    if (isPendingInviteError(error)) {
      return { provisioned: false, reason: "invite_pending" };
    }
    logServerError("auth/createUser/workspace", error);
    return { provisioned: false, reason: "error" };
  }
}

/** Create a personal workspace for an already-resolved auth user (no extra user lookup). */
export async function createWorkspaceForUser(
  authUser: ResolvedAuthUser,
  options?: { name?: string; color?: string | null },
) {
  const name = options?.name?.trim() || suggestedWorkspaceName(authUser);
  const slug = `${slugify(name)}-${randomBytes(2).toString("hex")}`;
  const color = options?.color?.trim() || null;

  let organization;
  try {
    organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name, slug, color, plan: "community", dataRegion: deploymentRegion() },
      });
      await tx.organizationMembership.create({
        data: { userId: authUser.id, orgId: org.id, role: "owner" },
      });
      await tx.developer.create({
        data: {
          orgId: org.id,
          authUserId: authUser.id,
          name: authUser.name?.trim() || authUser.email.split("@")[0],
          email: authUser.email.trim().toLowerCase(),
          role: "owner",
        },
      });
      await tx.planInterest.updateMany({
        where: { userId: authUser.id, orgId: null },
        data: { orgId: org.id },
      });
      return org;
    });
  } catch (error) {
    if (isMissingAuthUserPrismaError(error)) {
      throw new AuthUserNotFoundError();
    }
    throw error;
  }

  return {
    orgId: organization.id,
    userId: authUser.id,
    name: organization.name,
    slug: organization.slug,
    color: organization.color,
    role: "owner" as const,
    created: true as const,
  };
}

export async function createWorkspace(
  user: WorkspaceUser,
  options?: { name?: string; color?: string | null },
) {
  const authUser = await resolveAuthUser(user);
  return createWorkspaceForUser(authUser, options);
}

/** Returns an existing membership (newest first) or creates a personal workspace. */
export async function ensureOwnerWorkspace(
  user: WorkspaceUser,
  options?: { name?: string; rejectPendingInvite?: boolean },
) {
  const authUser = await resolveAuthUser(user);
  const existing = await prisma.organizationMembership.findFirst({
    where: { userId: authUser.id },
    select: { orgId: true, role: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return {
      orgId: existing.orgId,
      userId: authUser.id,
      role: existing.role,
      created: false as const,
    };
  }

  if (options?.rejectPendingInvite && (await hasPendingWorkspaceInvite(authUser.email))) {
    throw new PendingInviteError();
  }

  return createWorkspaceForUser(authUser, { name: options?.name });
}
