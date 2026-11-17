import { NextRequest, NextResponse } from "next/server";
import { Prisma, prisma } from "@usejunction/db";
import { generateDeviceToken } from "@/lib/auth";
import { DEVICE_AUTH_POLL_INTERVAL_SECONDS, DEVICE_AUTH_STATUS } from "@/lib/device-auth";
import { createDevice, deviceCredentialsPayload } from "@/lib/device-enrollment";
import { logServerError } from "@/lib/errors/public";
import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";
import { getPublicAppUrl } from "@/lib/public-url";
import { assertCanEnrollDevice } from "@/lib/saas-billing/status";
import { hashOpaqueToken } from "@/lib/security";
import { limitedJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const noStore = { "cache-control": "no-store" };

/**
 * The agent asks whether its request was approved. Every known request answers
 * 200 with a `status`; only an approved one carries device credentials, and
 * only once.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, { key: "device-auth-poll", limit: 120, windowSeconds: 60 });
    if (limited !== true) return limited;
    const parsedBody = await limitedJson(req, 4 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const deviceCode = String((parsedBody.data as Record<string, unknown>).deviceCode ?? "").trim();
    if (!deviceCode) return NextResponse.json({ error: "deviceCode required" }, { status: 400 });

    const request = await prisma.deviceAuthRequest.findUnique({
      where: { deviceCodeHash: hashOpaqueToken(deviceCode) },
    });
    if (!request) return NextResponse.json({ error: "unknown device code" }, { status: 404 });

    if (request.status === DEVICE_AUTH_STATUS.denied) {
      return NextResponse.json({ status: "denied" }, { headers: noStore });
    }
    if (request.status === DEVICE_AUTH_STATUS.consumed) {
      return NextResponse.json({ status: "consumed" }, { headers: noStore });
    }
    if (request.expiresAt <= new Date()) {
      return NextResponse.json({ status: "expired" }, { headers: noStore });
    }
    if (request.status !== DEVICE_AUTH_STATUS.approved || !request.orgId || !request.developerId) {
      return NextResponse.json(
        { status: "pending", interval: DEVICE_AUTH_POLL_INTERVAL_SECONDS },
        { headers: noStore },
      );
    }

    const orgId = request.orgId;
    const developerId = request.developerId;

    // Checked at approval too; checked again here because another device may
    // have connected for the same person in between.
    const gate = await assertCanEnrollDevice(orgId, developerId);
    if (!gate.allowed) {
      return NextResponse.json({ status: "failed", error: gate.message }, { headers: noStore });
    }

    const deviceToken = generateDeviceToken();
    let device;
    try {
      device = await prisma.$transaction(async (tx) => {
        const consumed = await tx.deviceAuthRequest.updateMany({
          where: {
            id: request.id,
            status: DEVICE_AUTH_STATUS.approved,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { status: DEVICE_AUTH_STATUS.consumed, consumedAt: new Date() },
        });
        if (consumed.count !== 1) throw new Error("REQUEST_CONSUMED");
        return createDevice(tx, {
          orgId,
          developerId,
          hostname: request.hostname,
          os: request.os,
          architecture: request.architecture,
          agentVersion: request.agentVersion,
          deviceTokenHash: hashOpaqueToken(deviceToken),
          // Approving in the browser is the acknowledgement: the page shows the notice.
          noticedAt: request.approvedAt ?? new Date(),
          noticeVersion: COLLECTION_NOTICE_VERSION,
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "REQUEST_CONSUMED") {
        return NextResponse.json({ status: "consumed" }, { headers: noStore });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { status: "failed", error: "This user already has a device enrolled." },
          { headers: noStore },
        );
      }
      throw error;
    }

    return NextResponse.json(
      {
        ...(await deviceCredentialsPayload({
          deviceId: device.id,
          developerId,
          orgId,
          deviceToken,
          appUrl: getPublicAppUrl(req),
        })),
        // The shared payload says "connected"; the poll answer names the request's state.
        status: "approved",
      },
      { headers: noStore },
    );
  } catch (error) {
    logServerError("device-auth/poll", error);
    return NextResponse.json({ error: "sign-in check failed" }, { status: 500 });
  }
}
