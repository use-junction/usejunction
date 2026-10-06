// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRole } from "@/lib/rbac/permissions";
import { workspaceContextKey } from "@/lib/app-pages/query-keys";

const mocks = vi.hoisted(() => ({
  useAppQuery: vi.fn(),
  replace: vi.fn(),
  invalidateQueries: vi.fn(),
  updateSession: vi.fn(async () => ({})),
  activateWorkspace: vi.fn(async () => undefined),
  pathname: "/dashboard",
}));

vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({
    data: { user: { id: "user-1", name: "User", email: "user@example.test", orgId: null } },
    status: "authenticated",
    update: mocks.updateSession,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/client", () => ({
  useAppQuery: mocks.useAppQuery,
  activateWorkspace: mocks.activateWorkspace,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      clear: vi.fn(),
      invalidateQueries: mocks.invalidateQueries,
    }),
  };
});

vi.mock("@/components/legal/legal-acceptance-gate", () => ({
  LegalAcceptanceGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/new-collection-banner", () => ({ NewCollectionBanner: () => null }));
vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: ({
    children,
    loading,
  }: {
    children: React.ReactNode;
    loading?: boolean;
  }) => (
    <div data-testid="workspace-shell" data-loading={loading ? "true" : "false"}>
      {loading ? <div aria-label="Loading page">Loading shell</div> : children}
    </div>
  ),
}));

type WorkspaceContextData = {
  organizations: Array<{ id: string; name: string; color: string | null; role: OrganizationRole }>;
  current: {
    id: string;
    name: string;
    color: string | null;
    role: OrganizationRole;
    onboardingCompleted: boolean;
  } | null;
  billing: null;
  sync: {
    deviceCount: number;
    activeDeviceCount: number;
    toolCount: number;
    lastSeenAt: string | null;
    lastUsageSyncAt: string | null;
    lastAccountSyncAt: string | null;
    lastToolsSyncAt: string | null;
    lastQuotasSyncAt: string | null;
    dataWatermark: string;
    presenceWatermark: string;
    dashboardReady?: boolean;
    dirtyDayCount?: number;
  };
  sessionWorkspaceSyncRequired: boolean;
};

function mockWorkspaceContext(data: WorkspaceContextData | undefined, options: { isPending?: boolean } = {}) {
  const isPending = options.isPending ?? data === undefined;
  mocks.useAppQuery.mockImplementation((queryKey: readonly unknown[], _url: string, queryOptions?: { refetchInterval?: unknown }) => {
    void queryOptions;
    if (queryKey[0] === "app" && queryKey[1] === "workspace-context") {
      return { data, error: null, refetch: vi.fn(), isPending };
    }
    return { data: undefined, error: null, refetch: vi.fn(), isPending: true };
  });
}

async function renderLayout() {
  const { WorkspaceClientLayout } = await import("@/components/workspace-client-layout");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceClientLayout><div>Dashboard screen</div></WorkspaceClientLayout>
    </QueryClientProvider>,
  );
}

const readyContext = (dataWatermark: string, overrides: Partial<WorkspaceContextData["sync"]> = {}): WorkspaceContextData => ({
  organizations: [{ id: "org-1", name: "Org", color: null, role: "owner" }],
  current: {
    id: "org-1",
    name: "Org",
    color: null,
    role: "owner",
    onboardingCompleted: true,
  },
  billing: null,
  sync: {
    deviceCount: 1,
    activeDeviceCount: 1,
    toolCount: 2,
    lastSeenAt: "2026-07-21T12:00:00.000Z",
    lastUsageSyncAt: "2026-07-21T12:05:00.000Z",
    lastAccountSyncAt: null,
    lastToolsSyncAt: null,
    lastQuotasSyncAt: null,
    dataWatermark,
    presenceWatermark: "1|1|2026-07-21T12:00:00.000Z",
    ...overrides,
  },
  sessionWorkspaceSyncRequired: false,
});

