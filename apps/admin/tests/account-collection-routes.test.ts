import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { beforeEach, test, vi } from "vitest";
import { NextRequest } from "next/server";

const principal = { orgId: "org-1", userId: "user-1", role: "owner", email: "owner@example.com" };
const account = { id: "acct-1", toolName: "cursor", accountKey: "user-a", usageEnabled: true };

const mocks = vi.hoisted(() => ({
  requireAppPrincipal: vi.fn(),
  requireOrgRole: vi.fn(),
  resolveLinkedDeveloperId: vi.fn(),
  listGatedAccounts: vi.fn(),
  listPendingCollectionDecisions: vi.fn(),
  listCollectionEvents: vi.fn(),
  setDeveloperAccountOptIn: vi.fn(),
  setDeveloperCollectionSwitch: vi.fn(),
  setDeveloperProviderCollection: vi.fn(),
  setAdminCollectionLock: vi.fn(),
  findDeviceByBearerToken: vi.fn(),
}));

vi.mock("@/lib/api/app-auth", () => ({ requireAppPrincipal: mocks.requireAppPrincipal }));
vi.mock("@/lib/rbac", () => ({
  requireOrgRole: mocks.requireOrgRole,
  rolesFor: (capability: string) =>
    capability === "settings_billing" || capability === "privacy_manage" ? ["owner", "admin"] : ["owner", "admin", "manager", "user"],
}));
vi.mock("@/lib/queries/me/resolve-developer", () => ({ resolveLinkedDeveloperId: mocks.resolveLinkedDeveloperId }));
vi.mock("@/lib/privacy/account-collection", () => ({
  listGatedAccounts: mocks.listGatedAccounts,
  listPendingCollectionDecisions: mocks.listPendingCollectionDecisions,
  listCollectionEvents: mocks.listCollectionEvents,
  setDeveloperAccountOptIn: mocks.setDeveloperAccountOptIn,
  setDeveloperCollectionSwitch: mocks.setDeveloperCollectionSwitch,
  setDeveloperProviderCollection: mocks.setDeveloperProviderCollection,
  setAdminCollectionLock: mocks.setAdminCollectionLock,
}));
vi.mock("@/lib/auth", () => ({ findDeviceByBearerToken: mocks.findDeviceByBearerToken }));

function json(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAppPrincipal.mockResolvedValue(principal);
  mocks.requireOrgRole.mockResolvedValue(principal);
  mocks.resolveLinkedDeveloperId.mockResolvedValue("dev-1");
  mocks.listGatedAccounts.mockResolvedValue([account]);
  mocks.listPendingCollectionDecisions.mockResolvedValue([]);
  mocks.listCollectionEvents.mockResolvedValue([]);
  mocks.setDeveloperProviderCollection.mockResolvedValue({ accounts: [account] });
  mocks.setDeveloperAccountOptIn.mockResolvedValue(account);
  mocks.setDeveloperCollectionSwitch.mockResolvedValue(account);
  mocks.setAdminCollectionLock.mockResolvedValue(account);
  mocks.findDeviceByBearerToken.mockResolvedValue({ id: "device-1", orgId: "org-1", userId: "dev-1" });
});

test("GET /api/app/me/accounts returns the signed-in developer's collection accounts", async () => {
  vi.resetModules();
  const { GET } = await import("@/app/api/app/me/accounts/route");
  const response = await GET(new NextRequest("http://localhost/api/app/me/accounts"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accounts: [account], events: [], pending: [] });
  assert.deepEqual(mocks.listGatedAccounts.mock.calls[0][0], { orgId: "org-1", userId: "dev-1" });
});

test("GET /api/app/me/accounts is empty until a developer profile exists", async () => {
  mocks.resolveLinkedDeveloperId.mockResolvedValue(null);
  vi.resetModules();
  const { GET } = await import("@/app/api/app/me/accounts/route");
  const response = await GET(new NextRequest("http://localhost/api/app/me/accounts"));
  assert.deepEqual(await response.json(), { accounts: [], events: [], pending: [] });
  assert.equal(mocks.listGatedAccounts.mock.calls.length, 0);
});

