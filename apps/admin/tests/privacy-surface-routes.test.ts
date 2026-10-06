import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { COLLECTION_NOTICE_VERSION, LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from "@/lib/legal/versions";

const principal = { orgId: "org-1", userId: "user-1", role: "owner", email: "owner@example.com" };

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  requireOrgRole: vi.fn(),
  audit: vi.fn(),
  auth: vi.fn(),
  loadLegalAcceptance: vi.fn(),
  recordLegalAcceptance: vi.fn(),
  resolveLinkedDeveloperId: vi.fn(),
  exportDeveloperData: vi.fn(),
  eraseDeveloperData: vi.fn(),
  enforceAllRetention: vi.fn(),
  loadMyDataPage: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipUpdate: vi.fn(),
  membershipFindFirst: vi.fn(),
  orgFindUnique: vi.fn(),
  orgUpdate: vi.fn(),
  privacyCreate: vi.fn(),
  privacyFindMany: vi.fn(),
  developerFindFirst: vi.fn(),
}));

vi.mock("@/lib/api/app-auth", () => ({ requireAppPrincipal: mocks.requireAppPrincipal }));
vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  audit: mocks.audit,
  rolesFor: () => ["owner", "admin", "manager", "user"],
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/legal/acceptance", () => ({
  loadLegalAcceptance: mocks.loadLegalAcceptance,
  recordLegalAcceptance: mocks.recordLegalAcceptance,
}));
vi.mock("@/lib/queries/me/resolve-developer", () => ({ resolveLinkedDeveloperId: mocks.resolveLinkedDeveloperId }));
vi.mock("@/lib/privacy/export", () => ({ exportDeveloperData: mocks.exportDeveloperData }));
vi.mock("@/lib/privacy/erase", () => ({ eraseDeveloperData: mocks.eraseDeveloperData }));
vi.mock("@/lib/privacy/retention", () => ({ enforceAllRetention: mocks.enforceAllRetention }));
vi.mock("@/lib/app-pages/my-data", () => ({ loadMyDataPage: mocks.loadMyDataPage }));
vi.mock("@usejunction/db", () => ({
  prisma: {
    organizationMembership: {
      findUnique: mocks.membershipFindUnique,
      update: mocks.membershipUpdate,
      findFirst: mocks.membershipFindFirst,
    },
    organization: { findUnique: mocks.orgFindUnique, update: mocks.orgUpdate },
    privacyRequest: { create: mocks.privacyCreate, findMany: mocks.privacyFindMany },
    developer: { findFirst: mocks.developerFindFirst },
  },
}));

function json(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.NODE_ENV = "test";
  mocks.requireAppPrincipal.mockResolvedValue(principal);
  mocks.requireOrgRole.mockResolvedValue(principal);
  mocks.audit.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1" } });
  mocks.loadLegalAcceptance.mockResolvedValue({
    accepted: true,
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
    termsAcceptedAt: "2026-09-18T00:00:00.000Z",
  });
  mocks.recordLegalAcceptance.mockResolvedValue({
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
    termsAcceptedAt: new Date("2026-09-18T00:00:00.000Z"),
  });
  mocks.resolveLinkedDeveloperId.mockResolvedValue("dev-1");
  mocks.exportDeveloperData.mockResolvedValue({ developer: { id: "dev-1" } });
  mocks.eraseDeveloperData.mockResolvedValue({ ok: true });
  mocks.enforceAllRetention.mockResolvedValue({ purged: 0 });
  mocks.loadMyDataPage.mockResolvedValue({ summary: { devices: 1 } });
  mocks.membershipFindUnique.mockResolvedValue({ collectionNoticeAckAt: null, collectionNoticeVersion: null });
  mocks.membershipUpdate.mockResolvedValue({});
  mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });
  mocks.orgFindUnique.mockResolvedValue({ name: "Acme", usageRetentionDays: 365, dataRegion: "us" });
  mocks.orgUpdate.mockResolvedValue({ usageRetentionDays: 365, dataRegion: "us" });
  mocks.privacyCreate.mockResolvedValue({ id: "req-1" });
  mocks.privacyFindMany.mockResolvedValue([]);
  mocks.developerFindFirst.mockResolvedValue({ authUserId: "other-user" });
});

