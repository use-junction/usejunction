import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  loadFeaturesPage: vi.fn(),
  requireOrgRole: vi.fn(),
  identityFindFirst: vi.fn(),
  developerFindFirst: vi.fn(),
  identityUpdate: vi.fn(),
  restampGitAuthor: vi.fn(),
  runFeatureCostAllocation: vi.fn(),
  runCommitUsageMapping: vi.fn(),
  wakeGitHubAuthorDaemons: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/api/app-auth", () => ({
  requireAppPrincipal: mocks.requireAppPrincipal,
}));

vi.mock("@/lib/app-pages/features", () => ({
  loadFeaturesPage: mocks.loadFeaturesPage,
}));

vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  audit: mocks.audit,
  rolesFor: (capability: string) => (capability === "settings_billing" ? ["owner", "admin"] : ["owner", "admin", "manager"]),
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    externalIdentity: { findFirst: mocks.identityFindFirst, update: mocks.identityUpdate },
    developer: { findFirst: mocks.developerFindFirst },
  },
}));

vi.mock("@/lib/features/pipeline", () => ({
  runCommitUsageMapping: mocks.runCommitUsageMapping,
}));

vi.mock("@/lib/features/autosync", () => ({
  wakeGitHubAuthorDaemons: mocks.wakeGitHubAuthorDaemons,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAppPrincipal.mockResolvedValue({
    orgId: "org-1",
    userId: "owner-1",
    role: "owner",
    email: "owner@example.com",
  });
  mocks.loadFeaturesPage.mockResolvedValue({
    connection: { state: "ready" },
    kpis: { mappedPct: 80 },
  });
  mocks.requireOrgRole.mockResolvedValue({
    orgId: "org-1",
    userId: "owner-1",
    role: "owner",
    email: "owner@example.com",
  });
  mocks.identityFindFirst.mockResolvedValue({
    id: "ident-1",
    orgId: "org-1",
    provider: "github",
    externalUserId: "ada",
    developerId: null,
  });
  mocks.developerFindFirst.mockResolvedValue({ id: "dev-1" });
  mocks.identityUpdate.mockResolvedValue({ id: "ident-1", developerId: "dev-1", matchedBy: "manual" });
  mocks.runCommitUsageMapping.mockResolvedValue({ rows: 1 });
  mocks.wakeGitHubAuthorDaemons.mockResolvedValue({ skipped: false, requestsCreated: 1 });
  mocks.audit.mockResolvedValue(undefined);
});

test("GET /api/app/features returns the features page payload", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/app/features/route");
  const response = await GET(new NextRequest("http://localhost/api/app/features?days=30"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.connection.state, "ready");
  assert.equal(mocks.loadFeaturesPage.mock.calls[0][1].days, "30");
});

test("GET /api/app/features forwards auth failures", async () => {
  mocks.requireAppPrincipal.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  vi.resetModules();
  const { GET } = await import("@/app/api/app/features/route");
  const response = await GET(new NextRequest("http://localhost/api/app/features"));
  assert.equal(response.status, 401);
  assert.equal(mocks.loadFeaturesPage.mock.calls.length, 0);
});

test("PATCH github identity maps a developer and restamps commits", async () => {
  vi.resetModules();
  const { PATCH } = await import("@/app/api/app/integrations/github/identities/[id]/route");
  const response = await PATCH(
    new NextRequest("http://localhost/api/app/integrations/github/identities/ident-1", {
      method: "PATCH",
      body: JSON.stringify({ developerId: "dev-1" }),
    }),
    { params: Promise.resolve({ id: "ident-1" }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.identity.matchedBy, "manual");
  assert.equal(mocks.runCommitUsageMapping.mock.calls.length, 1);
  assert.equal(mocks.wakeGitHubAuthorDaemons.mock.calls.length, 1);
  assert.equal(mocks.wakeGitHubAuthorDaemons.mock.calls[0][0], "org-1");
  assert.deepEqual(mocks.wakeGitHubAuthorDaemons.mock.calls[0][1], {
    developerIds: ["dev-1"],
    force: true,
  });
});
