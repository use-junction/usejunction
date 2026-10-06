import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";
import { NextRequest } from "next/server";

const principal = { orgId: "org-1", userId: "user-1", role: "owner", email: "owner@example.com" };

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  requireOrgRole: vi.fn(),
  audit: vi.fn(),
  githubProjectsPicker: vi.fn(),
  saveGitHubProjectSelection: vi.fn(),
  syncGitHubProjects: vi.fn(),
  disconnectGitHubProjects: vi.fn(),
  linearConnectionSummary: vi.fn(),
  linearConfigured: vi.fn(),
  createLinearState: vi.fn(),
  linearAuthorizationUrl: vi.fn(),
  syncLinearConnection: vi.fn(),
  disconnectLinearConnection: vi.fn(),
  syncConnection: vi.fn(),
  connections: vi.fn(),
  listGitHubAppInstallations: vi.fn(),
  listLinkedGitHubInstallationIds: vi.fn(),
  loadWorkSpendPage: vi.fn(),
}));

class GitHubProjectsUnavailable extends Error {}

vi.mock("@/lib/api/app-auth", () => ({ requireAppPrincipal: mocks.requireAppPrincipal }));
vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  audit: mocks.audit,
  rolesFor: (capability: string) => (capability === "settings_billing" ? ["owner", "admin"] : ["owner", "admin", "manager"]),
}));
vi.mock("@/lib/integrations/github-projects", () => ({
  GitHubProjectsUnavailable,
  githubProjectsPicker: mocks.githubProjectsPicker,
  saveGitHubProjectSelection: mocks.saveGitHubProjectSelection,
  syncGitHubProjects: mocks.syncGitHubProjects,
  disconnectGitHubProjects: mocks.disconnectGitHubProjects,
}));
vi.mock("@/lib/integrations/linear-sync", () => ({
  linearConnectionSummary: mocks.linearConnectionSummary,
  syncLinearConnection: mocks.syncLinearConnection,
  disconnectLinearConnection: mocks.disconnectLinearConnection,
}));
vi.mock("@/lib/integrations/linear", () => ({
  linearConfigured: mocks.linearConfigured,
  createLinearState: mocks.createLinearState,
  linearAuthorizationUrl: mocks.linearAuthorizationUrl,
  LINEAR_CONNECT_COOKIE: "uj_linear_connect",
}));
vi.mock("@/lib/integrations/sync", () => ({ syncConnection: mocks.syncConnection }));
vi.mock("@/lib/integrations/github-app", () => ({
  listGitHubAppInstallations: mocks.listGitHubAppInstallations,
  githubAppOwnerInstallationsUrl: (slug: string) => `https://github.com/apps/${slug}/installations/new`,
}));
vi.mock("@/lib/integrations/github-connections", () => ({
  listLinkedGitHubInstallationIds: mocks.listLinkedGitHubInstallationIds,
}));
vi.mock("@/lib/public-url", () => ({ getPublicAppUrl: () => "http://localhost:3001" }));
vi.mock("@/lib/app-pages/work-spend", () => ({ loadWorkSpendPage: mocks.loadWorkSpendPage }));
vi.mock("@usejunction/db", () => ({
  prisma: { providerConnection: { findMany: mocks.connections } },
}));

function json(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAppPrincipal.mockResolvedValue(principal);
  mocks.requireOrgRole.mockResolvedValue(principal);
  mocks.audit.mockResolvedValue(undefined);
  mocks.githubProjectsPicker.mockResolvedValue({ projects: [{ id: "PVT_1", title: "Roadmap" }], selectedIds: [] });
  mocks.saveGitHubProjectSelection.mockResolvedValue({ selected: 1 });
  mocks.syncGitHubProjects.mockResolvedValue({ items: 4 });
  mocks.disconnectGitHubProjects.mockResolvedValue({ removedProjects: 1 });
  mocks.linearConnectionSummary.mockResolvedValue({ connected: false, status: "disconnected" });
  mocks.linearConfigured.mockReturnValue(true);
  mocks.createLinearState.mockReturnValue("state-1");
  mocks.linearAuthorizationUrl.mockReturnValue("https://linear.app/oauth/authorize?state=state-1");
  mocks.syncLinearConnection.mockResolvedValue({ issues: 2 });
  mocks.disconnectLinearConnection.mockResolvedValue({ disconnected: true, revoked: true, removedIssues: 2 });
  mocks.syncConnection.mockResolvedValue({ commits: 1 });
  mocks.connections.mockResolvedValue([{ id: "conn-1" }, { id: "conn-2" }]);
  mocks.listGitHubAppInstallations.mockResolvedValue([
    { id: "1", login: "acme", accountType: "Organization" },
    { id: "2", login: "other", accountType: "Organization" },
  ]);
  mocks.listLinkedGitHubInstallationIds.mockResolvedValue({
    thisWorkspace: new Set(["1"]),
    otherWorkspaces: new Set(["2"]),
  });
  mocks.loadWorkSpendPage.mockResolvedValue({ selectedRepositoryId: "repo-1", connection: { state: "ready" } });
});

