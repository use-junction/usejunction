// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { multipleRepositoriesFeed, projectLinkedFeed, projectLinkedPayload, weakTitleWork } from "../fixtures/work-spend";
import { WorkSpendDestinations } from "@/components/features/work-spend-destinations";

const mocks = vi.hoisted(() => ({ appFetch: vi.fn() }));
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    appFetch: mocks.appFetch,
    useAppQuery: (queryKey: unknown[], url: string, options: { enabled?: boolean } = {}) => useQuery({
      queryKey, queryFn: () => mocks.appFetch(url), enabled: options.enabled ?? true, retry: false,
    }),
  };
});

function mount(workState: "shipped" | "in_flight" | "stalled" | null = null, extras: { projectId?: string | null; developerId?: string | null } = {}, handlers = {
  onExplore: vi.fn(), onSync: vi.fn(), onSelectedItem: vi.fn(),
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkSpendDestinations
        data={projectLinkedPayload}
        workState={workState}
        projectId={extras.projectId ?? null}
        developerId={extras.developerId ?? null}
        onExplore={handlers.onExplore}
        onSync={handlers.onSync}
        selectedItem={null}
        onSelectedItem={handlers.onSelectedItem}
      />
    </QueryClientProvider>,
  );
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appFetch.mockResolvedValue(multipleRepositoriesFeed);
});

test("top work is a ruled list without share-of-linked or destination tabs", async () => {
  mount();
  expect(await screen.findByRole("button", { name: "Add team invitations, $4.00" })).toBeInTheDocument();
  expect(screen.getAllByText("fixture-org/web").length).toBeGreaterThan(0);
  expect(screen.getAllByText("MERGED").length).toBeGreaterThan(0);
  expect(screen.getAllByText("NOT MOVING").length).toBeGreaterThan(0);
  expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Projects", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Repositories", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/of linked/)).not.toBeInTheDocument();
});

test("a state filter is reflected in the heading and request", async () => {
  mount("stalled");
  expect(await screen.findByText(/Not moving work/)).toBeInTheDocument();
  expect(String(mocks.appFetch.mock.calls[0][0])).toContain("workState=stalled");
});

test("a person filter is reflected in the heading and request", async () => {
  mount(null, { developerId: "dev-a" });
  expect(await screen.findByText(/Ada Fixture/)).toBeInTheDocument();
  expect(String(mocks.appFetch.mock.calls[0][0])).toContain("developerId=dev-a");
});

test("See all work opens the explorer and weak titles stay in mono", async () => {
  mocks.appFetch.mockResolvedValue({ items: [weakTitleWork], totalCount: 1, nextCursor: null });
  const handlers = mount();
  expect(await screen.findByText("Commit a1b2c3d")).toBeInTheDocument();
  expect(screen.getByText("sdf")).toBeInTheDocument();
  expect(screen.getByText(/Not on a project/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /See all work/ }));
  expect(handlers.onExplore).toHaveBeenCalled();
});

test("a linked GitHub Project name and status appear on the work row", async () => {
  mocks.appFetch.mockResolvedValue(projectLinkedFeed);
  mount();
  expect(await screen.findByText(/Product roadmap · In progress/)).toBeInTheDocument();
});
