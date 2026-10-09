import type { CostOverview } from "@/lib/queries/tools/cost-overview";

/* Pure helpers shared by the Cost page (client) and server loaders; no database imports. */

/** Money on idle seats per tool: assigned with no use, and bought but assigned to no one. */
export function idleMicrosByTool(data: Pick<CostOverview, "changes">) {
  const unused = new Map<string, bigint>();
  const unassigned = new Map<string, bigint>();
  for (const change of data.changes) {
    if (!change.toolKey || !change.monthlyMicros) continue;
    const target = change.kind === "unused_seats" ? unused : change.kind === "unassigned_seats" ? unassigned : null;
    target?.set(change.toolKey, (target.get(change.toolKey) ?? 0n) + BigInt(change.monthlyMicros));
  }
  return { unused, unassigned };
}

/** Total monthly money on idle seats; the same figure Adoption shows as "Paid seats not used". */
export function idleSeatMicros(data: Pick<CostOverview, "changes" | "tools">) {
  const { unused, unassigned } = idleMicrosByTool(data);
  let total = 0n;
  for (const tool of data.tools) {
    const seats = BigInt(tool.seatsMonthlyMicros);
    const idle = (unused.get(tool.toolKey) ?? 0n) + (unassigned.get(tool.toolKey) ?? 0n);
    total += idle > seats ? seats : idle;
  }
  return total;
}
