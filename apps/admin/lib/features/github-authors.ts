import { normalizeEmail } from "@/lib/developer-identity";

export type GitHubAuthorScope =
  | { kind: "organization"; memberLogins: Set<string> }
  | { kind: "organization"; memberLogins: null }
  | { kind: "user"; developerLogins: Set<string> };

export function emailLocalPart(email: string): string | null {
  const local = email.split("@")[0]?.toLowerCase().trim();
  return local || null;
}

export function uniqueDeveloperLoginMap(developers: Array<{ id: string; email: string }>): Map<string, string> {
  const buckets = new Map<string, string[]>();
  for (const developer of developers) {
    const local = emailLocalPart(developer.email);
    if (!local) continue;
    const ids = buckets.get(local) ?? [];
    ids.push(developer.id);
    buckets.set(local, ids);
  }
  const unique = new Map<string, string>();
  for (const [local, ids] of buckets) {
    if (ids.length === 1 && ids[0]) unique.set(local, ids[0]);
  }
  return unique;
}

export function reposOwnedByInstallation<T extends { owner?: { login?: string | null } | null }>(
  repos: T[],
  accountLogin: string,
  accountType: "User" | "Organization",
): T[] {
  if (accountType === "User") return repos;
  const owner = accountLogin.trim().toLowerCase();
  if (!owner) return [];
  return repos.filter((repo) => repo.owner?.login?.toLowerCase() === owner);
}

export function isInScopeGitHubLogin(login: string, scope: GitHubAuthorScope): boolean {
  const normalized = login.toLowerCase();
  if (scope.kind === "organization") {
    if (!scope.memberLogins) return false;
    return scope.memberLogins.has(normalized);
  }
  return scope.developerLogins.has(normalized);
}

export function isInAnyGitHubAuthorScope(login: string, scopes: GitHubAuthorScope[]): boolean {
  return scopes.some((scope) => isInScopeGitHubLogin(login, scope));
}

export function soleDeveloperMatch(
  developers: Array<{ id: string }>,
  scope: GitHubAuthorScope,
  login: string,
): { developerId: string | null; matchedBy: "auth" | "email" | "login" | null } {
  if (developers.length !== 1 || !developers[0]) {
    return { developerId: null, matchedBy: null };
  }
  if (scope.kind !== "organization" || !scope.memberLogins || scope.memberLogins.size !== 1) {
    return { developerId: null, matchedBy: null };
  }
  if (!isInScopeGitHubLogin(login, scope)) return { developerId: null, matchedBy: null };
  return { developerId: developers[0].id, matchedBy: "login" };
}

export function matchDeveloperForGitHubAuthor(input: {
  login: string;
  email: string | null;
  githubUserId?: string | number | null;
  byGithubUserId?: Map<string, string>;
  byEmail: Map<string, string>;
  byUniqueLogin: Map<string, string>;
}): { developerId: string | null; matchedBy: "auth" | "email" | "login" | null } {
  const githubUserId = input.githubUserId == null || input.githubUserId === "" ? null : String(input.githubUserId);
  if (githubUserId) {
    const developerId = input.byGithubUserId?.get(githubUserId);
    if (developerId) return { developerId, matchedBy: "auth" };
  }
  const corporateEmail = input.email && !input.email.endsWith("@users.noreply.github.com")
    ? normalizeEmail(input.email)
    : null;
  if (corporateEmail) {
    const developerId = input.byEmail.get(corporateEmail);
    if (developerId) return { developerId, matchedBy: "email" };
  }
  const loginMatch = input.byUniqueLogin.get(input.login.toLowerCase());
  if (loginMatch) return { developerId: loginMatch, matchedBy: "login" };
  return { developerId: null, matchedBy: null };
}

export function nextGitHubAuthorResolution(input: {
  existingMatchedBy?: string | null;
  existingDeveloperId?: string | null;
  inScope: boolean;
  matched: { developerId: string | null; matchedBy: "auth" | "email" | "login" | null };
}): { developerId: string | null; matchedBy: string | null; persist: boolean } {
  if (input.existingMatchedBy === "manual") {
    return { developerId: input.existingDeveloperId ?? null, matchedBy: "manual", persist: false };
  }
  if (!input.inScope) {
    return { developerId: null, matchedBy: null, persist: false };
  }
  return {
    developerId: input.matched.developerId ?? input.existingDeveloperId ?? null,
    matchedBy: input.matched.matchedBy ?? input.existingMatchedBy ?? null,
    persist: true,
  };
}

export function githubUserIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).githubUserId;
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

export function mergeGithubIdentityMetadata(existing: unknown, githubUserId: string | number | null): Record<string, unknown> {
  const current = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {};
  if (githubUserId == null || githubUserId === "") return current;
  current.githubUserId = Number(githubUserId);
  return current;
}

export function githubMemberLoginsFromConfig(config: unknown): string[] | null {
  if (!config || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>).githubMemberLogins;
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") {
    if (value.trim() === "") return [];
    return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return null;
}

export function githubAuthorScopeFromConnection(input: {
  accountType: "User" | "Organization";
  memberLogins: string[] | null;
  developers: Array<{ email: string }>;
}): GitHubAuthorScope {
  if (input.accountType === "User") {
    return {
      kind: "user",
      developerLogins: new Set(
        input.developers.flatMap((developer) => {
          const local = emailLocalPart(developer.email);
          return local ? [local] : [];
        }),
      ),
    };
  }
  return {
    kind: "organization",
    memberLogins: input.memberLogins ? new Set(input.memberLogins) : null,
  };
}
