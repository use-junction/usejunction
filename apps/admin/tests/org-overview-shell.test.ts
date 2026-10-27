import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  developerCount: vi.fn(),
  installationCount: vi.fn(),
  installationGroupBy: vi.fn(),
  readDeviceCoverage: vi.fn(),
  getDashboardConfigHealth: vi.fn(),
}));

vi.mock("@usejunction/db", () => ({
  Prisma: { sql: vi.fn(), join: vi.fn(), empty: {} },
  prisma: {
    developer: { count: mocks.developerCount },
    toolInstallation: { count: mocks.installationCount, groupBy: mocks.installationGroupBy },
  },
}));

vi.mock("@/lib/insights/readers/devices", () => ({ readDeviceCoverage: mocks.readDeviceCoverage }));
vi.mock("@/lib/queries/dashboard/config-health", () => ({ getDashboardConfigHealth: mocks.getDashboardConfigHealth }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.developerCount.mockResolvedValue(4);
  mocks.installationCount.mockResolvedValue(0);
  mocks.installationGroupBy.mockResolvedValue([]);
  mocks.readDeviceCoverage.mockResolvedValue({ devices: 2 });
  mocks.getDashboardConfigHealth.mockResolvedValue({ issues: [] });
});

describe("getOrgOverviewShell", () => {
  it("counts People from the current roster, not people who were removed", async () => {
    const { getOrgOverviewShell } = await import("@/lib/insights/queries/get-org-overview");
    const shell = await getOrgOverviewShell("org-1");

    expect(mocks.developerCount).toHaveBeenCalledWith({ where: { orgId: "org-1", removedAt: null } });
    expect(shell.coverage.developers).toBe(4);
  });
});
