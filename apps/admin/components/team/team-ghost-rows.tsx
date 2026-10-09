import { BarChart3 } from "lucide-react";
import { Ghost } from "@/components/empty-states/ghost";
import { roleDisplayLabel } from "@/components/developers/member-role-select";
import { RosterPlanUsage, type RosterPlanUsagePlan } from "@/components/developers/roster-plan-usage";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { PlanVerdictCode } from "@/lib/billing/plan-utilization-policy";
import { cn } from "@/lib/utils";

function plan(toolKey: string, planName: string, primaryRatio: number, code: PlanVerdictCode): RosterPlanUsagePlan {
  return {
    toolKey,
    toolName: toolKey,
    planName,
    primaryRatio,
    verdict: { code, severity: code === "NEAR_LIMIT" ? "warning" : "info", reasons: [], policyVersion: "plan-utilization-v1" },
  };
}

const SAMPLE = [
  { name: "Maya Chen", email: "maya@acme.dev", role: "admin", meta: "1 machine · 4.8K requests · 30d", plans: [plan("claude", "Team Premium", 0.82, "NEAR_LIMIT"), plan("cursor", "Pro+", 0.46, "HEALTHY")] },
  { name: "Jonas Weber", email: "jonas@acme.dev", role: "user", meta: "2 machines · 3.2K requests · 30d", plans: [plan("cursor", "Pro+", 0.64, "HEALTHY")] },
  { name: "Asha Kumar", email: "asha@acme.dev", role: "user", meta: "1 machine · 2.7K requests · 30d", plans: [plan("claude", "Team Premium", 0.58, "HEALTHY")] },
  { name: "Tom Lindqvist", email: "tom@acme.dev", role: "user", meta: "1 machine · 640 requests · 30d", plans: [plan("github-copilot", "Business", 0.07, "LIGHT_USE")] },
];

/** Sample teammates drawn under the real roster, matching its row layout, until a machine reports. */
export function TeamGhostRows() {
  return (
    <Ghost fade>
      <ul className="divide-y border-t">
        {SAMPLE.map((person) => (
          <li key={person.email} className="flex flex-wrap items-start gap-3 px-5 py-5">
            <div className="grid min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-start">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium tracking-tight">{person.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{person.email}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">{person.meta}</p>
                <RosterPlanUsage plans={person.plans} />
              </div>
              <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 self-start rounded-none")}>
                <BarChart3 />
                See Usage
              </span>
            </div>
            <Badge variant="outline" className="shrink-0 self-start font-normal">{roleDisplayLabel(person.role)}</Badge>
          </li>
        ))}
      </ul>
    </Ghost>
  );
}
