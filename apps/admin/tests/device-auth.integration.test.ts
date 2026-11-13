/**
 * Device sign-in against the real database: start → approve in the browser →
 * poll. Run with DATABASE_URL set (apps/admin/.env → localhost:5432).
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { test, vi } from "vitest";
import { prisma } from "@usejunction/db";
import { hashOpaqueToken } from "@/lib/security";

const runDb = Boolean(process.env.DATABASE_URL);

const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; email: string; name: string; orgId: string | null } },
}));

vi.mock("@/auth", () => ({
  auth: async () => session.current,
  updateSession: async () => null,
}));

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3001${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAccount(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `device-auth-${suffix}@example.com`, name: "Device Auth", emailVerified: new Date() },
  });
  const org = await prisma.organization.create({
    data: { name: `Device Auth ${suffix}`, slug: `device-auth-${suffix}` },
  });
  await prisma.organizationMembership.create({ data: { userId: user.id, orgId: org.id, role: "owner" } });
  const developer = await prisma.developer.create({
    data: { orgId: org.id, email: user.email, name: "Device Auth", role: "owner", authUserId: user.id },
  });
  return { user, org, developer };
}

async function startRequest(hostname: string) {
  const { POST } = await import("@/app/api/device-auth/start/route");
  const response = await POST(
    post("/api/device-auth/start", { hostname, os: "darwin", architecture: "arm64", agentVersion: "0.9.0" }),
  );
  assert.equal(response.status, 201);
  return (await response.json()) as { deviceCode: string; userCode: string };
}

async function poll(deviceCode: string) {
  const { POST } = await import("@/app/api/device-auth/poll/route");
  return (await (await POST(post("/api/device-auth/poll", { deviceCode }))).json()) as Record<string, unknown>;
}

async function approve(code: string, orgId: string) {
  const { POST } = await import("@/app/api/device-auth/approve/route");
  const response = await POST(post("/api/device-auth/approve", { code, decision: "approve", orgId }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("a device approved in the browser is created for the approver and can be issued only once", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { user, org, developer } = await seedAccount(suffix);
  session.current = { user: { id: user.id, email: user.email, name: "Device Auth", orgId: org.id } };

  try {
    const started = await startRequest(`host-${suffix}`);
    assert.equal((await poll(started.deviceCode)).status, "pending");

    const approval = await approve(started.userCode, org.id);
    assert.equal(approval.status, 200);

    const granted = await poll(started.deviceCode);
    assert.equal(granted.status, "approved");
    assert.equal(granted.orgId, org.id);
    assert.equal(granted.userId, developer.id);
    const deviceToken = String(granted.deviceToken);
    assert.match(deviceToken, /^uj_dev_/);

    // The token the agent received is the one the device row will authenticate.
    const device = await prisma.device.findUniqueOrThrow({ where: { id: String(granted.deviceId) } });
    assert.equal(device.orgId, org.id);
    assert.equal(device.userId, developer.id);
    assert.equal(device.hostname, `host-${suffix}`);
    assert.equal(device.deviceTokenHash, hashOpaqueToken(deviceToken));
    assert.ok(device.collectionNoticeAckAt);

    const membership = await prisma.organizationMembership.findUniqueOrThrow({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
    });
    assert.ok(membership.collectionNoticeAckAt);

    const request = await prisma.deviceAuthRequest.findUniqueOrThrow({
      where: { deviceCodeHash: hashOpaqueToken(started.deviceCode) },
    });
    assert.equal(request.status, "consumed");
    assert.ok(request.consumedAt);

    assert.equal((await poll(started.deviceCode)).status, "consumed");
    assert.equal(await prisma.device.count({ where: { orgId: org.id } }), 1);

    // One device per person: a second machine is stopped at approval, before the agent hears anything.
    const second = await startRequest(`second-${suffix}`);
    const refused = await approve(second.userCode, org.id);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "This user already has a device enrolled.");
    assert.equal((await poll(second.deviceCode)).status, "pending");
  } finally {
    session.current = null;
    await prisma.deviceAuthRequest.deleteMany({ where: { hostname: { endsWith: suffix } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