test("PATCH /api/app/me/accounts opts a provider, an account, or one stream", async () => {
  vi.resetModules();
  const { PATCH } = await import("@/app/api/app/me/accounts/route");
  const provider = await PATCH(json("http://localhost/api/app/me/accounts", "PATCH", { scope: "provider", toolName: "cursor", enabled: true }));
  assert.equal(provider.status, 200);
  assert.equal(mocks.setDeveloperProviderCollection.mock.calls[0][0].toolName, "cursor");

  const whole = await PATCH(json("http://localhost/api/app/me/accounts", "PATCH", {
    scope: "account", deviceId: "device-1", toolName: "cursor", accountKey: "user-a", enabled: false,
  }));
  assert.equal(whole.status, 200);
  assert.equal(mocks.setDeveloperAccountOptIn.mock.calls[0][0].enabled, false);

  const stream = await PATCH(json("http://localhost/api/app/me/accounts", "PATCH", {
    deviceId: "device-1", toolName: "cursor", accountKey: "user-a", stream: "logging", enabled: true,
  }));
  assert.equal(stream.status, 200);
  assert.equal(mocks.setDeveloperCollectionSwitch.mock.calls[0][0].stream, "logging");
});

test("PATCH /api/app/me/accounts rejects a missing profile and an incomplete body", async () => {
  vi.resetModules();
  const { PATCH } = await import("@/app/api/app/me/accounts/route");
  assert.equal((await PATCH(json("http://localhost/api/app/me/accounts", "PATCH", { scope: "provider", enabled: true }))).status, 400);
  mocks.resolveLinkedDeveloperId.mockResolvedValue(null);
  assert.equal((await PATCH(json("http://localhost/api/app/me/accounts", "PATCH", { scope: "provider", toolName: "cursor", enabled: true }))).status, 409);
  mocks.setDeveloperCollectionSwitch.mockResolvedValue({ error: "An admin has locked usage collection for this account.", status: 403 });
  mocks.resolveLinkedDeveloperId.mockResolvedValue("dev-1");
  const locked = await PATCH(json("http://localhost/api/app/me/accounts", "PATCH", {
    deviceId: "device-1", toolName: "cursor", accountKey: "user-a", stream: "usage", enabled: true,
  }));
  assert.equal(locked.status, 403);
});

test("admin collection lock lists the workspace and requires a complete patch", async () => {
  vi.resetModules();
  const { GET, PATCH } = await import("@/app/api/app/settings/privacy/accounts/route");
  const listed = await GET(new NextRequest("http://localhost/api/app/settings/privacy/accounts"));
  assert.equal(listed.status, 200);
  assert.deepEqual(mocks.listGatedAccounts.mock.calls[0][0], { orgId: "org-1" });
  assert.equal((await PATCH(json("http://localhost/api/app/settings/privacy/accounts", "PATCH", { stream: "usage", locked: true }))).status, 400);
  const locked = await PATCH(json("http://localhost/api/app/settings/privacy/accounts", "PATCH", {
    deviceId: "device-1", toolName: "cursor", accountKey: "user-a", stream: "usage", locked: true,
  }));
  assert.equal(locked.status, 200);
  assert.equal(mocks.setAdminCollectionLock.mock.calls[0][0].locked, true);
  mocks.requireOrgRole.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  assert.equal((await GET(new NextRequest("http://localhost/api/app/settings/privacy/accounts"))).status, 403);
});

test("device account policy is bearer-scoped and can opt in the calling device", async () => {
  vi.resetModules();
  const { GET, PATCH } = await import("@/app/api/devices/account-policy/route");
  const listed = await GET(new NextRequest("http://localhost/api/devices/account-policy"));
  assert.equal(listed.status, 200);
  assert.equal(mocks.listGatedAccounts.mock.calls[0][0].deviceId, "device-1");

  mocks.findDeviceByBearerToken.mockResolvedValue(null);
  assert.equal((await GET(new NextRequest("http://localhost/api/devices/account-policy"))).status, 401);

  mocks.findDeviceByBearerToken.mockResolvedValue({ id: "device-1", orgId: "org-1", userId: "dev-1" });
  const opted = await PATCH(json("http://localhost/api/devices/account-policy", "PATCH", {
    scope: "account", toolName: "codex", accountKey: "work", enabled: true,
  }));
  assert.equal(opted.status, 200);
  assert.equal(mocks.setDeveloperAccountOptIn.mock.calls[0][0].deviceId, "device-1");
  assert.equal((await PATCH(json("http://localhost/api/devices/account-policy", "PATCH", { toolName: "codex" }))).status, 400);
});
