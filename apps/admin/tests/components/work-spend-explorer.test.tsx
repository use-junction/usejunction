// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { oneRepositoryPayload, oneRepositoryFeed, multipleRepositoriesPayload, multipleRepositoriesFeed, projectLinkedPayload, projectLinkedFeed, workDetails } from "../fixtures/work-spend";
import { WorkSpendExplorer } from "@/components/features/work-spend-explorer";

const mocks = vi.hoisted(() => ({ appFetch: vi.fn(), replace: vi.fn(), params: "" }));
vi.mock("@/lib/api/client", () => ({ appFetch: mocks.appFetch }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.params), usePathname: () => "/work-spend", useRouter: () => ({ replace: mocks.replace }) }));

function mount(data = oneRepositoryPayload) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><WorkSpendExplorer data={data} /></QueryClientProvider>) };
}
beforeEach(() => { vi.clearAllMocks(); mocks.params = ""; mocks.appFetch.mockResolvedValue(oneRepositoryFeed); });

test("shows recognizable work immediately with combined cost and supporting breakdown", async () => {
  mount();
  expect(await screen.findByText("Add team invitations")).toBeInTheDocument();
  expect(mocks.appFetch).toHaveBeenCalledWith("/api/app/work-spend/work?days=90&sort=activity", expect.anything());
  expect(screen.getByText("$4.00")).toBeInTheDocument();
  expect(screen.getByText(/\$3.00 verified · \$1.00 est./)).toBeInTheDocument();
  expect(screen.getByText("merged")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Repository" })).not.toBeInTheDocument();
  expect(screen.getByText(/2 of 3 commits classified/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "About change mix" }));
  expect(screen.getByText(/Types come from commit prefixes/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "About change mix" })).toHaveAttribute("aria-expanded", "true");
});

test("combines URL filters before requesting the work feed", async () => {
  mocks.params = "days=30&q=alice&type=Fixes&projectId=project-roadmap&repositoryId=repo-web&sort=cost";
  mocks.appFetch.mockResolvedValue(projectLinkedFeed);
  mount({ ...projectLinkedPayload, days: 30, selectedRepositoryId: "repo-web" });
  await screen.findByText("Add team invitations");
  const url = new URL(mocks.appFetch.mock.calls[0][0], "http://local");
  expect(Object.fromEntries(url.searchParams)).toEqual({ days: "30", sort: "cost", repositoryId: "repo-web", projectId: "project-roadmap", type: "Fixes", q: "alice" });
  expect(screen.getByText(/Matching work keeps its full allocated cost/)).toBeInTheDocument();
  expect(screen.getByText("Ticket group")).toBeInTheDocument();
  expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Features 2/ }));
  const next = new URL(mocks.replace.mock.calls.at(-1)![0], "http://local");
  expect(next.searchParams.get("type")).toBe("Features");
  expect(next.searchParams.get("projectId")).toBe("project-roadmap");
  expect(next.searchParams.get("q")).toBe("alice");
});

test("repositories view includes inactive and failed repositories without a work request", async () => {
  mocks.params = "view=repositories&projectId=project-roadmap&type=Fixes";
  mount({ ...multipleRepositoriesPayload, repositories: multipleRepositoriesPayload.repositories.map(repo => repo.id === "repo-api" ? { ...repo, lastError: "Sync timed out", syncStatus: "failed" } : repo) });
  expect(screen.getByText("fixture-org/docs")).toBeInTheDocument();
  expect(screen.getByText(/No recent work/)).toBeInTheDocument();
  expect(screen.getByText("Sync timed out")).toBeInTheDocument();
  expect(mocks.appFetch).not.toHaveBeenCalled();
});

test("details load on demand and expose all Project links and allocation evidence", async () => {
  mocks.appFetch.mockImplementation((url: string) => Promise.resolve(url.includes("/details?") ? workDetails : projectLinkedFeed));
  mount(projectLinkedPayload);
  const button = await screen.findByRole("button", { name: /Add team invitations/ });
  expect(mocks.appFetch.mock.calls).toHaveLength(1);
  fireEvent.click(button);
  const sheet = await screen.findByRole("dialog", { name: "Add team invitations" });
  await within(sheet).findByText("feat: create invitation flow ↗");
  expect(within(sheet).getByText("Product roadmap ↗")).toBeInTheDocument();
  expect(within(sheet).getByText("Launch readiness ↗")).toBeInTheDocument();
  fireEvent.click(within(sheet).getByText("How this cost was allocated"));
  expect(within(sheet).getAllByText(/weight 1 commit/)).toHaveLength(2);
  expect(within(sheet).queryByText(/100%/)).not.toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("paginates server results and refreshes after app invalidation", async () => {
  mocks.appFetch.mockResolvedValueOnce({ ...oneRepositoryFeed, totalCount: 2, nextCursor: "cursor2" }).mockResolvedValueOnce({ items: [multipleRepositoriesFeed.items[1]], totalCount: 2, nextCursor: null });
  const { client } = mount(multipleRepositoriesPayload);
  fireEvent.click(await screen.findByRole("button", { name: "Load more work" }));
  await screen.findByText("Fix repeated webhook deliveries");
  expect(mocks.appFetch.mock.calls[1][0]).toContain("cursor=cursor2");
  mocks.appFetch.mockResolvedValue(multipleRepositoriesFeed);
  await client.invalidateQueries({ queryKey: ["app"] });
  expect(mocks.appFetch.mock.calls.length).toBeGreaterThan(2);
});

test("failed load has a retry and no false empty state", async () => {
  mocks.appFetch.mockRejectedValueOnce(new Error("Couldn’t load work")).mockResolvedValueOnce(oneRepositoryFeed);
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load work");
  expect(screen.queryByText("No work in this period")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Add team invitations")).toBeInTheDocument();
});
