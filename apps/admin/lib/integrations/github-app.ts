import { createHmac, createSign, timingSafeEqual } from "crypto";
import { fetchJson, providerFetch } from "@/lib/integrations/http";

export const GITHUB_RETURN_PATHS = ["/onboarding", "/team", "/features", "/work-spend"] as const;
export type GitHubReturnTo = (typeof GITHUB_RETURN_PATHS)[number];

type GitHubState = {
  orgId: string;
  userId: string;
  returnTo?: GitHubReturnTo;
  expiresAt: number;
};

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function stateSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for GitHub App connections");
  return secret;
}

export function createGitHubState(state: GitHubState) {
  const payload = base64url(JSON.stringify(state));
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGitHubState(value: string): GitHubState {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw new Error("invalid GitHub connection state");
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid GitHub connection state");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GitHubState;
  if (!state.orgId || !state.userId || state.expiresAt < Date.now()) throw new Error("expired GitHub connection state");
  if (state.returnTo && !GITHUB_RETURN_PATHS.includes(state.returnTo)) throw new Error("invalid GitHub return path");
  return state;
}

/** PEM may be stored with literal `\\n` or as one line with spaces between the header and body. */
export function normalizeGitHubPrivateKey(raw: string) {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  const begin = trimmed.match(/^-----BEGIN [^-]+-----/);
  const end = trimmed.match(/-----END [^-]+-----$/);
  if (!begin || !end) return trimmed;
  if (trimmed.includes("\n")) return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  const body = trimmed.slice(begin[0].length, trimmed.length - end[0].length).replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `${begin[0]}\n${wrapped}\n${end[0]}\n`;
}

export function githubAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY ? normalizeGitHubPrivateKey(process.env.GITHUB_APP_PRIVATE_KEY) : undefined;
  if (!appId || !privateKey) throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

function appHeaders() {
  return { Authorization: `Bearer ${githubAppJwt()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
}

export function githubInstallationHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
}

export async function getGitHubInstallation(installationId: string) {
  return fetchJson<Record<string, any>>(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}`, { headers: appHeaders() });
}

export type GitHubInstallationSummary = {
  id: string;
  login: string;
  accountType: GitHubAccountType;
  htmlUrl: string;
};

function githubNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

function mapGitHubInstallations(payload: unknown): GitHubInstallationSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    const installation = row as Record<string, any>;
    const login = String(installation.account?.login ?? "");
    const accountType = normalizeGitHubAccountType(installation.account?.type ?? installation.target_type);
    if (!login || !accountType || installation.id == null) return [];
    return [{
      id: String(installation.id),
      login,
      accountType,
      htmlUrl: String(installation.html_url ?? ""),
    }];
  });
}

export async function listGitHubAppInstallations(): Promise<GitHubInstallationSummary[]> {
  const installations: GitHubInstallationSummary[] = [];
  let url: string | null = "https://api.github.com/app/installations?per_page=100";
  for (let page = 0; page < 20 && url; page += 1) {
    const response = await providerFetch(url, { headers: appHeaders() });
    const text = await response.text();
    if (!response.ok) throw new Error(`provider request failed (${response.status}): ${text.slice(0, 500)}`);
    installations.push(...mapGitHubInstallations(text ? JSON.parse(text) : []));
    url = githubNextLink(response.headers.get("link"));
  }
  return installations;
}

export async function githubInstallationToken(installationId: string) {
  const response = await fetchJson<{ token: string }>(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    headers: appHeaders(),
  });
  if (!response.token) throw new Error("GitHub App did not return an installation token");
  return response.token;
}

export function githubInstallationPermissions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function githubCodePermissionsGranted(value: unknown): boolean {
  const permissions = githubInstallationPermissions(value);
  return permissions.pull_requests === "read" && permissions.contents === "read";
}

/** Organization Members: read. Not required for personal (User) installs. */
export function githubMembersReadGranted(value: unknown): boolean {
  return githubInstallationPermissions(value).members === "read";
}

/** Organization Projects (v2): read. Personal projects need user authorization. */
export function githubProjectsReadGranted(value: unknown): boolean {
  return ["read", "write", "admin"].includes(githubInstallationPermissions(value).organization_projects ?? "");
}

export class GitHubHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubHttpError";
  }
}

export function isGitHubPermissionDenied(error: unknown): boolean {
  return error instanceof GitHubHttpError && (error.status === 403 || error.status === 404);
}

/** Paginated org members. Requires Organization permission Members: read. */
export async function listGitHubOrgMembers(token: string, orgLogin: string): Promise<string[]> {
  const logins: string[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await providerFetch(
      `https://api.github.com/orgs/${encodeURIComponent(orgLogin)}/members?per_page=100&page=${page}`,
      { headers: githubInstallationHeaders(token) },
    );
    if (!response.ok) {
      throw new GitHubHttpError(`GitHub org members failed (${response.status})`, response.status);
    }
    const payload = (await response.json().catch(() => null)) as Array<{ login?: string }> | null;
    const rows = Array.isArray(payload) ? payload : [];
    for (const row of rows) {
      const login = String(row.login ?? "").trim().toLowerCase();
      if (login) logins.push(login);
    }
    if (rows.length < 100) break;
  }
  return logins;
}

