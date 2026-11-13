import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { beforeEach, test, vi } from "vitest";

/**
 * Device sign-in, end to end against an in-memory table: the agent starts a
 * request, a signed-in person approves the code, and the agent's poll is
 * answered with device credentials exactly once.
 */

type Row = {
  id: string;
  deviceCodeHash: string;
  userCode: string;
  hostname: string;
  os: string;
  architecture: string;
  agentVersion: string;
  status: string;
  approvedByUserId: string | null;
  orgId: string | null;
  developerId: string | null;
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  session: null as null | { user: { id: string; email: string; name?: string; orgId: string | null } },
  memberships: [] as { userId: string; orgId: string; name: string }[],
  developers: [] as { id: string; orgId: string; authUserId: string }[],
  devices: [] as Record<string, unknown>[],
  membershipUpdates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  enrollGate: { allowed: true } as { allowed: true } | { allowed: false; message: string },
  identity: { verified: true } as { verified: true } | { verified: false; status: number; error: string },
  ensureOwnerWorkspace: null as null | (() => Promise<{ orgId: string; userId: string }>),
  syncedOrgs: [] as string[],
}));

function matches(row: Row, where: Record<string, unknown>) {
  for (const [key, expected] of Object.entries(where)) {
    const actual = (row as Record<string, unknown>)[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const condition = expected as { gt?: Date };
      if (condition.gt && !((actual as Date) > condition.gt)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

vi.mock("@usejunction/db", () => {
  const deviceAuthRequest = {
    create: async ({ data }: { data: Partial<Row> }) => {
      const row: Row = {
        id: `req_${state.rows.length + 1}`,
        status: "pending",
        approvedByUserId: null,
        orgId: null,
        developerId: null,
        approvedAt: null,
        consumedAt: null,
        ...(data as Row),
      };
      state.rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      state.rows.find((row) => matches(row, where)) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hits = state.rows.filter((row) => matches(row, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  };
  const organizationMembership = {
    findUnique: async ({ where }: { where: { userId_orgId: { userId: string; orgId: string } } }) => {
      const found = state.memberships.find(
        (m) => m.userId === where.userId_orgId.userId && m.orgId === where.userId_orgId.orgId,
      );
      return found ? { orgId: found.orgId } : null;
    },
    findMany: async ({ where }: { where: { userId: string } }) =>
      state.memberships
        .filter((m) => m.userId === where.userId)
        .map((m) => ({ orgId: m.orgId, organization: { name: m.name } })),
    update: async (args: Record<string, unknown>) => {
      state.membershipUpdates.push(args);
      return {};
    },
  };
  const developer = {
    findFirst: async ({ where }: { where: { orgId: string; authUserId: string } }) =>
      state.developers.find((d) => d.orgId === where.orgId && d.authUserId === where.authUserId) ?? null,
  };
  const device = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const created = { id: `device_${state.devices.length + 1}`, ...data };
      state.devices.push(created);
      return created;
    },
  };
  const prisma = {
    deviceAuthRequest,
    organizationMembership,
    developer,
    device,
    telemetryEndpoint: { findUnique: async () => null },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ deviceAuthRequest, organizationMembership, device }),
  };
  return {
    prisma,
    Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
  };
});

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/auth", () => ({ generateDeviceToken: () => "uj_dev_issued_once" }));
vi.mock("@/lib/agent-updates", () => ({
  normalizeAgentVersion: (value: unknown, fallback: string) => (value ? String(value) : fallback),
}));
vi.mock("@/lib/public-url", () => ({ getPublicAppUrl: () => "https://usejunction.dev" }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => true }));
vi.mock("@/lib/errors/public", () => ({ logServerError: vi.fn() }));
vi.mock("@/lib/saas-billing/status", () => ({ assertCanEnrollDevice: async () => state.enrollGate }));
vi.mock("@/lib/developer-identity", () => ({ getIdentityVerificationStatus: async () => state.identity }));
vi.mock("@/lib/ensure-auth-user", () => ({ isAuthUserNotFoundError: () => false }));
vi.mock("@/lib/ensure-workspace", () => ({
  ensureOwnerWorkspace: async () => {
    if (!state.ensureOwnerWorkspace) throw new Error("ensureOwnerWorkspace not expected");
    return state.ensureOwnerWorkspace();
  },
  isPendingInviteError: (error: unknown) => error instanceof Error && error.message === "invite_pending",
}));
vi.mock("@/lib/require-organization", () => ({
  ACTIVE_ORG_COOKIE: "uj_active_org",
  resolveOrgId: async (userId: string, sessionOrgId: string | null) =>
    sessionOrgId ?? state.memberships.find((m) => m.userId === userId)?.orgId ?? null,
}));
vi.mock("@/lib/rbac", () => ({
  audit: async (entry: Record<string, unknown>) => {
    state.audits.push(entry);
  },
}));
vi.mock("@/lib/workspace-session", () => ({
  syncSessionWorkspace: async (_userId: string, orgId: string) => {
    state.syncedOrgs.push(orgId);
    return { ok: true, orgId, role: "owner", name: "Workspace" };
  },
}));

function post(path: string, body: unknown) {
  return new NextRequest(`https://usejunction.dev${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function start() {
  const { POST } = await import("@/app/api/device-auth/start/route");
  const response = await POST(
    post("/api/device-auth/start", {
      hostname: "Dinus-MacBook-Pro.local",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "0.9.0",
    }),
  );
  assert.equal(response.status, 201);
  return (await response.json()) as {
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
    interval: number;
  };
}

async function poll(deviceCode: string) {
  const { POST } = await import("@/app/api/device-auth/poll/route");
  const response = await POST(post("/api/device-auth/poll", { deviceCode }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function decide(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/device-auth/approve/route");
  const response = await POST(post("/api/device-auth/approve", body));
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, response };
}

function signIn(orgId: string | null = "org_1") {
  state.session = { user: { id: "user_1", email: "dev@example.com", name: "Dev", orgId } };
}

beforeEach(() => {
  state.rows = [];
  state.session = null;
  state.memberships = [{ userId: "user_1", orgId: "org_1", name: "Acme" }];
  state.developers = [{ id: "developer_1", orgId: "org_1", authUserId: "user_1" }];
  state.devices = [];
  state.membershipUpdates = [];
  state.audits = [];
  state.enrollGate = { allowed: true };
  state.identity = { verified: true };
  state.ensureOwnerWorkspace = null;
  state.syncedOrgs = [];
});

test("starting a request returns a secret for the agent and a link for the person", async () => {
  const started = await start();

  assert.match(started.deviceCode, /^uj_device_/);
  assert.match(started.userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.equal(started.verificationUrl, `https://usejunction.dev/connect?code=${started.userCode}`);
  assert.equal(started.expiresIn, 900);

  // Only a hash of the agent's secret is stored.
  assert.equal(state.rows.length, 1);
  assert.notEqual(state.rows[0].deviceCodeHash, started.deviceCode);
  assert.equal(JSON.stringify(state.rows[0]).includes(started.deviceCode), false);
});

test("the agent waits until someone approves, then gets device credentials exactly once", async () => {
  const started = await start();

  const waiting = await poll(started.deviceCode);
  assert.deepEqual(waiting.body, { status: "pending", interval: 3 });
  assert.equal(state.devices.length, 0);

  signIn();
  const approval = await decide({ code: started.userCode.toLowerCase(), decision: "approve" });
  assert.equal(approval.status, 200);
  assert.deepEqual(approval.body, { status: "approved", orgId: "org_1" });

  const granted = await poll(started.deviceCode);
  assert.equal(granted.body.status, "approved");
  assert.equal(granted.body.deviceToken, "uj_dev_issued_once");
  assert.equal(granted.body.orgId, "org_1");
  assert.equal(granted.body.userId, "developer_1");
  assert.equal(granted.body.deviceId, "device_1");
  assert.deepEqual(granted.body.otel, {
    enabled: true,
    metricsEndpoint: "https://usejunction.dev/api/otel/v1/metrics",
  });

  // The device belongs to the approver, carries the machine's details, and
  // records the notice they saw on the approval page.
  assert.equal(state.devices.length, 1);
  assert.equal(state.devices[0].orgId, "org_1");
  assert.equal(state.devices[0].userId, "developer_1");
  assert.equal(state.devices[0].hostname, "Dinus-MacBook-Pro.local");
  assert.equal(state.devices[0].collectionNoticeVersion, "2026-09-18");
  assert.ok(state.devices[0].collectionNoticeAckAt instanceof Date);

  // A second poll with the same secret gets nothing.
  const replay = await poll(started.deviceCode);
  assert.deepEqual(replay.body, { status: "consumed" });
  assert.equal(state.devices.length, 1);
});

test("approving records the collection notice on the membership and in the audit log", async () => {
  const started = await start();
  signIn();
  await decide({ code: started.userCode, decision: "approve" });

  assert.equal(state.membershipUpdates.length, 1);
  const update = state.membershipUpdates[0] as {
    where: { userId_orgId: { userId: string; orgId: string } };
    data: { collectionNoticeVersion: string; collectionNoticeAckAt: Date };
  };
  assert.deepEqual(update.where.userId_orgId, { userId: "user_1", orgId: "org_1" });
  assert.equal(update.data.collectionNoticeVersion, "2026-09-18");
  assert.deepEqual(
    state.audits.map((entry) => entry.action).sort(),
    ["collection_notice.acknowledged", "device_auth.approved"],
  );
});

test("approval needs a signed-in, verified person", async () => {
  const started = await start();

  const signedOut = await decide({ code: started.userCode, decision: "approve" });
  assert.equal(signedOut.status, 401);

  signIn();
  state.identity = { verified: false, status: 403, error: "verify your email to continue" };
  const unverified = await decide({ code: started.userCode, decision: "approve" });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.error, "verify your email to continue");

  assert.equal(state.rows[0].status, "pending");
  assert.deepEqual((await poll(started.deviceCode)).body, { status: "pending", interval: 3 });
});

test("a refused request tells the agent so and can never be approved", async () => {
  const started = await start();
  signIn();

  const refusal = await decide({ code: started.userCode, decision: "deny" });
  assert.deepEqual(refusal.body, { status: "denied" });
  assert.deepEqual((await poll(started.deviceCode)).body, { status: "denied" });

  const late = await decide({ code: started.userCode, decision: "approve" });
  assert.equal(late.status, 409);
  assert.equal(state.devices.length, 0);
});

test("an expired code cannot be approved and the agent is told it expired", async () => {
  const started = await start();
  state.rows[0].expiresAt = new Date(Date.now() - 1000);
  signIn();

  const approval = await decide({ code: started.userCode, decision: "approve" });
  assert.equal(approval.status, 410);
  assert.deepEqual((await poll(started.deviceCode)).body, { status: "expired" });
  assert.equal(state.devices.length, 0);
});

test("an approval in the last seconds still reaches the agent's next poll", async () => {
  const started = await start();
  state.rows[0].expiresAt = new Date(Date.now() + 2000);
  signIn();

  await decide({ code: started.userCode, decision: "approve" });
  assert.ok(state.rows[0].expiresAt.getTime() > Date.now() + 60_000);
});

test("a code can be approved by only one person", async () => {
  const started = await start();
  signIn();
  assert.equal((await decide({ code: started.userCode, decision: "approve" })).status, 200);
  assert.equal((await decide({ code: started.userCode, decision: "approve" })).status, 409);
});

test("someone who already has a device connected is told so before the agent is", async () => {
  const started = await start();
  signIn();
  state.enrollGate = { allowed: false, message: "This user already has a device enrolled." };

  const approval = await decide({ code: started.userCode, decision: "approve" });
  assert.equal(approval.status, 403);
  assert.equal(approval.body.error, "This user already has a device enrolled.");
  assert.equal(state.rows[0].status, "pending");
});

test("a device connected in between approval and poll fails the poll instead of adding a second device", async () => {
  const started = await start();
  signIn();
  await decide({ code: started.userCode, decision: "approve" });
  state.enrollGate = { allowed: false, message: "This user already has a device enrolled." };

  const result = await poll(started.deviceCode);
  assert.deepEqual(result.body, { status: "failed", error: "This user already has a device enrolled." });
  assert.equal(state.devices.length, 0);
});

test("the approver can pick another workspace they belong to, and the session follows", async () => {
  state.memberships.push({ userId: "user_1", orgId: "org_2", name: "Side project" });
  state.developers.push({ id: "developer_2", orgId: "org_2", authUserId: "user_1" });
  const started = await start();
  signIn("org_1");

  const approval = await decide({ code: started.userCode, decision: "approve", orgId: "org_2" });
  assert.deepEqual(approval.body, { status: "approved", orgId: "org_2" });
  assert.deepEqual(state.syncedOrgs, ["org_2"]);

  const granted = await poll(started.deviceCode);
  assert.equal(granted.body.orgId, "org_2");
  assert.equal(granted.body.userId, "developer_2");
});

test("a workspace the approver does not belong to is refused", async () => {
  const started = await start();
  signIn();
  const approval = await decide({ code: started.userCode, decision: "approve", orgId: "org_other" });
  assert.equal(approval.status, 403);
  assert.equal(state.rows[0].status, "pending");
});

test("a new account with no workspace gets one when it approves its first device", async () => {
  state.memberships = [];
  state.developers = [];
  state.ensureOwnerWorkspace = async () => {
    state.memberships.push({ userId: "user_1", orgId: "org_new", name: "Dev workspace" });
    state.developers.push({ id: "developer_new", orgId: "org_new", authUserId: "user_1" });
    return { orgId: "org_new", userId: "user_1" };
  };
  const started = await start();
  signIn(null);

  const approval = await decide({ code: started.userCode, decision: "approve" });
  assert.deepEqual(approval.body, { status: "approved", orgId: "org_new" });
  assert.equal((await poll(started.deviceCode)).body.orgId, "org_new");
});

test("an unknown agent secret is a 404, not a pending request", async () => {
  await start();
  const result = await poll("uj_device_not_issued");
  assert.equal(result.status, 404);
});

test("the approval page learns which machine is asking only when signed in", async () => {
  const started = await start();
  const { GET } = await import("@/app/api/device-auth/request/route");
  const url = `https://usejunction.dev/api/device-auth/request?code=${started.userCode}`;

  assert.equal((await GET(new NextRequest(url))).status, 401);

  signIn();
  const response = await GET(new NextRequest(url));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "pending");
  assert.equal(body.code, started.userCode);
  assert.deepEqual(body.device, { hostname: "Dinus-MacBook-Pro.local", os: "macOS" });
  assert.deepEqual(body.workspaces, [{ id: "org_1", name: "Acme", current: true, blocked: null }]);
  assert.match(body.notice.summary, /^Acme is connecting this machine/);

  const missing = await GET(new NextRequest("https://usejunction.dev/api/device-auth/request?code=ZZZZ-ZZZZ"));
  assert.equal(missing.status, 404);
});

test("device sign-in routes and the approval page are reachable without a session", async () => {
  const { isPublicPath } = await import("@/auth.config");
  assert.equal(isPublicPath("/connect"), true);
  assert.equal(isPublicPath("/api/device-auth/start"), true);
  assert.equal(isPublicPath("/api/device-auth/poll"), true);
  assert.equal(isPublicPath("/api/device-auth/approve"), true);
});
