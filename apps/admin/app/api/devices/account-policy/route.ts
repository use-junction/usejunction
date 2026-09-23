import { NextRequest, NextResponse } from "next/server";
import { findDeviceByBearerToken } from "@/lib/auth";
import { limitedJson } from "@/lib/security/http";
import { logServerError } from "@/lib/errors/public";
import {
  listCollectionEvents,
  listGatedAccounts,
  setDeveloperAccountOptIn,
  setDeveloperCollectionSwitch,
  setDeveloperProviderCollection,
  type CollectionStream,
} from "@/lib/privacy/account-collection";

function isCollectionStream(value: unknown): value is CollectionStream {
  return value === "usage" || value === "logging";
}

export async function GET(req: NextRequest) {
  try {
    const device = await findDeviceByBearerToken(req, {
      select: { id: true, orgId: true, userId: true },
    });
    if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const [accounts, events] = await Promise.all([
      listGatedAccounts({ orgId: device.orgId, deviceId: device.id }),
      listCollectionEvents({ orgId: device.orgId, deviceId: device.id, take: 20 }),
    ]);
    return NextResponse.json({ accounts, events });
  } catch (e) {
    logServerError("devices/account-policy", e);
    return NextResponse.json({ error: "account policy failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const device = await findDeviceByBearerToken(req, {
      select: { id: true, orgId: true, userId: true },
    });
    if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const parsedBody = await limitedJson(req, 8 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;
    const toolName = String(body.toolName ?? "").trim();
    const accountKey = typeof body.accountKey === "string" ? body.accountKey.trim() : "";
    if (body.scope === "provider") {
      if (!toolName || typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "toolName and enabled are required" }, { status: 400 });
      }
      const result = await setDeveloperProviderCollection({
        orgId: device.orgId,
        userId: device.userId,
        actorId: device.userId,
        toolName,
        enabled: body.enabled,
      });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result);
    }
    if (body.scope === "account") {
      if (!toolName || typeof body.accountKey !== "string" || typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "toolName, accountKey, and enabled are required" }, { status: 400 });
      }
      const result = await setDeveloperAccountOptIn({
        orgId: device.orgId,
        userId: device.userId,
        actorId: device.userId,
        deviceId: device.id,
        toolName,
        accountKey,
        enabled: body.enabled,
      });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ account: result });
    }
    if (!toolName || typeof body.accountKey !== "string" || !isCollectionStream(body.stream) || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "toolName, accountKey, stream, and enabled are required" },
        { status: 400 },
      );
    }

    const result = await setDeveloperCollectionSwitch({
      orgId: device.orgId,
      userId: device.userId,
      actorId: device.userId,
      deviceId: device.id,
      toolName,
      accountKey,
      stream: body.stream,
      enabled: body.enabled,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ account: result });
  } catch (e) {
    logServerError("devices/account-policy", e);
    return NextResponse.json({ error: "account policy update failed" }, { status: 500 });
  }
}
