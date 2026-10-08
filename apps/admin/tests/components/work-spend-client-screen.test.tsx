// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { multipleRepositoriesPayload, partialCoveragePayload } from "../fixtures/work-spend";

const mocks = vi.hoisted(() => ({
  useAppPageQuery: vi.fn(), invalidate: vi.fn(async () => undefined), replace: vi.fn(), fetch: vi.fn(),
  toast: { loading: vi.fn(() => "sync"), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/work-spend", useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/api/client", () => ({ useAppPageQuery: mocks.useAppPageQuery, useInvalidateAppData: () => mocks.invalidate, browserMutationInit: (method: string) => ({ method }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/features/project-tool-connect-dialog", () => ({ ProjectToolConnectDialog: () => <button type="button">Connect project tool</button> }));
vi.mock("@/components/features/work-spend-explorer", () => ({ WorkSpendExplorer: () => <div>Detailed work explorer</div> }));
vi.mock("@/components/features/work-spend-destinations", () => ({ WorkSpendDestinations: ({ workState }: { workState: string | null }) => <div>Work that received the most AI cost{workState ? ` · ${workState}` : ""}</div> }));
vi.mock("@/components/features/work-spend-trend", () => ({ WorkSpendTrend: () => <div>Weekly allocation chart</div> }));
vi.mock("@/components/features/work-spend-projects", () => ({ WorkSpendProjects: () => <div>Spend by project.</div> }));
vi.mock("@/components/features/work-spend-people", () => ({ WorkSpendPeoplePanel: () => <div>Spend by person.</div> }));
vi.mock("@/components/features/github-install-review", () => ({ GithubInstallReview: () => <div>Connect GitHub</div> }));
vi.mock("@/components/app-data-state", () => ({ AppPageError: () => <div>Unable to load</div>, AppPageSkeleton: () => <div>Loading</div>, isBlockingAppQueryError: () => false, useAppQueryErrorToast: vi.fn() }));

async function renderScreen(data = multipleRepositoriesPayload) {
  mocks.useAppPageQuery.mockReturnValue({ data, isPending: false, error: null, refetch: vi.fn() });
  const { default: WorkSpendClientScreen } = await import("@/components/features/work-spend-client-screen");
  render(<WorkSpendClientScreen />);
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
async function openMore() { await userEvent.setup().click(screen.getByRole("button", { name: "More options" })); }

test("leads with allocated work, state cards, and header actions", async () => {
  await renderScreen();
  expect(screen.getByRole("heading", { name: "Work." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  expect(screen.getByRole("button", { name: /Integrations/ })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Where the work stands" })).toHaveTextContent("Merged");
  expect(screen.getByRole("button", { name: /Merged · 1/i })).toBeInTheDocument();
  expect(screen.getByText("Weekly allocation chart")).toBeInTheDocument();
  expect(screen.getByText("Work that received the most AI cost")).toBeInTheDocument();
  expect(screen.getByText("Spend by project.")).toBeInTheDocument();
  expect(screen.getByText("Spend by person.")).toBeInTheDocument();
  await openMore();
  expect(screen.getByRole("menuitem", { name: /Export CSV/ })).toHaveAttribute("href", "/api/app/work-spend/export?days=90");
});

test("clicking a state card filters the work list", async () => {
  await renderScreen();
  fireEvent.click(screen.getByRole("button", { name: /Merged · 1/i }));
  expect(mocks.replace).toHaveBeenCalledWith("/work-spend?workState=shipped", { scroll: false });
});

test("setup strip appears only when authors or sync need attention", async () => {
  await renderScreen(partialCoveragePayload);
  expect(screen.getByText("1 GitHub author unmatched")).toBeInTheDocument();
  expect(screen.getByText("1 repository failed to sync")).toBeInTheDocument();
});

test("opening and cancelling GitHub disconnect never mutates data", async () => {
  await renderScreen();
  fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Disconnect fixture-org…$/ }));
  const dialog = await screen.findByRole("dialog", { name: "Disconnect fixture-org?" });
  expect(dialog).toHaveTextContent(/does not uninstall the GitHub App/);
  expect(mocks.fetch.mock.calls.every(([url]) => String(url).includes("/installations"))).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Disconnect fixture-org?" })).not.toBeInTheDocument());
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/disconnect"))).toBe(false);
});

test("a manager can sync but cannot disconnect GitHub", async () => {
  await renderScreen({ ...multipleRepositoriesPayload, canMapIdentities: false, canViewPeople: false });
  expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));
  expect(screen.queryByRole("button", { name: /Disconnect / })).not.toBeInTheDocument();
  expect(screen.queryByText("Spend by person.")).not.toBeInTheDocument();
});

test("reports partial GitHub sync without claiming completion", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { counts: { githubFailedRepos: 1, githubRepos: 2, githubCommits: 3 } } }), { status: 200 }));
  await renderScreen();
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalled());
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(/1 repositories could not be checked/);
});