describe("WorkspaceClientLayout", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetModules();
    mocks.updateSession.mockResolvedValue({});
    mocks.activateWorkspace.mockResolvedValue(undefined);
    mocks.pathname = "/dashboard";
    mockWorkspaceContext(undefined);
  });

  it("renders the shell from workspace context without a layout page-data prefetch", async () => {
    mockWorkspaceContext(readyContext("1|2|seen|usage|"));

    await renderLayout();

    expect(screen.getByTestId("workspace-shell")).toBeTruthy();
    expect(screen.getByTestId("workspace-shell").getAttribute("data-loading")).toBe("false");
    expect(screen.getByText("Dashboard screen")).toBeTruthy();
    expect(mocks.useAppQuery).toHaveBeenCalledTimes(1);
    expect(mocks.useAppQuery).toHaveBeenCalledWith(
      workspaceContextKey,
      "/api/app/workspace-context",
      expect.objectContaining({ refetchInterval: expect.any(Function) }),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("shows a loading shell while workspace context is pending", async () => {
    mockWorkspaceContext(undefined, { isPending: true });

    await renderLayout();

    expect(screen.getByTestId("workspace-shell").getAttribute("data-loading")).toBe("true");
    expect(screen.getByLabelText("Loading page")).toBeTruthy();
    expect(screen.queryByText("Dashboard screen")).toBeNull();
  });

  it("redirects to onboarding when the user has no workspace", async () => {
    mockWorkspaceContext({
      organizations: [],
      current: null,
      billing: null,
      sync: {
        deviceCount: 0,
        activeDeviceCount: 0,
        toolCount: 0,
        lastSeenAt: null,
        lastUsageSyncAt: null,
        lastAccountSyncAt: null,
        lastToolsSyncAt: null,
        lastQuotasSyncAt: null,
        dataWatermark: "0|0|||||0|1",
        presenceWatermark: "0|0|",
      },
      sessionWorkspaceSyncRequired: false,
    });

    await renderLayout();

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/onboarding");
    });
    expect(mocks.useAppQuery).toHaveBeenCalledTimes(1);
  });

  it("redirects to onboarding when workspace onboarding is incomplete", async () => {
    mockWorkspaceContext({
      organizations: [{ id: "org-1", name: "Org", color: null, role: "owner" }],
      current: {
        id: "org-1",
        name: "Org",
        color: null,
        role: "owner",
        onboardingCompleted: false,
      },
      billing: null,
      sync: {
        deviceCount: 0,
        activeDeviceCount: 0,
        toolCount: 0,
        lastSeenAt: null,
        lastUsageSyncAt: null,
        lastAccountSyncAt: null,
        lastToolsSyncAt: null,
        lastQuotasSyncAt: null,
        dataWatermark: "0|0|||||0|1",
        presenceWatermark: "0|0|",
      },
      sessionWorkspaceSyncRequired: false,
    });

    await renderLayout();

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/onboarding");
    });
    expect(mocks.useAppQuery).toHaveBeenCalledTimes(1);
  });

  it("redirects direct Team access when the workspace role cannot view org data", async () => {
    mocks.pathname = "/team";
    const context = readyContext("1|2|usage|accounts|||0|1");
    mockWorkspaceContext({
      ...context,
      current: { ...context.current!, role: "user" },
    });

    await renderLayout();

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("syncs the session without a full page reload when JWT orgId is stale", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    mockWorkspaceContext({
      ...readyContext("1|2|seen|usage|"),
      sessionWorkspaceSyncRequired: true,
    });

    await renderLayout();

    await waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("org-1");
      expect(mocks.updateSession).toHaveBeenCalledWith({ user: { orgId: "org-1" } });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: workspaceContextKey });
    });
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("polls workspace context while devices remain connected after first usage sync", async () => {
    mockWorkspaceContext(readyContext("1|2|seen|usage|"));

    await renderLayout();

    const options = mocks.useAppQuery.mock.calls[0]?.[2] as {
      refetchInterval?: (query: { state: { data: WorkspaceContextData } }) => number | false;
    };
    expect(options?.refetchInterval).toEqual(expect.any(Function));
    const interval = options.refetchInterval!({
      state: { data: readyContext("1|2|seen|usage|") },
    });
    expect(interval).toBe(30_000);

    const dirtyInterval = options.refetchInterval!({
      state: {
        data: readyContext("1|2|seen|usage|", {
          dashboardReady: false,
          dirtyDayCount: 3,
        }),
      },
    });
    expect(dirtyInterval).toBe(15_000);

    const noDeviceInterval = options.refetchInterval!({
      state: {
        data: readyContext("0|0|||", {
          deviceCount: 0,
          toolCount: 0,
          lastSeenAt: null,
          lastUsageSyncAt: null,
        }),
      },
    });
    expect(noDeviceInterval).toBe(false);
  });

  it("invalidates page models when the data watermark advances", async () => {
    let sync = readyContext("1|0|seen||", {
      toolCount: 0,
      lastUsageSyncAt: null,
    });
    mocks.useAppQuery.mockImplementation((queryKey: readonly unknown[]) => {
      if (queryKey[0] === "app" && queryKey[1] === "workspace-context") {
        return { data: sync, error: null, refetch: vi.fn(), isPending: false };
      }
      return { data: undefined, error: null, refetch: vi.fn(), isPending: true };
    });

    const { WorkspaceClientLayout } = await import("@/components/workspace-client-layout");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceClientLayout><div>Dashboard screen</div></WorkspaceClientLayout>
      </QueryClientProvider>,
    );

    expect(mocks.invalidateQueries).not.toHaveBeenCalled();

    sync = readyContext("1|3|seen|usage|", {
      toolCount: 3,
      lastUsageSyncAt: "2026-07-21T12:05:00.000Z",
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <WorkspaceClientLayout><div>Dashboard screen</div></WorkspaceClientLayout>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith(
        { predicate: expect.any(Function) },
        { cancelRefetch: false },
      );
    });

    const { predicate } = mocks.invalidateQueries.mock.calls[0]![0] as {
      predicate: (query: { queryKey: readonly unknown[] }) => boolean;
    };
    expect(predicate({ queryKey: ["app", "workspace-context"] })).toBe(false);
    expect(predicate({ queryKey: ["app", "dashboard", ""] })).toBe(true);
    expect(predicate({ queryKey: ["other"] })).toBe(false);
  });

  it("keeps dashboard data cached when only presence advances", async () => {
    let context = readyContext("1|0|||||0|1", {
      toolCount: 0,
      lastUsageSyncAt: null,
      presenceWatermark: "1|1|2026-07-21T12:00:00.000Z",
    });
    mocks.useAppQuery.mockImplementation((queryKey: readonly unknown[]) => {
      if (queryKey[0] === "app" && queryKey[1] === "workspace-context") {
        return { data: context, error: null, refetch: vi.fn(), isPending: false };
      }
      return { data: undefined, error: null, refetch: vi.fn(), isPending: true };
    });

    const { WorkspaceClientLayout } = await import("@/components/workspace-client-layout");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceClientLayout><div>Dashboard screen</div></WorkspaceClientLayout>
      </QueryClientProvider>,
    );

    context = readyContext("1|0|||||0|1", {
      toolCount: 0,
      lastUsageSyncAt: null,
      lastSeenAt: "2026-07-21T12:15:00.000Z",
      presenceWatermark: "1|1|2026-07-21T12:15:00.000Z",
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <WorkspaceClientLayout><div>Dashboard screen</div></WorkspaceClientLayout>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith(
        { predicate: expect.any(Function) },
        { cancelRefetch: false },
      );
    });
    const { predicate } = mocks.invalidateQueries.mock.calls[0]![0] as {
      predicate: (query: { queryKey: readonly unknown[] }) => boolean;
    };
    expect(predicate({ queryKey: ["app", "dashboard", ""] })).toBe(false);
    expect(predicate({ queryKey: ["app", "team", ""] })).toBe(true);
    expect(predicate({ queryKey: ["app", "team", "syncs"] })).toBe(true);
    expect(predicate({ queryKey: ["app", "team", "usage", ""] })).toBe(false);
    expect(predicate({ queryKey: ["app", "team", "invites"] })).toBe(false);
    expect(predicate({ queryKey: ["app", "activity", ""] })).toBe(true);
  });
});
