import { NextRequest, NextResponse } from "next/server";
import { findDeviceByBearerToken } from "@/lib/auth";
import { limitedJson } from "@/lib/security/http";
import { logServerError } from "@/lib/errors/public";
import {
  applyDeviceAccountInventory,
  accountsInventoryContentHash,
  type AccountInventoryItem,
} from "@/lib/sync/accounts-inventory";
import { repairDetectedPlanCycles } from "@/lib/tools/sync-detected";

/**
 * Compatibility endpoint for agents that still POST accounts here.
 * Canonical path is the sync-start accounts sidecar.
 */
export async function POST(req: NextRequest) {
  try {
    const device = await findDeviceByBearerToken(req, {
      select: {
        id: true,
        orgId: true,
        userId: true,
        accountsContentHash: true,
      },
    });
    if (!device) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const parsedBody = await limitedJson(req, 128 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;
    const accounts = body.accounts;
    if (!Array.isArray(accounts)) {
      return NextResponse.json({ error: "accounts array required" }, { status: 400 });
    }

    const items: AccountInventoryItem[] = accounts.map((acct) => {
      const row = acct as Record<string, unknown>;
      return {
        toolName: String(row.toolName ?? ""),
        accountKey: typeof row.accountKey === "string" ? row.accountKey : null,
        email: typeof row.email === "string" ? row.email : null,
        plan: typeof row.plan === "string" ? row.plan : null,
        orgKey: typeof row.orgKey === "string" ? row.orgKey : null,
        loginMethod: typeof row.loginMethod === "string" ? row.loginMethod : "unknown",
        authPresent: Boolean(row.authPresent),
      };
    });
    const contentHash = accountsInventoryContentHash(items);

    if (device.accountsContentHash && device.accountsContentHash === contentHash) {
      return NextResponse.json({ upserted: 0, unchanged: true });
    }

    const result = await applyDeviceAccountInventory({
      orgId: device.orgId,
      userId: device.userId,
      deviceId: device.id,
      items,
      contentHash,
      runPlanSync: true,
    });
    try {
      await repairDetectedPlanCycles(device.orgId);
    } catch (repairError) {
      logServerError("devices/accounts", repairError, { phase: "cycle repair" });
    }

    return NextResponse.json({ upserted: result.upserted });
  } catch (e) {
    logServerError("devices/accounts", e);
    return NextResponse.json({ error: "accounts upsert failed" }, { status: 500 });
  }
}
