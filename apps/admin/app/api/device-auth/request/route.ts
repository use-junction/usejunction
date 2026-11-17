import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { auth } from "@/auth";
import { DEVICE_AUTH_STATUS, describeDeviceOs, formatUserCode, normalizeUserCode } from "@/lib/device-auth";
import { collectionNoticeCopy } from "@/lib/privacy/collection-notice";
import { resolveOrgId } from "@/lib/require-organization";
import { assertCanEnrollDevice } from "@/lib/saas-billing/status";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const noStore = { "cache-control": "private, no-store" };

/**
 * What the approval page shows for a code: which machine is asking, and which
 * of the signed-in person's workspaces it can join. Signed-in only, so a code
 * cannot be probed for hostnames by someone guessing.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const limited = await enforceRateLimit(req, { key: "device-auth-request", limit: 30, windowSeconds: 60 });
  if (limited !== true) return limited;

  const userCode = normalizeUserCode(req.nextUrl.searchParams.get("code"));
  const request = userCode
    ? await prisma.deviceAuthRequest.findUnique({ where: { userCode } })
    : null;
  if (!request) {
    return NextResponse.json({ status: "not_found" }, { status: 404, headers: noStore });
  }

  const expired = request.expiresAt <= new Date();
  const status =
    request.status === DEVICE_AUTH_STATUS.pending && expired ? "expired" : request.status;

  // Once someone has decided, only that person learns the outcome.
  if (
    request.status !== DEVICE_AUTH_STATUS.pending &&
    request.approvedByUserId &&
    request.approvedByUserId !== session.user.id
  ) {
    return NextResponse.json({ status: "not_found" }, { status: 404, headers: noStore });
  }

  const [memberships, currentOrgId] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { orgId: true, organization: { select: { name: true } } },
    }),
    resolveOrgId(session.user.id, session.user.orgId),
  ]);

  const workspaces = await Promise.all(
    memberships.map(async (membership) => {
      const developer = await prisma.developer.findFirst({
        where: { orgId: membership.orgId, authUserId: session.user!.id },
        select: { id: true },
      });
      const gate = developer
        ? await assertCanEnrollDevice(membership.orgId, developer.id)
        : ({ allowed: false, message: "Your profile in this workspace is not set up yet." } as const);
      return {
        id: membership.orgId,
        name: membership.organization.name,
        current: membership.orgId === currentOrgId,
        blocked: gate.allowed ? null : gate.message,
      };
    }),
  );

  const currentWorkspace = workspaces.find((workspace) => workspace.current) ?? workspaces[0];

  return NextResponse.json(
    {
      status,
      code: formatUserCode(request.userCode),
      device: {
        hostname: request.hostname,
        os: describeDeviceOs(request.os),
      },
      expiresAt: request.expiresAt.toISOString(),
      workspaces,
      notice: collectionNoticeCopy({ orgName: currentWorkspace?.name }),
    },
    { headers: noStore },
  );
}
