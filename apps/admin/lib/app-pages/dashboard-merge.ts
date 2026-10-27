import type { OrgOverviewMetricsData, OrgOverviewShellData, OrgOverviewV1 } from "@/lib/insights";
import { buildAttentionItems } from "@/lib/insights/policies/attention";

/** Merge cached shell + filter metrics into a full org overview for rendering. */
export function mergeOrgOverviewShellMetrics(
  shell: OrgOverviewShellData,
  metrics: OrgOverviewMetricsData,
): OrgOverviewV1 {
  const tools = [...metrics.tools];
  for (const installation of shell.detectedInstallations) {
    if (!tools.some((tool) => tool.name === installation.toolName)) {
      tools.push({ name: installation.toolName, requests: 0, cost: 0, activeDevelopers: 0 });
    }
  }

  const healthAttention = buildAttentionItems({
    healthIssues: shell.health.issues,
    planVerdicts: [],
  });
  const planAttention = metrics.attention.filter((item) => item.id.startsWith("plan-"));
  const attention = [...healthAttention, ...planAttention].slice(0, 5);

  return {
    ...metrics,
    hasActivity:
      metrics.hasUsageActivity ||
      tools.some((tool) => tool.requests > 0) ||
      shell.detectedInstallations.length > 0,
    attention,
    tools,
    coverage: {
      ...shell.coverage,
      // Usage history can include people since removed; never report more active than on the roster.
      activeDevelopers: Math.min(metrics.coverage.activeDevelopers, shell.coverage.developers),
    },
  };
}
