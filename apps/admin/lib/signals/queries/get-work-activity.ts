import {
  assertInsightRoles,
  makeInsightEnvelope,
  type InsightContext,
  type InsightEnvelope,
} from "@/lib/insights/contracts/envelope";
import type { SignalsActivityInput } from "@/lib/signals/contracts/activity.v1";
import { resolveSignalsWindows } from "@/lib/signals/queries/windows";
import { readLocalWorkSessions } from "@/lib/signals/readers/work-sessions";
import { getOrgSignalsPolicy } from "@/lib/signals/service";
import { sanitizeWorkTraceForViewer } from "@/lib/privacy/sanitize-work-trace";
import { rolesFor } from "@/lib/rbac/permissions";
import type { WorkTrace } from "@/lib/signals/work-trace";

export type WorkActivitySession = {
  id: string;
  person: string;
  email: string;
  toolName: string;
  model: string | null;
  mode: string | null;
  title: string | null;
  tldr: string | null;
  overview: string | null;
  observedAt: string;
  source: string;
  toolCallCounts: Record<string, number> | null;
  trace: WorkTrace | null;
};

export type WorkActivityV1 = {
  enabled: boolean;
  sessions: WorkActivitySession[];
};

function asCounts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      out[key] = count;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function asWorkToolCallCounts(value: unknown): Record<string, number> | null {
  return asCounts(value);
}

export async function getWorkActivity(
  context: InsightContext,
  input: SignalsActivityInput = {},
): Promise<InsightEnvelope<WorkActivityV1>> {
  assertInsightRoles(context, rolesFor("org_overview"));
  const policy = await getOrgSignalsPolicy(context.orgId);
  const windows = resolveSignalsWindows(input, context.now);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  if (!policy.workExtractionEnabled) {
    return makeInsightEnvelope({
      context,
      kind: "work-activity",
      window: windows.current,
      dataThrough: null,
      data: { enabled: false, sessions: [] },
    });
  }

  const sessions = await readLocalWorkSessions(context.orgId, {
    from: windows.current.from,
    to: windows.current.to,
    ...windows.filters,
    take: limit,
  });

  return makeInsightEnvelope({
    context,
    kind: "work-activity",
    window: windows.current,
    dataThrough: sessions[0]?.observedAt ?? null,
    data: {
      enabled: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        person: session.developer.name,
        email: session.developer.email,
        toolName: session.toolName,
        model: session.model,
        mode: session.mode,
        title: session.title,
        tldr: session.tldr,
        overview: session.overview,
        observedAt: session.observedAt.toISOString(),
        source: session.source,
        toolCallCounts: asCounts(session.toolCallCounts),
        trace: sanitizeWorkTraceForViewer(session.trace, false),
      })),
    },
  });
}
