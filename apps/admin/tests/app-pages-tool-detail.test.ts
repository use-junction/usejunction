import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  getToolDetail: vi.fn(),
  getRemoteSyncPanelContext: vi.fn(),
  resolveLinkedDeveloperId: vi.fn(),
  getOrgActivitySettings: vi.fn(),
}));

vi.mock("@/lib/tools/subscriptions", () => ({
  listSubscriptions: mocks.listSubscriptions,
}));

vi.mock("@/lib/queries/dashboard/tool-detail", () => ({
  getToolDetail: mocks.getToolDetail,
}));

vi.mock("@/lib/sync/remote-sync-context", () => ({
  getRemoteSyncPanelContext: mocks.getRemoteSyncPanelContext,
}));

vi.mock("@/lib/queries/me/resolve-developer", () => ({
  resolveLinkedDeveloperId: mocks.resolveLinkedDeveloperId,
}));

vi.mock("@/lib/activity/service", () => ({
  getOrgActivitySettings: mocks.getOrgActivitySettings,
}));

const principal = {
  userId: "user-mgr",
  email: "manager@example.test",
  orgId: "org-1",
  role: "manager" as const,
};

const syncPanel = {
  scope: "team" as const,
  lastSeenAt: "2026-08-03T10:00:00.000Z",
  lastUsageSyncAt: "2026-08-03T10:00:00.000Z",
  lastAccountSyncAt: null,
  hasLocalEndpoint: false,
  needsPlanSync: false,
  deviceCount: 2,
  remoteCapableDeviceCount: 2,
  dashboardReady: false,
  dirtyDayCount: 28,
  snapshotLagSeconds: 12,
  staleDeviceCount: 0,
  recoveryDevices: [],
};

const detail = {
  toolKey: "chatgpt-codex",
  name: "ChatGPT / Codex",
  shortName: "ChatGPT",
  provider: "openai",
  product: "codex",
  toolName: "codex",
  aliases: ["chatgpt", "codex"],
  sourceUrl: "https://chatgpt.com/pricing/",
  kpis: {
    devices: 2,
    people: 2,
    seatsFree: 0,
    seatsPurchased: 2,
    seatsAssigned: 2,
    usageCost: 1267.13,
    requests: 33194,
    tokens: 1_000_000,
  },
  people: [],
  quotas: [],
  accounts: [],
  modelsByDeveloper: [],
  plans: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSubscriptions.mockResolvedValue([]);
  mocks.getToolDetail.mockResolvedValue(detail);
  mocks.getRemoteSyncPanelContext.mockResolvedValue(syncPanel);
});

describe("loadToolDetailPage slices", () => {
  it("loads shell slice with sync context only", async () => {
    const { loadToolDetailPage } = await import("@/lib/app-pages/tool-detail");
    const data = await loadToolDetailPage(principal, "chatgpt-codex", {}, "shell");

    expect(data).toMatchObject({
      kind: "organization",
      slice: "shell",
      toolKey: "chatgpt-codex",
      syncContext: { dirtyDayCount: 28, dashboardReady: false },
    });
    expect(mocks.getRemoteSyncPanelContext).toHaveBeenCalledWith("org-1", "user-mgr", "team");
    expect(mocks.getToolDetail).not.toHaveBeenCalled();
    expect(mocks.listSubscriptions).not.toHaveBeenCalled();
  });

  it("loads metrics slice without sync context", async () => {
    const { loadToolDetailPage } = await import("@/lib/app-pages/tool-detail");
    const data = await loadToolDetailPage(
      principal,
      "chatgpt-codex",
      { view: "last_30_days", days: "30" },
      "metrics",
    );

    expect(data).toMatchObject({
      kind: "organization",
      slice: "metrics",
      toolKey: "chatgpt-codex",
      cycleView: "last_30_days",
      detail: { kpis: { requests: 33194, usageCost: 1267.13 } },
    });
    expect(mocks.getToolDetail).toHaveBeenCalledWith(
      "org-1",
      "chatgpt-codex",
      expect.any(Object),
      expect.objectContaining({ subscriptions: [] }),
    );
    expect(mocks.getRemoteSyncPanelContext).not.toHaveBeenCalled();
  });

  it("loads full slice with both sync context and metrics", async () => {
    const { loadToolDetailPage } = await import("@/lib/app-pages/tool-detail");
    const data = await loadToolDetailPage(principal, "chatgpt-codex", {});

    expect(data).toMatchObject({
      kind: "organization",
      slice: "full",
      toolKey: "chatgpt-codex",
      syncContext: { dirtyDayCount: 28 },
      detail: { kpis: { requests: 33194 } },
    });
    expect(mocks.getRemoteSyncPanelContext).toHaveBeenCalledTimes(1);
    expect(mocks.getToolDetail).toHaveBeenCalledTimes(1);
  });
});
