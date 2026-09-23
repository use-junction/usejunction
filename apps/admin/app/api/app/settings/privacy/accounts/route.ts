import { NextRequest, NextResponse } from "next/server";
import { requireOrgRole, rolesFor } from "@/lib/rbac";
import { browserMutationGuard } from "@/lib/security/http";
import {
  listCollectionEvents,
  listGatedAccounts,
  setAdminCollectionLock,
  type CollectionStream,
} from "@/lib/privacy/account-collection";

function isCollectionStream(value: unknown): value is CollectionStream {
  return value === "usage" || value === "logging";
}

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;
  const [accounts, events] = await Promise.all([
    listGatedAccounts({ orgId: auth.orgId }),
    listCollectionEvents({ orgId: auth.orgId, take: 80 }),
  ]);
  return NextResponse.json({ accounts, events });
}

export async function PATCH(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const deviceId = String(body.deviceId ?? "").trim();
  const toolName = String(body.toolName ?? "").trim();
  const accountKey = typeof body.accountKey === "string" ? body.accountKey.trim() : "";
  if (!deviceId || !toolName || typeof body.accountKey !== "string" || !isCollectionStream(body.stream) || typeof body.locked !== "boolean") {
    return NextResponse.json(
      { error: "deviceId, toolName, accountKey, stream, and locked are required" },
      { status: 400 },
    );
  }

  const result = await setAdminCollectionLock({
    orgId: auth.orgId,
    actorId: auth.userId,
    deviceId,
    toolName,
    accountKey,
    stream: body.stream,
    locked: body.locked,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ account: result });
}
