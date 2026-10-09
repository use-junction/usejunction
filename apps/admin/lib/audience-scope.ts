/**
 * Audience scope for owner/admin Team | You switchers on Dashboard, Activity, and Signals.
 * Default is team (org-wide). Role `user` ignores this and stays personal-only.
 */
export type AudienceScope = "team" | "you";

export function parseAudienceScope(value: string | null | undefined): AudienceScope {
  return value === "you" ? "you" : "team";
}

/** Copy `scope` from an existing query into `params` when set. */
export function copyAudienceScope(params: URLSearchParams, from: URLSearchParams | string): void {
  const source = typeof from === "string" ? new URLSearchParams(from.startsWith("?") ? from.slice(1) : from) : from;
  const scope = source.get("scope");
  if (scope === "you" || scope === "team") params.set("scope", scope);
  // A team filter survives period changes, like the audience does.
  const team = source.get("team");
  if (team) params.set("team", team);
}

/** Build a path that sets audience scope while preserving other search params. */
export function audienceScopeHref(
  pathname: string,
  scope: AudienceScope,
  currentSearch: string | URLSearchParams = "",
): string {
  const params =
    typeof currentSearch === "string"
      ? new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch)
      : new URLSearchParams(currentSearch);
  if (scope === "team") {
    params.delete("scope");
  } else {
    params.set("scope", "you");
  }
  // You mode is self-scoped — drop teammate person filters that would conflict.
  if (scope === "you") {
    params.delete("developerId");
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
