import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { logServerError } from "@/lib/errors/public";
import { reconcileDeviceHealth } from "@/lib/sync/remote-sync";
import { reconcileDetectedSeatsForOrg } from "@/lib/tools/sync-detected";

export const maxDuration = 300;

function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (
    process.env.NODE_ENV === "production" &&
    secret === "development-cron" &&
    process.env.USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT !== "true"
  ) {
    return NextResponse.json({ error: "a non-default CRON_SECRET is required" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret || "development-cron"}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function handle(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const orgs = await prisma.organization.findMany({ select: { id: true }, take: 500 });
    const totals = {
      organizations: orgs.length,
      scanned: 0,
      stale: 0,
      autoRequestsCreated: 0,
      repairRequired: 0,
      noticesSent: 0,
      noticesFailed: 0,
      seatsAssigned: 0,
      seatsEnded: 0,
    };
    for (const org of orgs) {
      const result = await reconcileDeviceHealth({
        orgId: org.id,
        sendNotifications: true,
      });
      totals.scanned += result.scanned;
      totals.stale += result.stale;
      totals.autoRequestsCreated += result.autoRequestsCreated;
      totals.repairRequired += result.repairRequired;
      totals.noticesSent += result.noticesSent;
      totals.noticesFailed += result.noticesFailed;
      try {
        const seats = await reconcileDetectedSeatsForOrg(org.id);
        totals.seatsAssigned += seats.assigned;
        totals.seatsEnded += seats.ended;
      } catch (error) {
        logServerError("cron/device-health/detected-seats", error, { orgId: org.id });
      }
    }
    return NextResponse.json({ ok: true, ...totals });
  } catch (error) {
    logServerError("cron/device-health", error);
    return NextResponse.json({ error: "device health reconciliation failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
