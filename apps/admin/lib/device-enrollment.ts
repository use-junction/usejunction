import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@usejunction/db";
import { normalizeAgentVersion } from "@/lib/agent-updates";

/**
 * Device creation and the credentials payload, shared by the two ways a
 * device connects: an enroll token (`/api/enroll`) and browser approval
 * (`/api/device-auth/poll`). Both must hand the agent the same thing.
 */

export type NewDeviceInput = {
  orgId: string;
  developerId: string;
  hostname: unknown;
  os: unknown;
  architecture: unknown;
  agentVersion: unknown;
  deviceTokenHash: string;
  /** When the person acknowledged the collection notice, if they did. */
  noticedAt: Date | null;
  noticeVersion: string | null;
};

export function createDevice(tx: Prisma.TransactionClient, input: NewDeviceInput) {
  return tx.device.create({
    data: {
      orgId: input.orgId,
      userId: input.developerId,
      hostname: String(input.hostname || "unknown").slice(0, 255),
      os: String(input.os || "unknown").slice(0, 64),
      architecture: String(input.architecture || "unknown").slice(0, 64),
      agentVersion: normalizeAgentVersion(input.agentVersion, "0.1.0"),
      deviceToken: `rotated:new:${randomUUID()}`,
      deviceTokenHash: input.deviceTokenHash,
      collectionNoticeAckAt: input.noticedAt,
      collectionNoticeVersion: input.noticedAt ? input.noticeVersion : null,
    },
  });
}

export async function deviceCredentialsPayload(input: {
  deviceId: string;
  developerId: string;
  orgId: string;
  deviceToken: string;
  appUrl: string;
  telemetryEnabled?: boolean | null;
}) {
  const telemetryEnabled =
    input.telemetryEnabled !== undefined
      ? input.telemetryEnabled
      : (
          await prisma.telemetryEndpoint.findUnique({
            where: { orgId: input.orgId },
            select: { enabled: true },
          })
        )?.enabled;

  return {
    deviceId: input.deviceId,
    userId: input.developerId,
    orgId: input.orgId,
    deviceToken: input.deviceToken,
    // Observability-only product: never point agents at a gateway.
    // Legacy clients may still read this field; keep it empty.
    gatewayUrl: "",
    status: "connected",
    otel: {
      enabled: telemetryEnabled ?? true,
      metricsEndpoint: `${input.appUrl}/api/otel/v1/metrics`,
    },
  };
}
