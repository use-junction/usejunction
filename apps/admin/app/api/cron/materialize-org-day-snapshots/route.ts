import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { logServerError } from "@/lib/errors/public";
import {
  ORG_DAY_SNAPSHOT_VERSION,
  materializeDirtyOrgUsageDays,
  rematerializeOrgSnapshots,
} from "@/lib/analytics/snapshots";

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

/**
 * Catch up org-day snapshots: dirty days from ingest, plus today/yesterday for
 * orgs that already have dirty work or recent activity.
 */
async function handle(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const dirtyOrgs = await prisma.analyticsDirtyDay.findMany({
      where: { metricVersion: ORG_DAY_SNAPSHOT_VERSION },
      distinct: ["orgId"],
      select: { orgId: true },
      take: 100,
    });

    // Also refresh today for orgs with usage in the last 7 days even if not dirty yet.
    const since = new Date(Date.now() - 7 * 86_400_000);
    const activeOrgs = await prisma.usageDaily.findMany({
      where: { date: { gte: since } },
      distinct: ["orgId"],
      select: { orgId: true },
      take: 100,
    });

    // Orgs sealed only under an earlier snapshot version (a calculation or pricing
    // bump since their last activity) would otherwise read as empty until they sync.
    const staleVersionOrgs = await prisma.$queryRaw<Array<{ org_id: string }>>`
      SELECT DISTINCT s.org_id
      FROM org_usage_day_snapshots s
      WHERE s.metric_version <> ${ORG_DAY_SNAPSHOT_VERSION}
        AND NOT EXISTS (
          SELECT 1 FROM org_usage_day_snapshots c
          WHERE c.org_id = s.org_id AND c.metric_version = ${ORG_DAY_SNAPSHOT_VERSION}
        )
      LIMIT 100
    `;

    const orgIds = [...new Set([
      ...dirtyOrgs.map((row) => row.orgId),
      ...activeOrgs.map((row) => row.orgId),
      ...staleVersionOrgs.map((row) => row.org_id),
    ])];

    let orgs = 0;
    let days = 0;
    for (const orgId of orgIds) {
      const result = await rematerializeOrgSnapshots(orgId, {
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
        includeToday: true,
      });
      orgs += 1;
      days += result.dirtyDays;
    }

    // Safety net: any remaining dirty rows (e.g. marked during the loop).
    const leftover = await prisma.analyticsDirtyDay.findMany({
      where: { metricVersion: ORG_DAY_SNAPSHOT_VERSION },
      distinct: ["orgId"],
      select: { orgId: true },
      take: 50,
    });
    for (const row of leftover) {
      const result = await materializeDirtyOrgUsageDays(row.orgId, {
        metricVersion: ORG_DAY_SNAPSHOT_VERSION,
        limit: 90,
      });
      days += result.days;
    }

    return NextResponse.json({ ok: true, orgs, days });
  } catch (error) {
    logServerError("cron/materialize-org-day-snapshots", error);
    return NextResponse.json({ error: "materialize failed" }, { status: 500 });
  }
}

/** Vercel Cron invokes GET. */
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
