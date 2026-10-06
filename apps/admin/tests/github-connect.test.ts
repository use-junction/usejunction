import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifyGitHubState } from "@/lib/integrations/github-app";

const mocks = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  rolesFor: () => ["owner", "admin"],
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "a".repeat(32);
  process.env.GITHUB_APP_SLUG = "usejunction-dinuda";
  mocks.requireOrgRole.mockResolvedValue({
    orgId: "org-1",
    userId: "owner-1",
    role: "owner",
    email: "owner@example.com",
  });
});

test("Connect GitHub sends the user to the App's account list", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/connect/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/connect?returnTo=/features"),
  );
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.href, "https://github.com/settings/apps/usejunction-dinuda/installations");
  assert.ok(response.cookies.get("uj_github_connect")?.value);
  const state = verifyGitHubState(response.cookies.get("uj_github_connect")?.value ?? "");
  assert.equal(state.returnTo, "/features");
  assert.equal(state.orgId, "org-1");
});