test("legal acceptance records the current terms and privacy versions", async () => {
  vi.resetModules();
  const { GET, POST } = await import("@/app/api/app/me/legal/route");
  assert.equal((await GET()).status, 200);
  mocks.auth.mockResolvedValue(null);
  assert.equal((await GET()).status, 401);
  mocks.auth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1" } });
  assert.equal((await POST(json("http://localhost/api/app/me/legal", "POST", {}))).status, 400);
  const accepted = await POST(json("http://localhost/api/app/me/legal", "POST", { accept: true }));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).accepted, true);
  assert.equal(mocks.audit.mock.calls[0][0].action, "legal.accepted");
});

test("collection notice stays unacknowledged until the current version is accepted", async () => {
  vi.resetModules();
  const { GET, POST } = await import("@/app/api/me/collection-notice/route");
  const pending = await GET(new NextRequest("http://localhost/api/me/collection-notice"));
  const pendingBody = await pending.json();
  assert.equal(pendingBody.acknowledged, false);
  assert.equal(pendingBody.version, COLLECTION_NOTICE_VERSION);
  assert.match(pendingBody.notice.summary, /Acme/);
  assert.equal((await POST(json("http://localhost/api/me/collection-notice", "POST", {}))).status, 400);
  mocks.membershipFindUnique.mockResolvedValue({
    collectionNoticeAckAt: new Date("2026-09-18T00:00:00.000Z"),
    collectionNoticeVersion: COLLECTION_NOTICE_VERSION,
  });
  const accepted = await POST(json("http://localhost/api/me/collection-notice", "POST", { accept: true }));
  assert.equal((await accepted.json()).acknowledged, true);
  assert.equal(mocks.audit.mock.calls[0][0].action, "collection_notice.acknowledged");
});

test("self-service erasure schedules a 30-day request and export downloads the bundle", async () => {
  vi.resetModules();
  const { POST } = await import("@/app/api/app/me/privacy/erasure-request/route");
  const { GET } = await import("@/app/api/app/me/privacy/export/route");
  const requested = await POST(json("http://localhost/api/app/me/privacy/erasure-request", "POST"));
  const body = await requested.json();
  assert.equal(requested.status, 200);
  assert.equal(body.id, "req-1");
  assert.ok(Date.parse(body.scheduledFor) > Date.now() + 29 * 24 * 60 * 60 * 1000);
  const exported = await GET(new NextRequest("http://localhost/api/app/me/privacy/export"));
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition") ?? "", /usejunction-export-dev-1.json/);
  mocks.resolveLinkedDeveloperId.mockResolvedValue(null);
  assert.equal((await GET(new NextRequest("http://localhost/api/app/me/privacy/export"))).status, 409);
});

test("analytics consent records grant and withdrawal", async () => {
  vi.resetModules();
  const { POST } = await import("@/app/api/app/me/privacy/analytics-consent/route");
  assert.equal((await POST(json("http://localhost/api/app/me/privacy/analytics-consent", "POST", {}))).status, 400);
  const granted = await POST(json("http://localhost/api/app/me/privacy/analytics-consent", "POST", { analytics: true }));
  assert.equal((await granted.json()).analytics, true);
  assert.equal(mocks.audit.mock.calls[0][0].action, "consent.analytics_granted");
  await POST(json("http://localhost/api/app/me/privacy/analytics-consent", "POST", { analytics: false }));
  assert.equal(mocks.audit.mock.calls[1][0].action, "consent.analytics_withdrawn");
});

