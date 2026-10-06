import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    providerConnection: { findFirst: vi.fn() },
    externalIdentity: { findMany: vi.fn() },
    device: { findMany: vi.fn() },
    syncRequest: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    syncRequest: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  notifyServerIssue: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  prisma: mocks.prisma,
  Prisma: {},
}));

vi.mock("@/lib/analytics/snapshots/readiness", () => ({
  getWorkspaceSyncReadiness: vi.fn().mockResolvedValue({
    dashboardReady: true,
    dirtyDayCount: 0,
    snapshotLagSeconds: null,
  }),
}));

vi.mock("@/lib/notifications/slack", () => ({
  notifyServerIssue: mocks.notifyServerIssue,
}));

vi.mock("@/lib/email/device-recovery", () => ({
  sendDeviceRecoveryEmail: vi.fn(),
}));

vi.mock("@/lib/errors/public", () => ({
  logServerError: vi.fn(),
}));

const now = new Date("2026-09-21T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ABLY_API_KEY;
  mocks.prisma.$transaction.mockImplementation((fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
  mocks.prisma.syncRequest.findUnique.mockResolvedValue(null);
  mocks.prisma.syncRequest.update.mockResolvedValue({});
  mocks.tx.syncRequest.create.mockResolvedValue({ id: "feat-sync-1" });
  mocks.tx.auditLog.create.mockResolvedValue({});
});

describe("featuresGithubAutomationKey", () => {
  it("buckets wakes into the same 15-minute window", async () => {
    const { featuresGithubAutomationKey } = await import("@/lib/features/autosync");
    const first = featuresGithubAutomationKey("dev-1", now);
    const later = featuresGithubAutomationKey("dev-1", new Date(now.getTime() + 14 * 60 * 1000));
    const nextWindow = featuresGithubAutomationKey("dev-1", new Date(now.getTime() + 15 * 60 * 1000));
    expect(first).toBe(later);
    expect(nextWindow).not.toBe(first);
  });

  it("force keys are unique per call", async () => {
    const { featuresGithubAutomationKey } = await import("@/lib/features/autosync");
    const a = featuresGithubAutomationKey("dev-1", now, true);
    const b = featuresGithubAutomationKey("dev-1", new Date(now.getTime() + 1), true);
    expect(a).not.toBe(b);
  });
});

describe("wakeGitHubAuthorDaemons", () => {
  it("skips when GitHub is not connected", async () => {
    mocks.prisma.providerConnection.findFirst.mockResolvedValue(null);
    const { wakeGitHubAuthorDaemons } = await import("@/lib/features/autosync");
    const result = await wakeGitHubAuthorDaemons("org-1", { now });
    expect(result).toMatchObject({ skipped: true, reason: "github_disconnected", requestsCreated: 0 });
    expect(mocks.prisma.externalIdentity.findMany).not.toHaveBeenCalled();
  });

  it("queues remote usage sync for mapped GitHub authors' daemons", async () => {
    mocks.prisma.providerConnection.findFirst.mockResolvedValue({ id: "conn-1" });
    mocks.prisma.externalIdentity.findMany.mockResolvedValue([
      { developerId: "dev-1" },
      { developerId: "dev-1" },
      { developerId: "dev-2" },
    ]);
    mocks.prisma.device.findMany.mockResolvedValue([
      { id: "device-1", userId: "dev-1" },
      { id: "device-2", userId: "dev-2" },
    ]);

    const { wakeGitHubAuthorDaemons } = await import("@/lib/features/autosync");
    const result = await wakeGitHubAuthorDaemons("org-1", { now });

    expect(result).toMatchObject({ skipped: false, developers: 2, devices: 2, requestsCreated: 2 });
    expect(mocks.tx.syncRequest.create).toHaveBeenCalledTimes(2);
    expect(mocks.tx.syncRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        trigger: "features_github",
        developerId: "dev-1",
        requesterUserId: null,
        targets: { createMany: { data: [expect.objectContaining({ deviceId: "device-1" })] } },
      }),
    }));
  });

  it("dedupes the same 15-minute automation key", async () => {
    mocks.prisma.providerConnection.findFirst.mockResolvedValue({ id: "conn-1" });
    mocks.prisma.externalIdentity.findMany.mockResolvedValue([{ developerId: "dev-1" }]);
    mocks.prisma.device.findMany.mockResolvedValue([{ id: "device-1", userId: "dev-1" }]);
    mocks.prisma.syncRequest.findUnique.mockResolvedValue({ id: "existing" });

    const { wakeGitHubAuthorDaemons } = await import("@/lib/features/autosync");
    const result = await wakeGitHubAuthorDaemons("org-1", { now });
    expect(result.requestsCreated).toBe(0);
    expect(result.reason).toBe("already_queued");
    expect(mocks.tx.syncRequest.create).not.toHaveBeenCalled();
  });
});
