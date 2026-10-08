// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";

const mocks = vi.hoisted(() => ({
  useAppPageQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/team",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "owner" } } }),
}));

vi.mock("@/components/team-filter", () => ({
  TeamFilter: () => null,
}));

vi.mock("@/components/team/team-teams-panel", () => ({
  TeamTeamsPanel: () => <div>teams</div>,
}));

vi.mock("@/lib/api/client", () => ({
  useAppPageQuery: mocks.useAppPageQuery,
}));

vi.mock("@/components/developers/developer-tool-inventory", () => ({
  DeveloperToolInventory: (props: {
    initialDevelopers: unknown[];
    planUsageLoading?: boolean;
    planUsageError?: string | null;
  }) => (
    <div data-testid="developer-tool-inventory">
      <span>{props.initialDevelopers.length} roster members</span>
      <span>{props.planUsageLoading ? "usage loading" : "usage ready"}</span>
      {props.planUsageError ? <span>{props.planUsageError}</span> : null}
    </div>
  ),
}));

vi.mock("@/components/page-header", () => ({
  PageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/hub-nav", () => ({
  HubTabList: () => <div>tabs</div>,
}));

vi.mock("@/components/team/team-connect-panel", () => ({
  InvitePeopleDialog: () => <div>invite</div>,
}));

vi.mock("@/components/team/team-invited-panel", () => ({
  TeamInvitedPanel: () => <div>invited</div>,
}));

vi.mock("@/components/team/team-syncs-panel", () => ({
  TeamSyncsPanel: () => <div>syncs</div>,
}));

// Avoid pulling the heavy @lobehub/ui icon set (which loads @emoji-mart data as
// a raw JSON module) through the ghost-rows roster preview, matching the mock
// used in calculation-components.test.tsx.
vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolLogoTile: ({ tool }: { tool: string }) => <span aria-label={`${tool} logo`} />,
}));

vi.mock("@/components/app-data-state", () => ({
  AppPageError: ({ error }: { error: Error }) => <div>{error.message}</div>,
  AppPageSkeleton: () => <div>page loading</div>,
  isBlockingAppQueryError: (error: unknown, hasData: boolean) => Boolean(error) && !hasData,
  useAppQueryErrorToast: vi.fn(),
}));

const rosterData = {
  cycleView: "current_cycles" as const,
  rollingPeriod: { kind: "preset" as const, days: 30 as const },
  empty: false,
  developers: [{ id: "dev-1", name: "Ada" }],
  subscriptions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("renders the roster while deferred plan usage is still loading", async () => {
  mocks.useAppPageQuery
    .mockReturnValueOnce({ data: rosterData, isPending: false, error: null })
    .mockReturnValueOnce({ data: undefined, isPending: true, error: null, refetch: vi.fn() })
    .mockReturnValue({ data: undefined, isPending: false, error: null });

  const { default: TeamClientScreen } = await import("@/components/team/team-client-screen");
  render(<TeamClientScreen />);

  expect(screen.getByTestId("developer-tool-inventory")).toHaveTextContent("1 roster members");
  expect(screen.getByTestId("developer-tool-inventory")).toHaveTextContent("usage loading");
});

test("keeps the roster visible when deferred plan usage fails", async () => {
  mocks.useAppPageQuery
    .mockReturnValueOnce({ data: rosterData, isPending: false, error: null })
    .mockReturnValueOnce({
      data: undefined,
      isPending: false,
      error: new Error("usage failed"),
      refetch: vi.fn(),
    })
    .mockReturnValue({ data: undefined, isPending: false, error: null });

  const { default: TeamClientScreen } = await import("@/components/team/team-client-screen");
  render(<TeamClientScreen />);

  expect(screen.getByTestId("developer-tool-inventory")).toHaveTextContent("1 roster members");
  expect(screen.getByTestId("developer-tool-inventory")).toHaveTextContent("usage failed");
});
