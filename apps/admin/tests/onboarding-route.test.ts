import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PendingInviteError } from "@/lib/ensure-workspace";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  updateSession: vi.fn(),
  ensureOwnerWorkspace: vi.fn(),
  buildOnboardingStatus: vi.fn(),
  buildOnboardingStatusForOrg: vi.fn(),
  syncSessionWorkspace: vi.fn(),
  resolveOrgId: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipUpdate: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
  updateSession: mocks.updateSession,
}));

vi.mock("@/lib/ensure-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ensure-workspace")>();
  return {
    ...actual,
    ensureOwnerWorkspace: mocks.ensureOwnerWorkspace,
  };
});

vi.mock("@/lib/onboarding-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/onboarding-status")>();
  return {
    ...actual,
    buildOnboardingStatus: mocks.buildOnboardingStatus,
    buildOnboardingStatusForOrg: mocks.buildOnboardingStatusForOrg,
  };
});

vi.mock("@/lib/workspace-session", () => ({
  syncSessionWorkspace: mocks.syncSessionWorkspace,
}));

vi.mock("@/lib/require-organization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/require-organization")>();
  return {
    ...actual,
    resolveOrgId: mocks.resolveOrgId,
  };
});

vi.mock("@usejunction/db", () => ({
  prisma: {
    organizationMembership: {
      findUnique: mocks.membershipFindUnique,
      update: mocks.membershipUpdate,
    },
  },
}));

const statusPayload = {
  configured: true,
  role: "owner",
  currentStep: "install" as const,
  onboardingCompletedAt: null,
  setupChecklistDismissedAt: null,
  organization: { id: "org-1", name: "Test workspace", slug: "test-workspace" },
  developer: {
    id: "dev-1",
    name: "Test",
    email: "user@example.test",
    devices: [],
  },
  steps: { install: false, team: false },
};

function postRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://usejunction.dev/api/onboarding", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://usejunction.dev",
      host: "usejunction.dev",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "usejunction-web",
      ...headers,
    },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.membershipFindUnique.mockResolvedValue(null);
  mocks.auth.mockResolvedValue({
    user: {
      id: "user-1",
      email: "user@example.test",
      name: "Test User",
      orgId: null,
      role: null,
    },
  });
  mocks.ensureOwnerWorkspace.mockResolvedValue({
    orgId: "org-1",
    role: "owner",
    created: true,
  });
  mocks.syncSessionWorkspace.mockResolvedValue({
    ok: true,
    orgId: "org-1",
    role: "owner",
    name: "Test workspace",
  });
  mocks.buildOnboardingStatusForOrg.mockResolvedValue(statusPayload);
  mocks.buildOnboardingStatus.mockResolvedValue({
    configured: true,
    role: "owner",
    currentStep: "install",
    organization: statusPayload.organization,
    steps: { install: false, team: false },
  });
});

describe("POST /api/onboarding", () => {
  it("creates a workspace, syncs the JWT, and returns full status with Server-Timing", async () => {
    const { POST } = await import("@/app/api/onboarding/route");
    const response = await POST(postRequest());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.ensureOwnerWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1", email: "user@example.test" }),
      { rejectPendingInvite: true },
    );
    expect(mocks.syncSessionWorkspace).toHaveBeenCalledWith("user-1", "org-1");
    expect(mocks.buildOnboardingStatusForOrg).toHaveBeenCalledWith("user-1", "org-1", {
      includeDeveloper: true,
      mode: "poll",
    });
    expect(payload).toMatchObject({
      configured: true,
      organization: { id: "org-1" },
      developer: expect.any(Object),
    });
    expect(response.headers.get("server-timing")).toContain("session");
    expect(response.headers.get("server-timing")).toContain("workspace");
    expect(response.headers.get("server-timing")).toContain("total");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("skips JWT sync when the session already has the workspace orgId", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.test",
        name: "Test User",
        orgId: "org-1",
        role: "owner",
      },
    });
    mocks.membershipFindUnique.mockResolvedValue({
      orgId: "org-1",
      role: "owner",
    });

    const { POST } = await import("@/app/api/onboarding/route");
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.ensureOwnerWorkspace).not.toHaveBeenCalled();
    expect(mocks.syncSessionWorkspace).not.toHaveBeenCalled();
    expect(mocks.buildOnboardingStatusForOrg).toHaveBeenCalled();
  });

  it("syncs the JWT when membership exists but session orgId is null", async () => {
    mocks.ensureOwnerWorkspace.mockResolvedValue({
      orgId: "org-1",
      role: "owner",
      created: false,
    });

    const { POST } = await import("@/app/api/onboarding/route");
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.syncSessionWorkspace).toHaveBeenCalledWith("user-1", "org-1");
  });

  it("returns 401 session_expired when the JWT user id is stale", async () => {
    mocks.ensureOwnerWorkspace.mockResolvedValue({
      orgId: "org-1",
      userId: "user-current",
      role: "owner",
      created: false,
    });

    const { POST } = await import("@/app/api/onboarding/route");
    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "session_expired" });
    expect(mocks.syncSessionWorkspace).not.toHaveBeenCalled();
  });

  it("returns 409 invite_pending when ensure blocks on a pending invite", async () => {
    mocks.ensureOwnerWorkspace.mockRejectedValue(new PendingInviteError());

    const { POST } = await import("@/app/api/onboarding/route");
    const response = await POST(postRequest());
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "invite_pending", configured: false });
    expect(mocks.syncSessionWorkspace).not.toHaveBeenCalled();
  });

  it("rejects cross-site POSTs in production via browserMutationGuard", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { POST } = await import("@/app/api/onboarding/route");
      const response = await POST(
        postRequest({
          origin: "https://evil.example",
        }),
      );
      expect(response.status).toBe(403);
      expect(mocks.ensureOwnerWorkspace).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("GET /api/onboarding", () => {
  it("returns a summary payload without developer by default", async () => {
    const { GET } = await import("@/app/api/onboarding/route");
    const response = await GET(new NextRequest("https://usejunction.dev/api/onboarding"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.buildOnboardingStatus).toHaveBeenCalledWith("user-1", null, {
      includeDeveloper: false,
      mode: "full",
    });
    expect(payload.developer).toBeUndefined();
    expect(response.headers.get("server-timing")).toContain("total");
  });

  it("includes developer when include=developer", async () => {
    mocks.buildOnboardingStatus.mockResolvedValue(statusPayload);
    const { GET } = await import("@/app/api/onboarding/route");
    const response = await GET(
      new NextRequest("https://usejunction.dev/api/onboarding?include=developer"),
    );
    const payload = await response.json();

    expect(mocks.buildOnboardingStatus).toHaveBeenCalledWith("user-1", null, {
      includeDeveloper: true,
      mode: "poll",
    });
    expect(payload.developer).toEqual(statusPayload.developer);
  });
});
