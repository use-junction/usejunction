import { NextRequest, NextResponse } from "next/server";
import { Prisma, prisma } from "@usejunction/db";
import { normalizeAgentVersion } from "@/lib/agent-updates";
import {
  DEVICE_AUTH_POLL_INTERVAL_SECONDS,
  DEVICE_AUTH_TTL_SECONDS,
  buildVerificationUrl,
  formatUserCode,
  generateDeviceCode,
  generateUserCode,
} from "@/lib/device-auth";
import { logServerError } from "@/lib/errors/public";
import { getPublicAppUrl } from "@/lib/public-url";
import { hashOpaqueToken } from "@/lib/security";
import { limitedJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * The agent asks to be connected. It keeps `deviceCode` to itself and shows
 * the person `verificationUrl`; nothing is tied to an account until someone
 * signed in approves the user code.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, { key: "device-auth-start", limit: 10, windowSeconds: 60 });
    if (limited !== true) return limited;
    const parsedBody = await limitedJson(req, 4 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;

    const deviceCode = generateDeviceCode();
    const expiresAt = new Date(Date.now() + DEVICE_AUTH_TTL_SECONDS * 1000);
    const data = {
      deviceCodeHash: hashOpaqueToken(deviceCode),
      hostname: String(body.hostname || "unknown").slice(0, 255),
      os: String(body.os || "unknown").slice(0, 64),
      architecture: String(body.architecture || "unknown").slice(0, 64),
      agentVersion: normalizeAgentVersion(body.agentVersion, "0.1.0"),
      expiresAt,
    };

    // A user code is short, so two live requests can draw the same one. Draw again.
    let userCode = "";
    for (let attempt = 0; attempt < 5 && !userCode; attempt += 1) {
      const candidate = generateUserCode();
      try {
        await prisma.deviceAuthRequest.create({ data: { ...data, userCode: candidate } });
        userCode = candidate;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    if (!userCode) throw new Error("could not allocate a user code");

    return NextResponse.json(
      {
        deviceCode,
        userCode: formatUserCode(userCode),
        verificationUrl: buildVerificationUrl(userCode, getPublicAppUrl(req)),
        expiresIn: DEVICE_AUTH_TTL_SECONDS,
        interval: DEVICE_AUTH_POLL_INTERVAL_SECONDS,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    logServerError("device-auth/start", error);
    return NextResponse.json({ error: "could not start sign-in" }, { status: 500 });
  }
}
