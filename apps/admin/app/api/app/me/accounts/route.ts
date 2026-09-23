import { NextRequest, NextResponse } from "next/server";
import { requireAppPrincipal } from "@/lib/api/app-auth";
import { rolesFor } from "@/lib/rbac";
import { browserMutationGuard } from "@/lib/security/http";
import { resolveLinkedDeveloperId } from "@/lib/queries/me/resolve-developer";
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
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;
  const developerId = await resolveLinkedDeveloperId(principal.orgId, principal.userId);
  if (!developerId) return NextResponse.json({ accounts: [], events: [] });
  const [accounts, events] = await Promise.all([
    listGatedAccounts({ orgId: principal.orgId, userId: developerId }),
    listCollectionEvents({ orgId: principal.orgId, userId: developerId }),
  ]);
  return NextResponse.json({ accounts, events });
}

export async function PATCH(req: NextRequest) {
  const rejected = browserMutationGuard(req);
  if (rejected) return rejected;
  const principal = await requireAppPrincipal(req, rolesFor("self_view"));
  if (principal instanceof NextResponse) return principal;
  const developerId = await resolveLinkedDeveloperId(principal.orgId, principal.userId);
  if (!developerId) return NextResponse.json({ error: "developer profile required" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const deviceId = String(body.deviceId ?? "").trim();
  const toolName = String(body.toolName ?? "").trim();
  const accountKey = typeof body.accountKey === "string" ? body.accountKey.trim() : "";
  if (body.scope === "provider") {
    if (!toolName || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "toolName and enabled are required" }, { status: 400 });
    }
    const result = await setDeveloperProviderCollection({
      orgId: principal.orgId,
      userId: developerId,
      actorId: principal.userId,
      toolName,
      enabled: body.enabled,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  }
  if (body.scope === "account") {
    if (!deviceId || !toolName || typeof body.accountKey !== "string" || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "deviceId, toolName, accountKey, and enabled are required" },
        { status: 400 },
      );
    }
    const result = await setDeveloperAccountOptIn({
      orgId: principal.orgId,
      userId: developerId,
      actorId: principal.userId,
      deviceId,
      toolName,
      accountKey,
      enabled: body.enabled,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ account: result });
  }
  if (!deviceId || !toolName || typeof body.accountKey !== "string" || !isCollectionStream(body.stream) || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "deviceId, toolName, accountKey, stream, and enabled are required" },
      { status: 400 },
    );
  }

  const result = await setDeveloperCollectionSwitch({
    orgId: principal.orgId,
    userId: developerId,
    actorId: principal.userId,
    deviceId,
    toolName,
    accountKey,
    stream: body.stream,
    enabled: body.enabled,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ account: result });
}
