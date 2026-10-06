/** Canonical React Query keys shared by destination screens and navigation prefetch. */

export const workspaceContextKey = ["app", "workspace-context"] as const;

export function dashboardKey(queryString = "") {
  return ["app", "dashboard", queryString] as const;
}

export const dashboardShellKey = ["app", "dashboard", "shell"] as const;

export function dashboardMetricsKey(queryString = "") {
  return ["app", "dashboard", "metrics", queryString] as const;
}

export function teamKey(queryString = "") {
  return ["app", "team", queryString] as const;
}

export function teamUsageKey(queryString = "") {
  return ["app", "team", "usage", queryString] as const;
}

export const teamInvitesKey = ["app", "team", "invites"] as const;
export const teamSyncsKey = ["app", "team", "syncs"] as const;

export function teamMemberHubKey(developerId: string, periodQuery = "") {
  return ["app", "team", developerId, "hub", periodQuery] as const;
}

export function teamMemberWorkKey(developerId: string, periodQuery = "", limit = 4) {
  return ["app", "team", developerId, "work", periodQuery, limit] as const;
}

/** @deprecated Use teamMemberHubKey — section is no longer part of the cache key. */
export function teamMemberKey(developerId: string, section: string, periodQuery = "") {
  return ["app", "team", developerId, section, periodQuery] as const;
}

export function toolsKey(queryString = "") {
  return ["app", "tools", queryString] as const;
}

export function toolDetailKey(toolKey: string, queryString = "") {
  return ["app", "tools", toolKey, queryString] as const;
}

export function toolDetailShellKey(toolKey: string) {
  return ["app", "tools", toolKey, "shell"] as const;
}

export function toolDetailMetricsKey(toolKey: string, queryString = "") {
  return ["app", "tools", toolKey, "metrics", queryString] as const;
}

export function activityKey(queryString = "") {
  return ["app", "activity", queryString] as const;
}

export function activityReportsInlineKey(audience: "you" | "team") {
  return ["app", "activity", "reports", audience, "inline"] as const;
}

export function signalsOverviewKey(queryString = "") {
  return ["app", "signals", "overview", queryString] as const;
}

export function signalsActivityKey(queryString = "") {
  return ["app", "signals", "activity", queryString] as const;
}

export const signalsSettingsKey = ["app", "signals", "settings"] as const;

export function signalsWorkKey(sessionId: string) {
  return ["app", "signals", "work", sessionId] as const;
}

export const notificationPreferencesKey = ["app", "notification-preferences"] as const;

export const meDevicesKey = ["app", "me", "devices"] as const;

export const myDataKey = ["app", "me", "data"] as const;

export const settingsKey = ["app", "settings"] as const;

export function featuresKey(queryString = "") {
  return ["app", "features", queryString] as const;
}

export function workSpendKey(queryString = "") {
  return ["app", "work-spend", queryString] as const;
}

export function workSpendProjectKey(projectId: string, days: number) {
  return ["app", "work-spend-project", projectId, days] as const;
}