test("privacy settings reject an unknown retention window and save a known one", async () => {
  vi.resetModules();
  const { GET, PATCH } = await import("@/app/api/app/settings/privacy/route");
  const current = await GET(new NextRequest("http://localhost/api/app/settings/privacy"));
  assert.equal((await current.json()).usageRetentionDays, 365);
  assert.equal((await PATCH(json("http://localhost/api/app/settings/privacy", "PATCH", { usageRetentionDays: 10 }))).status, 400);
  const saved = await PATCH(json("http://localhost/api/app/settings/privacy", "PATCH", { usageRetentionDays: 365 }));
  assert.equal((await saved.json()).usageRetentionDays, 365);
  assert.equal(mocks.audit.mock.calls[0][0].action, "privacy.retention_updated");
});

test("privacy request list and admin export or erase stay inside the workspace", async () => {
  const created = new Date("2026-09-01T00:00:00.000Z");
  mocks.privacyFindMany.mockResolvedValue([{
    id: "req-1",
    type: "erasure",
    status: "pending",
    subjectDeveloperId: "dev-1",
    developer: { name: "Ada", email: "ada@example.com" },
    scheduledFor: created,
    completedAt: null,
    createdAt: created,
  }]);
  vi.resetModules();
  const { GET: list } = await import("@/app/api/app/privacy/requests/route");
  const listed = await list(new NextRequest("http://localhost/api/app/privacy/requests"));
  assert.equal((await listed.json()).requests[0].subject.name, "Ada");

  const { GET: adminExport } = await import("@/app/api/app/developers/[id]/privacy/export/route");
  const exported = await adminExport(new NextRequest("http://localhost/api/app/developers/dev-1/privacy/export"), { params: Promise.resolve({ id: "dev-1" }) });
  assert.match(exported.headers.get("content-disposition") ?? "", /dev-1/);
  mocks.exportDeveloperData.mockResolvedValue(null);
  assert.equal((await adminExport(new NextRequest("http://localhost/api/app/developers/missing/privacy/export"), { params: Promise.resolve({ id: "missing" }) })).status, 404);

  const { POST: erase } = await import("@/app/api/app/developers/[id]/privacy/erase/route");
  mocks.developerFindFirst.mockResolvedValue({ authUserId: "user-1" });
  assert.equal((await erase(json("http://localhost/api/app/developers/dev-1/privacy/erase", "POST"), { params: Promise.resolve({ id: "dev-1" }) })).status, 403);
  mocks.developerFindFirst.mockResolvedValue({ authUserId: "other" });
  const erased = await erase(json("http://localhost/api/app/developers/dev-1/privacy/erase", "POST"), { params: Promise.resolve({ id: "dev-1" }) });
  assert.equal(erased.status, 200);
  assert.equal(mocks.audit.mock.calls.at(-1)?.[0].action, "privacy.erasure_completed");
  mocks.eraseDeveloperData.mockResolvedValue({ ok: false });
  assert.equal((await erase(json("http://localhost/api/app/developers/missing/privacy/erase", "POST"), { params: Promise.resolve({ id: "missing" }) })).status, 404);
});

test("my data route returns the page payload and forwards auth failures", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/app/me/data/route");
  const response = await GET(new NextRequest("http://localhost/api/app/me/data"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.summary.devices, 1);
  mocks.requireAppPrincipal.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  assert.equal((await GET(new NextRequest("http://localhost/api/app/me/data"))).status, 401);
});

test("retention cron requires the cron secret and reports the purge", async () => {
  vi.resetModules();
  const { POST } = await import("@/app/api/cron/retention-enforce/route");
  assert.equal((await POST(new NextRequest("http://localhost/api/cron/retention-enforce", { method: "POST" }))).status, 401);
  const response = await POST(new NextRequest("http://localhost/api/cron/retention-enforce", {
    method: "POST",
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).purged, 0);
  mocks.enforceAllRetention.mockRejectedValue(new Error("db down"));
  assert.equal((await POST(new NextRequest("http://localhost/api/cron/retention-enforce", {
    method: "POST",
    headers: { authorization: "Bearer test-cron-secret" },
  }))).status, 500);
});
