import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  developerFindFirst: vi.fn(),
  deviceFindFirst: vi.fn(),
  enrollmentTokenFindFirst: vi.fn(),
  issueRepairEnrollmentToken: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/api/app-auth", () => ({
  requireAppPrincipal: mocks.requireAppPrincipal,
}));

vi.mock("@/lib/rbac", () => ({
  rolesFor: () => ["owner", "admin", "manager", "user"],
  audit: mocks.audit,
}));

vi.mock("@/lib/security/http", () => ({
  browserMutationGuard: () => null,
}));

vi.mock("@/lib/public-url", () => ({
  getPublicAppUrl: () => "https://usejunction.dev",
}));

vi.mock("@/lib/enrollment-token", () => ({
  issueRepairEnrollmentToken: mocks.issueRepairEnrollmentToken,
}));

vi.mock("@usejunction/db", () => ({
  prisma: {
    developer: { findFirst: mocks.developerFindFirst },
    device: { findFirst: mocks.deviceFindFirst },
    enrollmentToken: { findFirst: mocks.enrollmentTokenFindFirst },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAppPrincipal.mockResolvedValue({
    userId: "auth_1",
    email: "dev@example.com",
    orgId: "org_1",
    role: "user",
  });
  mocks.developerFindFirst.mockResolvedValue({ id: "dev_1" });
  mocks.deviceFindFirst.mockResolvedValue({
    id: "device_1",
    userId: "dev_1",
    hostname: "MacBook-Pro.local",
  });
  mocks.issueRepairEnrollmentToken.mockResolvedValue({
    id: "enroll_repair",
    token: "uj_enroll_repair_token",
    expiresAt: new Date("2026-08-09T15:00:00.000Z"),
  });
  mocks.audit.mockResolvedValue(undefined);
});

test("POST /api/me/devices/:id/repair returns tokenized install commands", async () => {
  const { POST } = await import("@/app/api/me/devices/[id]/repair/route");
  const response = await POST(
    new Request("https://usejunction.dev/api/me/devices/device_1/repair", { method: "POST" }) as never,
    { params: Promise.resolve({ id: "device_1" }) },
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.deviceId, "device_1");
  assert.equal(body.token, "uj_enroll_repair_token");
  assert.match(body.commands.macosLinux, /--token uj_enroll_repair_token/);
  assert.match(body.commands.windows, /uj_enroll_repair_token/);
  assert.doesNotMatch(body.commands.macosLinux, /--resume/);
  assert.deepEqual(mocks.issueRepairEnrollmentToken.mock.calls[0]?.[0], {
    orgId: "org_1",
    developerId: "dev_1",
    deviceId: "device_1",
  });
});

test("POST /api/me/devices/:id/repair rejects non-owner devices", async () => {
  mocks.deviceFindFirst.mockResolvedValue({
    id: "device_1",
    userId: "other_dev",
    hostname: "MacBook-Pro.local",
  });

  const { POST } = await import("@/app/api/me/devices/[id]/repair/route");
  const response = await POST(
    new Request("https://usejunction.dev/api/me/devices/device_1/repair", { method: "POST" }) as never,
    { params: Promise.resolve({ id: "device_1" }) },
  );

  assert.equal(response.status, 403);
});

test("POST /api/me/devices/:id/repair returns auth errors from principal guard", async () => {
  mocks.requireAppPrincipal.mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );

  const { POST } = await import("@/app/api/me/devices/[id]/repair/route");
  const response = await POST(
    new Request("https://usejunction.dev/api/me/devices/device_1/repair", { method: "POST" }) as never,
    { params: Promise.resolve({ id: "device_1" }) },
  );

  assert.equal(response.status, 401);
});

test("GET /api/me/devices/:id/repair waits for a usage sync before reporting connected", async () => {
  const { GET } = await import("@/app/api/me/devices/[id]/repair/route");
  const usedAt = new Date("2026-08-09T14:00:00.000Z");
  const after = new Date("2026-08-09T14:00:05.000Z");
  const statusFor = async (repairDevice: { lastSeenAt: Date; lastUsageSyncAt: Date | null }) => {
    mocks.enrollmentTokenFindFirst.mockResolvedValueOnce({
      usedAt,
      expiresAt: new Date("2026-08-09T15:00:00.000Z"),
      repairDevice: { ...repairDevice, decommissionedAt: null },
    });
    const response = await GET(
      { nextUrl: new URL("https://usejunction.dev/api/me/devices/device_1/repair?tokenId=enroll_repair") } as never,
      { params: Promise.resolve({ id: "device_1" }) },
    );
    return ((await response.json()) as { status: string }).status;
  };

  assert.equal(await statusFor({ lastSeenAt: usedAt, lastUsageSyncAt: null }), "enrolled");
  assert.equal(await statusFor({ lastSeenAt: after, lastUsageSyncAt: usedAt }), "syncing");
  assert.equal(await statusFor({ lastSeenAt: after, lastUsageSyncAt: after }), "connected");
});
