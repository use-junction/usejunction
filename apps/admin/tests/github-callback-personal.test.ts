import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  verifyGitHubState: vi.fn(),
  getGitHubInstallation: vi.fn(),
  findByAccount: vi.fn(),
  findClaimed: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  audit: mocks.audit,
  rolesFor: () => ["owner", "admin"],
}));

vi.mock("@/lib/integrations/github-app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/github-app")>("@/lib/integrations/github-app");
  return {
    ...actual,
    verifyGitHubState: mocks.verifyGitHubState,
    getGitHubInstallation: mocks.getGitHubInstallation,
  };
});

vi.mock("@/lib/integrations/github-connections", () => ({
  findGitHubConnectionByAccount: mocks.findByAccount,
  findClaimedGitHubInstallation: mocks.findClaimed,
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    providerConnection: { create: mocks.create, update: mocks.update },
  },
}));

vi.mock("@/lib/errors/public", () => ({
  logServerError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgRole.mockResolvedValue({
    orgId: "org-1",
    userId: "owner-1",
    role: "owner",
    email: "owner@example.com",
  });
  mocks.verifyGitHubState.mockReturnValue({
    orgId: "org-1",
    userId: "owner-1",
    returnTo: "/features",
    expiresAt: Date.now() + 60_000,
  });
  mocks.findByAccount.mockResolvedValue(null);
  mocks.findClaimed.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "conn-1" });
  mocks.update.mockResolvedValue({ id: "conn-1" });
  mocks.audit.mockResolvedValue(undefined);
});

test("GitHub callback accepts a personal User installation", async () => {
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "dinuda", type: "User" },
    permissions: { pull_requests: "read", contents: "read", metadata: "read" },
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=99&state=abc"),
  );
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/features\?connected=github/);
  const createData = mocks.create.mock.calls[0][0].data;
  assert.equal(createData.externalOrgId, "dinuda");
  assert.equal(createData.config.org, "dinuda");
  assert.equal(createData.config.accountType, "User");
  assert.equal(createData.config.installationId, "99");
});

test("GitHub callback accepts installation_id without state for a signed-in admin", async () => {
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "dinuda", type: "User" },
    permissions: { pull_requests: "read", contents: "read", metadata: "read" },
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=163021676"),
  );
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/work-spend\?connected=github/);
  assert.equal(mocks.verifyGitHubState.mock.calls.length, 0);
  assert.equal(mocks.create.mock.calls[0][0].data.config.installationId, "163021676");
});

test("GitHub callback accepts an Organization installation", async () => {
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "acme", type: "Organization" },
    permissions: { pull_requests: "read", contents: "read" },
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=42&state=abc"),
  );
  assert.equal(response.status, 307);
  const createData = mocks.create.mock.calls[0][0].data;
  assert.equal(createData.config.accountType, "Organization");
  assert.equal(createData.externalOrgId, "acme");
});

test("GitHub callback rejects unknown account types", async () => {
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "bot", type: "Bot" },
    permissions: {},
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=1&state=abc"),
  );
  assert.equal(response.status, 422);
  assert.equal(mocks.create.mock.calls.length, 0);
});

test("GitHub callback requires installation_id", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(new NextRequest("http://localhost/api/integrations/github/callback"));
  assert.equal(response.status, 400);
});

test("GitHub callback sends unsigned-in admins to login with installation_id preserved", async () => {
  mocks.requireOrgRole.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=163034624&state=abc"),
  );
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("from"), "/api/integrations/github/callback?installation_id=163034624&state=abc");
  assert.equal(mocks.create.mock.calls.length, 0);
});

test("GitHub callback creates a second connection for a different account", async () => {
  mocks.findByAccount.mockResolvedValue(null);
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "acme-labs", type: "Organization" },
    permissions: { pull_requests: "read", contents: "read" },
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=77&state=abc"),
  );
  assert.equal(response.status, 307);
  assert.equal(mocks.create.mock.calls.length, 1);
  assert.equal(mocks.update.mock.calls.length, 0);
  assert.equal(mocks.create.mock.calls[0][0].data.externalOrgId, "acme-labs");
});

test("GitHub callback refreshes the existing row for the same account", async () => {
  mocks.findByAccount.mockResolvedValue({ id: "conn-existing" });
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "dinuda", type: "User" },
    permissions: { pull_requests: "read", contents: "read" },
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=101&state=abc"),
  );
  assert.equal(response.status, 307);
  assert.equal(mocks.create.mock.calls.length, 0);
  assert.equal(mocks.update.mock.calls[0][0].where.id, "conn-existing");
  assert.equal(mocks.update.mock.calls[0][0].data.config.installationId, "101");
});

test("GitHub callback rejects an installation claimed by another workspace", async () => {
  mocks.findClaimed.mockResolvedValue({ id: "other-conn", orgId: "org-2" });
  mocks.getGitHubInstallation.mockResolvedValue({
    account: { login: "dinuda", type: "User" },
    permissions: { pull_requests: "read", contents: "read" },
  });
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/callback/route");
  const response = await GET(
    new NextRequest("http://localhost/api/integrations/github/callback?installation_id=99&state=abc"),
  );
  assert.equal(response.status, 409);
  assert.equal(mocks.create.mock.calls.length, 0);
  assert.equal(mocks.update.mock.calls.length, 0);
});
