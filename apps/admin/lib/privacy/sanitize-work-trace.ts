import type { WorkTrace } from "@/lib/signals/work-trace";

export function sanitizeWorkTraceForViewer(
  trace: WorkTrace | null | undefined,
  canSeeUserTurns: boolean,
): WorkTrace | null {
  if (!trace) return null;
  if (canSeeUserTurns) return trace;
  if (!trace.userTurns?.length) return trace;
  const { userTurns: _userTurns, ...rest } = trace;
  return rest;
}
