import { NextRequest, NextResponse } from "next/server";
import { claimDueConnections, releaseConnectionLease, syncConnection } from "@/lib/integrations/sync";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 300;

/** Leave headroom under maxDuration so the last sync can still write its result. */
const REQUEST_BUDGET_MS = 270_000;
/** Don't start a connection that cannot do useful work before the request ends. */
const MIN_CONNECTION_BUDGET_MS = 30_000;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (process.env.NODE_ENV === "production" && secret === "development-cron" && process.env.USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT !== "true") return NextResponse.json({ error: "a non-default CRON_SECRET is required" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret || "development-cron"}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const deadline = new Date(Date.now() + REQUEST_BUDGET_MS);
  const connectionIds = await claimDueConnections(5);
  const results = [];
  for (const id of connectionIds) {
    if (deadline.getTime() - Date.now() < MIN_CONNECTION_BUDGET_MS) {
      await releaseConnectionLease(id).catch((error) => logServerError("cron/provider-sync", error, { id }));
      results.push({ id, ok: false, error: "deferred: request time budget exhausted" });
      continue;
    }
    try {
      results.push({ id, ok: true, counts: await syncConnection(id, { deadline }) });
    } catch (error) {
      logServerError("cron/provider-sync", error, { id });
      results.push({ id, ok: false, error: "sync failed" });
    }
  }
  return NextResponse.json({ claimed: connectionIds.length, results });
}