export type GitHubAccountType = "User" | "Organization";

export function normalizeGitHubAccountType(value: unknown): GitHubAccountType | null {
  const type = String(value ?? "").toLowerCase();
  if (type === "user") return "User";
  if (type === "organization") return "Organization";
  return null;
}

/** App registration page where the owner adds permissions such as Organization Members: read. */
export function githubAppPermissionsUrl(slug: string) {
  return `https://github.com/settings/apps/${encodeURIComponent(slug)}/permissions`;
}

/** Settings URL where an admin approves newly requested App permissions. */
export function githubPermissionUpdateUrl(
  accountLogin: string,
  installationId: string,
  accountType: GitHubAccountType | string = "Organization",
) {
  if (normalizeGitHubAccountType(accountType) === "User") {
    return `https://github.com/settings/installations/${encodeURIComponent(installationId)}/permissions/update`;
  }
  return `https://github.com/organizations/${encodeURIComponent(accountLogin)}/settings/installations/${encodeURIComponent(installationId)}/permissions/update`;
}

export const GITHUB_CONNECT_COOKIE = "uj_github_connect";

/**
 * GitHub skips /installations/new and /select_target when a personal install
 * already exists. The App's Install App page lists every account (user + orgs)
 * with Install/Configure.
 */
export function githubAppInstallUrl(slug: string, _state?: string) {
  return githubAppOwnerInstallationsUrl(slug);
}

/** App-owner page that lists every account GitHub will allow this App to install on. */
export function githubAppOwnerInstallationsUrl(slug: string) {
  return `https://github.com/settings/apps/${encodeURIComponent(slug)}/installations`;
}

export function githubAppOrgInstallUrl(slug: string, orgLogin: string, state?: string) {
  const url = new URL(`https://github.com/organizations/${encodeURIComponent(orgLogin)}/settings/apps/${encodeURIComponent(slug)}/install`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export function normalizeGitHubLogin(value: string) {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const login = trimmed.split("/")[0] ?? "";
  return GITHUB_LOGIN.test(login) ? login : null;
}

/** Resolve a public GitHub organization to its numeric id for the install `target_id` query. */
export async function lookupGitHubOrganization(login: string): Promise<{ id: number; login: string } | null> {
  const normalized = normalizeGitHubLogin(login);
  if (!normalized) return null;
  const response = await providerFetch(`https://api.github.com/orgs/${encodeURIComponent(normalized)}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { id?: number; login?: string; type?: string } | null;
  if (!payload?.id || !payload.login) return null;
  if (payload.type && String(payload.type).toLowerCase() !== "organization") return null;
  return { id: payload.id, login: payload.login };
}

export class GitHubGraphqlError extends Error {
  constructor(
    message: string,
    readonly type?: string,
  ) {
    super(message);
    this.name = "GitHubGraphqlError";
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function githubGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}, options: { rejectPartial?: boolean } = {}): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await providerFetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (response.status === 403 || response.status === 429) {
      if (attempt === 3) throw new Error(`GitHub GraphQL rate limited (${response.status})`);
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Number.isFinite(reset)
          ? Math.max(1_000, reset * 1000 - Date.now())
          : 250 * 2 ** attempt;
      await sleep(Math.min(waitMs, 60_000));
      continue;
    }
    const payload = (await response.json().catch(() => null)) as
      | { data?: T; errors?: Array<{ type?: string; message: string }> }
      | null;
    if (!response.ok || !payload) {
      throw new Error(`GitHub GraphQL failed (${response.status})`);
    }
    const rateLimited = payload.errors?.some((error) => error.type === "RATE_LIMITED");
    if (rateLimited) {
      if (attempt === 3) throw new GitHubGraphqlError(payload.errors?.[0]?.message ?? "RATE_LIMITED", "RATE_LIMITED");
      const waitMs = Number.isFinite(reset) ? Math.max(1_000, reset * 1000 - Date.now()) : 5_000 * 2 ** attempt;
      await sleep(Math.min(waitMs, 60_000));
      continue;
    }
    if (payload.errors?.length && (payload.data == null || options.rejectPartial)) {
      throw new GitHubGraphqlError(payload.errors.map((error) => error.message).join("; "), payload.errors[0]?.type);
    }
    if (Number.isFinite(remaining) && remaining < 200 && Number.isFinite(reset)) {
      const waitMs = reset * 1000 - Date.now();
      if (waitMs > 0 && waitMs < 60_000) await sleep(waitMs);
    }
    return payload.data as T;
  }
  throw new Error("GitHub GraphQL failed after retries");
}
