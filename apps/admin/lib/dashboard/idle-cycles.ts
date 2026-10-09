type CycleUsage = {
  cycleSpend: number;
  modelCalls: number;
  verifiedUsageCost: number;
  estimatedApiCost: number;
  utilizationPercent: number | null;
};

/**
 * A paid plan with no recorded use in the window. Allowance verdicts ("within allowance",
 * "on track") answer whether a seat will run out; a buyer reads an idle paid plan as waste.
 */
export function isIdlePaidCycle(row: CycleUsage) {
  return (
    row.cycleSpend > 0 &&
    row.modelCalls <= 0 &&
    row.verifiedUsageCost <= 0 &&
    row.estimatedApiCost <= 0 &&
    (row.utilizationPercent ?? 0) <= 0
  );
}

export const IDLE_CYCLE_LABEL = "No use this period";
