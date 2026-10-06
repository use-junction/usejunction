// @vitest-environment happy-dom

import { fireEvent, cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  prefetchNavPage: vi.fn(),
  setOpenMobile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("@/lib/app-pages/nav-prefetch", () => ({
  prefetchNavPage: mocks.prefetchNavPage,
}));

vi.mock("@/components/app-data-state", () => ({
  AppPageSkeleton: () => <div aria-label="Loading page">Loading destination</div>,
}));

vi.mock("@/components/brand-logo", () => ({
  BrandLogo: () => <span>Logo</span>,
}));

vi.mock("@/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <span>Workspace</span>,
}));

vi.mock("@/components/workspace-user-menu", () => ({
  WorkspaceUserMenu: () => <span>User menu</span>,
}));

vi.mock("@/components/saas-billing/plan-status-card", () => ({
  ActivePlanBadge: () => null,
  PlanStatusCard: () => null,
  shouldShowSidebarPlanCard: () => false,
}));

vi.mock("@/components/ui/sidebar", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: Container,
    SidebarContent: Container,
    SidebarFooter: Container,
    SidebarGroup: Container,
    SidebarGroupContent: Container,
    SidebarGroupLabel: Container,
    SidebarHeader: Container,
    SidebarInset: Container,
    SidebarMenu: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    SidebarMenuButton: Container,
    SidebarMenuItem: Container,
    SidebarMenuSkeleton: () => <div data-testid="sidebar-menu-skeleton">Skeleton</div>,
    SidebarProvider: Container,
    SidebarTrigger: () => null,
    useSidebar: () => ({ setOpenMobile: mocks.setOpenMobile }),
  };
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.pathname = "/dashboard";
});

test("sidebar clicks select the destination and show loading before the route commits", async () => {
  const { WorkspaceShell } = await import("@/components/workspace-shell");
  const props = {
    organizations: [],
    currentOrgId: "org-1",
    role: "owner" as const,
    billing: null,
  };
  const view = render(
    <WorkspaceShell {...props}>
      <div>Current page</div>
    </WorkspaceShell>,
  );

  fireEvent.click(screen.getByRole("link", { name: "Team" }));

  expect(screen.getByLabelText("Loading page")).toBeTruthy();
  expect(screen.queryByText("Current page")).toBeNull();
  expect(screen.getByRole("link", { name: "Team" }).getAttribute("aria-current")).toBe("page");

  mocks.pathname = "/team";
  view.rerender(
    <WorkspaceShell {...props}>
      <div>Team page</div>
    </WorkspaceShell>,
  );

  await waitFor(() => {
    expect(screen.getByText("Team page")).toBeTruthy();
  });
});

test("loading shell shows nav skeletons and page skeleton without role-specific links", async () => {
  const { WorkspaceShell } = await import("@/components/workspace-shell");
  render(
    <WorkspaceShell
      organizations={[]}
      currentOrgId={null}
      role={null}
      billing={null}
      loading
    >
      <div>Current page</div>
    </WorkspaceShell>,
  );

  expect(screen.getByLabelText("Loading navigation")).toBeTruthy();
  expect(screen.getAllByTestId("sidebar-menu-skeleton")).toHaveLength(8);
  expect(screen.getByLabelText("Loading page")).toBeTruthy();
  expect(screen.queryByText("Current page")).toBeNull();
  expect(screen.queryByRole("link", { name: "Cost" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Team" })).toBeNull();
});
