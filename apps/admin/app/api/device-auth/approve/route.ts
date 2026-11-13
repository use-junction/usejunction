import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { auth } from "@/auth";
import { DEVICE_AUTH_STATUS, normalizeUserCode } from "@/lib/device-auth";
import { getIdentityVerificationStatus } from "@/lib/developer-identity";
import { isAuthUserNotFoundError } from "@/lib/ensure-auth-user";
import { ensureOwnerWorkspace, isPendingInviteError } from "@/lib/ensure-workspace";
import { logServerError } from "@/lib/errors/public";
import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";
import { PRIVACY_AUDIT_ACTIONS } from "@/lib/privacy/audit-actions";
import { audit } from "@/lib/rbac";
import { ACTIVE_ORG_COOKIE, resolveOrgId } from "@/lib/require-organization";
import { assertCanEnrollDevice } from "@/lib/saas-billing/status";
import { browserMutationGuard, limitedJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { syncSessionWorkspace } from "@/lib/workspace-session";

/** An approval made in the last seconds of a request still has to reach the agent's next poll. */
const APPROVED_GRACE_MS = 2 * 60 * 1000;

/**
 * A signed-in person approves (or refuses) the machine behind a user code.
 * Approving ties the request to their profile in one workspace and records
 * that they saw the collection notice; the agent's next poll creates the device.
 */
export async function POST(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;

  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "authentication required" }, { status: 401 });
    }
    const limited = await enforceRateLimit(req, { key: "device-auth-approve", limit: 20, windowSeconds: 60 });
    if (limited !== true) return limited;

    const identity = await getIdentityVerificationStatus(session.user.id);
    if (!identity.verified) {
      return NextResponse.json({ error: identity.error }, { status: identity.status });
    }

    const parsedBody = await limitedJson(req, 4 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;
    const userCode = normalizeUserCode(typeof body.code === "string" ? body.code : null);
    const decision = body.decision === "deny" ? "deny" : body.decision === "approve" ? "approve" : null;
    if (!userCode || !decision) {
      return NextResponse.json({ error: "code and decision are required" }, { status: 400 });
    }

    const request = await prisma.deviceAuthRequest.findUnique({ where: { userCode } });
    if (!request) {
      return NextResponse.json({ error: "This code is not valid. Run the install command again." }, { status: 404 });
    }
    const now = new Date();
    if (request.status !== DEVICE_AUTH_STATUS.pending) {
      return NextResponse.json({ error: "This code has already been used." }, { status: 409 });
    }
    if (request.expiresAt <= now) {
      return NextResponse.json({ error: "This code has expired. Run the install command again." }, { status: 410 });
    }

    if (decision === "deny") {
      await prisma.deviceAuthRequest.updateMany({
        where: { id: request.id, status: DEVICE_AUTH_STATUS.pending },
        data: { status: DEVICE_AUTH_STATUS.denied, approvedByUserId: session.user.id },
      });
      return NextResponse.json({ status: "denied" });
    }

    // Which workspace: the one named on the page, else the active one, else a
    // new personal workspace for someone who has none yet.
    const requestedOrgId = typeof body.orgId === "string" && body.orgId ? body.orgId : null;
    let orgId: string | null = null;
    if (requestedOrgId) {
      const membership = await prisma.organizationMembership.findUnique({
        where: { userId_orgId: { userId: session.user.id, orgId: requestedOrgId } },
        select: { orgId: true },
      });
      if (!membership) {
        return NextResponse.json({ error: "You are not a member of that workspace." }, { status: 403 });
      }
      orgId = membership.orgId;
    } else {
      orgId = await resolveOrgId(session.user.id, session.user.orgId);
    }
    if (!orgId) {
      try {
        const workspace = await ensureOwnerWorkspace(
          { id: session.user.id, email: session.user.email, name: session.user.name },
          { rejectPendingInvite: true },
        );
        if (workspace.userId && workspace.userId !== session.user.id) {
          return NextResponse.json({ error: "session expired, sign in again" }, { status: 401 });
        }
        orgId = workspace.orgId;
      } catch (error) {
        if (isAuthUserNotFoundError(error)) {
          return NextResponse.json({ error: "session expired, sign in again" }, { status: 401 });
        }
        if (isPendingInviteError(error)) {
          return NextResponse.json(
            { error: "You have a pending workspace invite. Accept it first, then run the install command again." },
            { status: 409 },
          );
        }
        throw error;
      }
    }

    const developer = await prisma.developer.findFirst({
      where: { orgId, authUserId: session.user.id },
      select: { id: true },
    });
    if (!developer) {
      return NextResponse.json({ error: "Your profile in this workspace is not set up yet." }, { status: 409 });
    }

    const gate = await assertCanEnrollDevice(orgId, developer.id);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.message }, { status: 403 });
    }

    const graceEnd = new Date(now.getTime() + APPROVED_GRACE_MS);
    const approved = await prisma.$transaction(async (tx) => {
      const updated = await tx.deviceAuthRequest.updateMany({
        where: { id: request.id, status: DEVICE_AUTH_STATUS.pending, expiresAt: { gt: now } },
        data: {
          status: DEVICE_AUTH_STATUS.approved,
          approvedByUserId: session.user!.id,
          orgId,
          developerId: developer.id,
          approvedAt: now,
          expiresAt: request.expiresAt > graceEnd ? request.expiresAt : graceEnd,
        },
      });
      if (updated.count !== 1) return false;
      await tx.organizationMembership.update({
        where: { userId_orgId: { userId: session.user!.id, orgId: orgId! } },
        data: { collectionNoticeAckAt: now, collectionNoticeVersion: COLLECTION_NOTICE_VERSION },
      });
      return true;
    });
    if (!approved) {
      return NextResponse.json({ error: "This code has already been used." }, { status: 409 });
    }

    await Promise.all([
      audit({
        orgId,
        actorType: "user",
        actorId: session.user.id,
        action: "device_auth.approved",
        targetType: "device_auth_request",
        targetId: request.id,
        metadata: { hostname: request.hostname, os: request.os },
      }),
      audit({
        orgId,
        actorType: "user",
        actorId: session.user.id,
        action: PRIVACY_AUDIT_ACTIONS.collectionNoticeAcknowledged,
        targetType: "membership",
        metadata: { version: COLLECTION_NOTICE_VERSION },
      }),
    ]);

    // Open the dashboard on the workspace the device just joined.
    const response = NextResponse.json({ status: "approved", orgId });
    if (session.user.orgId !== orgId) {
      const synced = await syncSessionWorkspace(session.user.id, orgId);
      if (synced.ok) response.cookies.delete(ACTIVE_ORG_COOKIE);
    }
    return response;
  } catch (error) {
    logServerError("device-auth/approve", error);
    return NextResponse.json({ error: "Could not connect this device. Try again." }, { status: 500 });
  }
}
