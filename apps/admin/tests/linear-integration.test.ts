import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createLinearState,
  getLinearIssuePage,
  linearAuthorizationUrl,
  linearGraphQL,
  verifyLinearState,
} from "@/lib/integrations/linear";

beforeEach(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
  process.env.LINEAR_CLIENT_ID = "linear-client";
  process.env.LINEAR_CLIENT_SECRET = "linear-secret";
  vi.clearAllMocks();
});

test("Linear OAuth requests read scope and verifies signed, expiring state", () => {
  const state = createLinearState("org-1", "admin-1");
  assert.equal(verifyLinearState(state).orgId, "org-1");
  const url = linearAuthorizationUrl(state, "http://localhost:3001/api/integrations/linear/callback");
  assert.equal(url.origin, "https://linear.app");
  assert.equal(url.searchParams.get("scope"), "read");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.throws(() => verifyLinearState(`${state}x`));
});

test("Linear GraphQL rejects errors even when HTTP status is 200", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: { issues: {} }, errors: [{ message: "permission denied" }] }), { status: 200 }),
  ));
  await assert.rejects(linearGraphQL("token", "{ issues { nodes { id } } }"), /permission denied/);
});

test("Linear issue query sends a cursor and selects only safe issue metadata", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: {
      issues: {
        nodes: [{ id: "id-1", identifier: "ENG-12", title: "Fix login", url: "https://linear.app/team/issue/ENG-12", updatedAt: "2026-09-24T00:00:00Z", state: { name: "Done" } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const page = await getLinearIssuePage("token", "cursor-1");
  assert.equal(page.nodes[0]?.identifier, "ENG-12");
  const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
  assert.equal(request.variables.after, "cursor-1");
  assert.match(request.query, /includeArchived: true/);
  assert.doesNotMatch(request.query, /description/);
});

const routeMocks = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  exchangeLinearCode: vi.fn(),
  saveLinearConnection: vi.fn(),
  syncLinearConnection: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireOrgRole: routeMocks.requireOrgRole,
  rolesFor: () => ["owner", "admin"],
  audit: routeMocks.audit,
}));
vi.mock("@/lib/integrations/linear-sync", () => ({
  saveLinearConnection: routeMocks.saveLinearConnection,
  syncLinearConnection: routeMocks.syncLinearConnection,
}));

test("Linear callback rejects a mismatched CSRF cookie before token exchange", async () => {
  routeMocks.requireOrgRole.mockResolvedValue({ orgId: "org-1", userId: "admin-1", role: "owner", email: "a@example.com" });
  const state = createLinearState("org-1", "admin-1");
  const { GET } = await import("@/app/api/integrations/linear/callback/route");
  const response = await GET(new NextRequest(
    `http://localhost:3001/api/integrations/linear/callback?state=${encodeURIComponent(state)}&code=code-1`,
    { headers: { cookie: "uj_linear_connect=other" } },
  ));
  assert.equal(response.status, 400);
  assert.equal(routeMocks.saveLinearConnection.mock.calls.length, 0);
});

test("Linear callback clears the state cookie on its original path", async () => {
  routeMocks.requireOrgRole.mockResolvedValue({ orgId: "org-1", userId: "admin-1", role: "owner", email: "a@example.com" });
  const state = createLinearState("org-1", "admin-1");
  const { GET } = await import("@/app/api/integrations/linear/callback/route");
  const response = await GET(new NextRequest(
    `http://localhost:3001/api/integrations/linear/callback?state=${encodeURIComponent(state)}&error=access_denied`,
    { headers: { cookie: `uj_linear_connect=${state}` } },
  ));
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/work-spend\?linear=denied/);
  assert.match(response.headers.get("set-cookie") ?? "", /Path=\/api\/integrations\/linear/);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
