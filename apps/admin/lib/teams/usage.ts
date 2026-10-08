import { prisma } from "@usejunction/db";
import { ORG_DAY_SNAPSHOT_VERSION, snapshotUtcDay } from "@/lib/analytics/snapshots";

/*
 * Team rollups read the same sealed day snapshots as every other page (developer and
 * developer×tool grains), so team numbers add up to the workspace numbers and page loads
 * never run live usage SQL. Amounts stay in micros to avoid float drift.
 */

export type ToolUsageMicros = { toolName: string; verifiedMicros: bigint; estimatedMicros: bigint; actualMicros: bigint };

type Window = { from: Date; to: Date };

function range(window: Window) {
  return { gte: snapshotUtcDay(window.from), lte: snapshotUtcDay(window.to) };
}

/** Usage cost per tool for a set of people. An empty list means nobody, never "everyone". */
export async function usageByToolForPeople(orgId: string, developerIds: string[], window: Window): Promise<ToolUsageMicros[]> {
  if (!developerIds.length) return [];
  const rows = await prisma.orgUsageDaySnapshot.groupBy({
    by: ["toolName"],
    where: {
      orgId,
      metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      date: range(window),
      developerId: { in: developerIds },
      toolName: { not: "" },
      modelName: "",
    },
    _sum: { verifiedUsageCostMicros: true, estimatedApiCostMicros: true, actualSpendCostMicros: true },
  });
  return rows.map((row) => ({
    toolName: row.toolName,
    verifiedMicros: row._sum.verifiedUsageCostMicros ?? 0n,
    estimatedMicros: row._sum.estimatedApiCostMicros ?? 0n,
    actualMicros: row._sum.actualSpendCostMicros ?? 0n,
  }));
}

/** Usage cost and requests per person for a window (whole workspace). */
export async function usageByDeveloper(orgId: string, window: Window): Promise<Map<string, { costMicros: bigint; requests: number }>> {
  const rows = await prisma.orgUsageDaySnapshot.groupBy({
    by: ["developerId"],
    where: {
      orgId,
      metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      date: range(window),
      developerId: { not: "" },
      toolName: "",
      modelName: "",
    },
    _sum: { requests: true, verifiedUsageCostMicros: true, estimatedApiCostMicros: true, actualSpendCostMicros: true },
  });
  return new Map(
    rows.map((row) => [
      row.developerId,
      {
        costMicros: (row._sum.verifiedUsageCostMicros ?? 0n) + (row._sum.estimatedApiCostMicros ?? 0n) + (row._sum.actualSpendCostMicros ?? 0n),
        requests: row._sum.requests ?? 0,
      },
    ]),
  );
}

/** Usage cost per UTC day for the workspace, or for a set of people when given. */
export async function usageByDay(orgId: string, window: Window, developerIds: string[] | null): Promise<Map<string, bigint>> {
  if (developerIds && !developerIds.length) return new Map();
  const rows = await prisma.orgUsageDaySnapshot.groupBy({
    by: ["date"],
    where: {
      orgId,
      metricVersion: ORG_DAY_SNAPSHOT_VERSION,
      date: range(window),
      developerId: developerIds ? { in: developerIds } : "",
      toolName: "",
      modelName: "",
    },
    _sum: { verifiedUsageCostMicros: true, estimatedApiCostMicros: true, actualSpendCostMicros: true },
  });
  return new Map(
    rows.map((row) => [
      row.date.toISOString().slice(0, 10),
      (row._sum.verifiedUsageCostMicros ?? 0n) + (row._sum.estimatedApiCostMicros ?? 0n) + (row._sum.actualSpendCostMicros ?? 0n),
    ]),
  );
}
