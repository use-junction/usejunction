import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  developerFind: vi.fn(),
  membershipFind: vi.fn(),
  issue: vi.fn(),
  audit: vi.fn(),
  enrollGate: vi.fn(),
}));

vi.mock("@/lib/api/app-auth", () => ({
  requireAppPrincipal: mocks.requireAppPrincipal,
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    developer: { findFirst: mocks.developerFind },
    organizationMembership: { findUnique: mocks.membershipFind },
  },
}));

vi.mock("@/lib/enrollment-token", () => ({
  issueEnrollmentToken: mocks.issue,
}));

vi.mock("@/lib/rbac", () => ({
  audit: mocks.audit,
  rolesFor: () => ["owner", "admin", "manager", "user"],
}));

vi.mock("@/lib/saas-billing/status", () => ({
  assertCanEnrollDevice: mocks.enrollGate,
}));

vi.mock("@/lib/public-url", () => ({
  getPublicAppUrl: () => "https://usejunction.dev",
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.requireAppPrincipal.mockResolvedValue({
    userId: "user_1",
    orgId: "org_1",
    role: "user",
    email: "dev@example.com",
  });
  mocks.developerFind.mockResolvedValue({ id: "dev_1" });
  mocks.membershipFind.mockResolvedValue(null);
  mocks.enrollGate.mockResolvedValue({ allowed: true });
  mocks.issue.mockResolvedValue({
    id: "tok_1",
    token: "uj_enroll",
    expiresAt: new Date("2026-09-18T00:15:00.000Z"),
  });
  mocks.audit.mockResolvedValue(undefined);
});

test("enrollment token mint is refused without collection notice ack", async () => {
  const { POST } = await import("@/app/api/me/enrollment-token/route");
  const response = await POST(
    new Request("https://usejunction.dev/api/me/enrollment-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }) as never,
  );
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /collection notice/i);
  assert.equal(mocks.issue.mock.calls.length, 0);
});

test("enrollment token mint proceeds after matching notice version", async () => {
  mocks.membershipFind.mockResolvedValue({
    collectionNoticeAckAt: new Date("2026-09-18T00:00:00.000Z"),
    collectionNoticeVersion: "2026-09-18",
  });
  const { POST } = await import("@/app/api/me/enrollment-token/route");
  const response = await POST(
    new Request("https://usejunction.dev/api/me/enrollment-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }) as never,
  );
  assert.equal(response.status, 201);
  assert.equal(mocks.issue.mock.calls.length, 1);
});

test("enrollment token route returns auth errors from the principal guard", async () => {
  mocks.requireAppPrincipal.mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
  const { POST } = await import("@/app/api/me/enrollment-token/route");
  const response = await POST(
    new Request("https://usejunction.dev/api/me/enrollment-token", { method: "POST" }) as never,
  );
  assert.equal(response.status, 401);
});
