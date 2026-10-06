import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@usejunction/db";
import { assertCanEnrollDevice } from "@/lib/saas-billing/status";
import { generateDeviceToken } from "@/lib/auth";
import { normalizeAgentVersion } from "@/lib/agent-updates";
import { getPublicAppUrl } from "@/lib/public-url";
import { hashOpaqueToken } from "@/lib/security";
import { limitedJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { COLLECTION_NOTICE_VERSION } from "@/lib/legal/versions";
import { logServerError } from "@/lib/errors/public";

async function consumeEnrollmentToken(tx: Prisma.TransactionClient, enrollmentId: string) {
  const consumed = await tx.enrollmentToken.updateMany({
    where: { id: enrollmentId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date(), tokenReveal: null },
  });
  if (consumed.count !== 1) throw new Error("TOKEN_CONSUMED");
}

export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, { key: "enroll", limit: 20, windowSeconds: 60 });
    if (limited !== true) return limited;
    const parsedBody = await limitedJson(req, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;
    const { hostname, os, architecture, agentVersion } = body;
    const token = String(body.token ?? "").trim();
    const noticeVersion = String(body.noticeVersion ?? "").trim();
    const noticedAt = noticeVersion === COLLECTION_NOTICE_VERSION ? new Date() : null;

    if (!token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }

    const tokenHash = hashOpaqueToken(token);
    const enrollment = await prisma.enrollmentToken.findUnique({
      where: { tokenHash },
      include: { developer: true },
    });

    if (!enrollment) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 });
    }

    if (enrollment.usedAt) {
      return NextResponse.json({ error: "token already used" }, { status: 401 });
    }

    if (enrollment.expiresAt < new Date()) {
      return NextResponse.json({ error: "token expired" }, { status: 401 });
    }

    if (!enrollment.developer) {
      return NextResponse.json(
        { error: "legacy unbound token is not supported; generate a new token" },
        { status: 401 },
      );
    }

    const orgId = enrollment.orgId;
    const isRepair = Boolean(enrollment.repairDeviceId);

    if (!isRepair) {
      const enrollmentCheck = await assertCanEnrollDevice(orgId, enrollment.developer.id);
      if (!enrollmentCheck.allowed) {
        return NextResponse.json({ error: enrollmentCheck.message }, { status: 403 });
      }
    }

    const telemetryPromise = prisma.telemetryEndpoint.findUnique({
      where: { orgId },
      select: { enabled: true },
    });

    const deviceToken = generateDeviceToken();
    const deviceTokenHash = hashOpaqueToken(deviceToken);
    let device;
    try {
      device = await prisma.$transaction(async (tx) => {
        if (isRepair) {
          const repairTarget = await tx.device.findFirst({
            where: {
              id: enrollment.repairDeviceId!,
              orgId,
              userId: enrollment.developer!.id,
              decommissionedAt: null,
            },
          });
          if (!repairTarget) {
            throw new Error("REPAIR_DEVICE_UNAVAILABLE");
          }

          await consumeEnrollmentToken(tx, enrollment.id);
          return tx.device.update({
            where: { id: repairTarget.id },
            data: {
              hostname: String(hostname || repairTarget.hostname).slice(0, 255),
              os: String(os || repairTarget.os).slice(0, 64),
              architecture: String(architecture || repairTarget.architecture).slice(0, 64),
              agentVersion: normalizeAgentVersion(agentVersion, repairTarget.agentVersion),
              deviceToken: `rotated:repair:${randomUUID()}`,
              deviceTokenHash,
              collectionNoticeAckAt: noticedAt ?? undefined,
              collectionNoticeVersion: noticedAt ? noticeVersion : undefined,
              localEndpoint: null,
              localSyncTokenHash: null,
              localSyncTokenEnc: null,
            },
          });
        }

        await consumeEnrollmentToken(tx, enrollment.id);
        return tx.device.create({
          data: {
            orgId,
            userId: enrollment.developer!.id,
            hostname: String(hostname || "unknown").slice(0, 255),
            os: String(os || "unknown").slice(0, 64),
            architecture: String(architecture || "unknown").slice(0, 64),
            agentVersion: normalizeAgentVersion(agentVersion, "0.1.0"),
            deviceToken: `rotated:new:${randomUUID()}`,
            deviceTokenHash,
            collectionNoticeAckAt: noticedAt,
            collectionNoticeVersion: noticedAt ? noticeVersion : null,
          },
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TOKEN_CONSUMED") {
        return NextResponse.json({ error: "token already used" }, { status: 401 });
      }
      if (error instanceof Error && error.message === "REPAIR_DEVICE_UNAVAILABLE") {
        return NextResponse.json({ error: "repair device unavailable" }, { status: 410 });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: "This user already has a device enrolled." }, { status: 409 });
      }
      throw error;
    }

    // Release deployment attach runs on first heartbeat (updateDirectiveForHeartbeat).
    const telemetryEndpoint = await telemetryPromise;
    const appUrl = getPublicAppUrl(req);

    return NextResponse.json({
      deviceId: device.id,
      userId: enrollment.developer.id,
      orgId,
      deviceToken,
      // Observability-only product: never point agents at a gateway.
      // Legacy clients may still read this field; keep it empty.
      gatewayUrl: "",
      status: "connected",
      otel: {
        enabled: telemetryEndpoint?.enabled ?? true,
        metricsEndpoint: `${appUrl}/api/otel/v1/metrics`,
      },
    });
  } catch (e) {
    logServerError("enroll", e);
    return NextResponse.json({ error: "enrollment failed" }, { status: 500 });
  }
}