test("GitHub Projects picker saves a selection and refuses an empty disconnect", async () => {
  vi.resetModules();
  const { GET, PUT } = await import("@/app/api/app/project-tools/github-projects/route");
  const { POST: sync } = await import("@/app/api/app/project-tools/github-projects/sync/route");
  const { POST: disconnect } = await import("@/app/api/app/project-tools/github-projects/disconnect/route");
  const listed = await GET(new NextRequest("http://localhost/api/app/project-tools/github-projects"));
  assert.equal((await listed.json()).data.canManage, true);
  assert.equal((await PUT(json("http://localhost/api/app/project-tools/github-projects", "PUT", { projectIds: [1] }))).status, 400);
  const saved = await PUT(json("http://localhost/api/app/project-tools/github-projects", "PUT", { projectIds: ["PVT_1"] }));
  assert.equal((await saved.json()).data.sync.items, 4);
  mocks.githubProjectsPicker.mockRejectedValue(new GitHubProjectsUnavailable("not_connected"));
  assert.equal((await GET(new NextRequest("http://localhost/api/app/project-tools/github-projects"))).status, 502);
  assert.equal((await sync(json("http://localhost/api/app/project-tools/github-projects/sync", "POST"))).status, 200);
  mocks.disconnectGitHubProjects.mockResolvedValue({ removedProjects: 0 });
  assert.equal((await disconnect(json("http://localhost/api/app/project-tools/github-projects/disconnect", "POST"))).status, 404);
});

test("Linear connect, sync, and disconnect follow the workspace connection", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/app/project-tools/linear/route");
  const { POST: sync } = await import("@/app/api/app/project-tools/linear/sync/route");
  const { POST: disconnect } = await import("@/app/api/app/project-tools/linear/disconnect/route");
  const { GET: connect } = await import("@/app/api/integrations/linear/connect/route");
  const summary = await (await GET(new NextRequest("http://localhost/api/app/project-tools/linear"))).json();
  assert.equal(summary.data.available, true);
  assert.equal(summary.data.canManage, true);
  const started = await connect(new NextRequest("http://localhost/api/integrations/linear/connect"));
  assert.equal(started.status, 307);
  assert.match(started.headers.get("location") ?? "", /linear\.app/);
  mocks.linearConfigured.mockReturnValue(false);
  assert.equal((await connect(new NextRequest("http://localhost/api/integrations/linear/connect"))).status, 503);
  const synced = await sync(json("http://localhost/api/app/project-tools/linear/sync", "POST"));
  assert.equal((await synced.json()).data.issues, 2);
  mocks.disconnectLinearConnection.mockResolvedValue({ disconnected: false, revoked: false, removedIssues: 0 });
  assert.equal((await disconnect(json("http://localhost/api/app/project-tools/linear/disconnect", "POST"))).status, 404);
  mocks.syncLinearConnection.mockRejectedValue(new Error("linear down"));
  assert.equal((await sync(json("http://localhost/api/app/project-tools/linear/sync", "POST"))).status, 502);
});

test("feature sync merges every connected GitHub installation", async () => {
  vi.resetModules();
  const { POST } = await import("@/app/api/app/features/sync/route");
  mocks.connections.mockResolvedValue([]);
  assert.equal((await POST(json("http://localhost/api/app/features/sync", "POST"))).status, 404);
  mocks.connections.mockResolvedValue([{ id: "conn-1" }, { id: "conn-2" }]);
  mocks.syncConnection
    .mockResolvedValueOnce({ commits: 2, nested: { issues: 1 } })
    .mockResolvedValueOnce({ commits: 3, nested: { issues: 4 } });
  const response = await POST(json("http://localhost/api/app/features/sync", "POST"));
  assert.deepEqual((await response.json()).data.counts, { commits: 5, nested: { issues: 5 } });
  assert.equal(mocks.audit.mock.calls.length, 2);
  mocks.syncConnection.mockRejectedValue(new Error("github down"));
  assert.equal((await POST(json("http://localhost/api/app/features/sync", "POST"))).status, 502);
});

test("GitHub installation list hides installs already linked to another workspace", async () => {
  process.env.GITHUB_APP_SLUG = "usejunction";
  vi.resetModules();
  const { GET } = await import("@/app/api/integrations/github/installations/route");
  const response = await GET(new NextRequest("http://localhost/api/integrations/github/installations"));
  const body = await response.json();
  assert.deepEqual(body.installations, [{ id: "1", login: "acme", accountType: "Organization", linked: true }]);
  assert.match(body.installAppUrl, /usejunction/);
  mocks.listGitHubAppInstallations.mockRejectedValue(new Error("github down"));
  assert.equal((await GET(new NextRequest("http://localhost/api/integrations/github/installations"))).status, 502);
  mocks.requireOrgRole.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  assert.equal((await GET(new NextRequest("http://localhost/api/integrations/github/installations"))).status, 403);
});

test("work-spend page route 404s a repository outside the GitHub grant", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/app/work-spend/route");
  const ok = await GET(new NextRequest("http://localhost/api/app/work-spend?days=30&repositoryId=repo-1"));
  assert.equal((await ok.json()).data.connection.state, "ready");
  assert.equal(mocks.loadWorkSpendPage.mock.calls[0][1].days, "30");
  const missing = await GET(new NextRequest("http://localhost/api/app/work-spend?repositoryId=other"));
  assert.equal(missing.status, 404);
  mocks.requireAppPrincipal.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  assert.equal((await GET(new NextRequest("http://localhost/api/app/work-spend"))).status, 401);
});
