import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/security";

export const LINEAR_CONNECT_COOKIE = "uj_linear_connect";
export const LINEAR_RETURN_PATH = "/work-spend";
const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const REVOKE_URL = "https://api.linear.app/oauth/revoke";
const GRAPHQL_URL = "https://api.linear.app/graphql";

export type LinearConnectState = {
  orgId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
};

function oauthConfig() {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Linear OAuth is not configured");
  return { clientId, clientSecret };
}

export function linearConfigured() {
  return Boolean(process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET && process.env.AUTH_SECRET);
}

function stateSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for Linear OAuth");
  return secret;
}

export function createLinearState(orgId: string, userId: string): string {
  const state: LinearConnectState = {
    orgId,
    userId,
    nonce: randomBytes(24).toString("base64url"),
    expiresAt: Date.now() + 10 * 60_000,
  };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyLinearState(value: string): LinearConnectState {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) throw new Error("invalid Linear OAuth state");
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid Linear OAuth state");
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LinearConnectState;
  if (!state.orgId || !state.userId || !state.nonce || !Number.isFinite(state.expiresAt) || state.expiresAt < Date.now()) {
    throw new Error("expired Linear OAuth state");
  }
  return state;
}

export function linearAuthorizationUrl(state: string, redirectUri: string): URL {
  const { clientId } = oauthConfig();
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read",
    state,
  }).toString();
  return url;
}

export type LinearTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

async function tokenRequest(values: Record<string, string>): Promise<LinearTokens> {
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...values, client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Linear token request failed (${response.status})`);
  const data = await response.json() as Record<string, unknown>;
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" ||
      typeof data.expires_in !== "number" || data.expires_in <= 0) {
    throw new Error("Linear returned an incomplete OAuth token response");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export function exchangeLinearCode(code: string, redirectUri: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshLinearToken(encryptedRefreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(encryptedRefreshToken) });
}

export function encryptLinearTokens(tokens: LinearTokens) {
  return {
    accessTokenCiphertext: encryptSecret(tokens.accessToken),
    refreshTokenCiphertext: encryptSecret(tokens.refreshToken),
    accessTokenExpiresAt: tokens.expiresAt,
  };
}

export async function revokeLinearToken(encryptedToken: string, type: "refresh_token" | "access_token") {
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: decryptSecret(encryptedToken),
      token_type_hint: type,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  // A token may already have been revoked outside UseJunction. Only report
  // revocation as confirmed when Linear accepts the request.
  return response.ok;
}

type GraphQLError = { message?: string };

export async function linearGraphQL<T>(accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(25_000),
    });
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000, 5000)));
      continue;
    }
    if (!response.ok) throw new Error(`Linear API request failed (${response.status})`);
    const result = await response.json() as { data?: T; errors?: GraphQLError[] };
    if (result.errors?.length) throw new Error(`Linear API error: ${result.errors[0]?.message ?? "unknown"}`);
    if (!result.data) throw new Error("Linear API response has no data");
    return result.data;
  }
  throw new Error("Linear API rate limit exceeded");
}

export async function getLinearWorkspace(accessToken: string) {
  const result = await linearGraphQL<{ organization: { id: string; name: string } }>(
    accessToken,
    "query LinearWorkspace { organization { id name } }",
  );
  if (!result.organization?.id || !result.organization?.name) throw new Error("Linear workspace is unavailable");
  return result.organization;
}

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  updatedAt: string;
  state: { name: string } | null;
};

export async function getLinearIssuePage(accessToken: string, after: string | null) {
  const result = await linearGraphQL<{
    issues: { nodes: LinearIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  }>(
    accessToken,
    `query LinearIssues($after: String) {
      issues(first: 100, after: $after, orderBy: updatedAt, includeArchived: true) {
        nodes { id identifier title url updatedAt state { name } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { after },
  );
  if (!result.issues || !Array.isArray(result.issues.nodes) || !result.issues.pageInfo) {
    throw new Error("Linear issues response is incomplete");
  }
  return result.issues;
}
