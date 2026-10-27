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

async function openIntegrations(data = multipleRepositoriesPayload) {
  await renderScreen(data);
  fireEvent.click(screen.getByRole("button", { name: /Integrations/ }));
  return screen.findByRole("dialog", { name: "Integrations" });
}

test("the Integrations dialog lists GitHub accounts and Projects as sections with one action each", async () => {
  const dialog = await openIntegrations();
  expect(within(dialog).getByRole("heading", { name: "GitHub accounts" })).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Connect account" })).toHaveAttribute("href", "/api/integrations/github/connect?returnTo=/work-spend");
  const accounts = within(dialog).getByRole("region", { name: "GitHub accounts" });
  expect(within(accounts).getAllByRole("listitem")).toHaveLength(1);
  expect(within(accounts).getByRole("listitem")).toHaveTextContent("fixture-org");
  expect(within(dialog).getByRole("heading", { name: "GitHub Projects" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Connect project tool" })).toBeInTheDocument();
  expect(within(dialog).getByText("Add issue titles and Project status to work already in your repositories.")).toBeInTheDocument();
  expect(within(dialog).queryByRole("heading", { name: "Authors" })).not.toBeInTheDocument();
});

test("selected GitHub Projects are listed as rows with their sync state", async () => {
  const dialog = await openIntegrations({ ...multipleRepositoriesPayload, projects: { state: "partial", canManage: true, selected: [
    { id: "p1", title: "Roadmap", url: "https://github.com/orgs/fixture-org/projects/1", syncStatus: "available", lastSyncedAt: "2026-09-24T09:00:00.000Z", lastError: null },
    { id: "p2", title: "Bugs", url: "https://github.com/orgs/fixture-org/projects/2", syncStatus: "error", lastSyncedAt: null, lastError: "Project items could not be read." },
  ] } });
  const projects = within(dialog).getByRole("region", { name: "GitHub Projects" });
  expect(within(projects).getByText("Selected Projects add issue titles and status to linked work.")).toBeInTheDocument();
  const [roadmap, bugs] = within(projects).getAllByRole("listitem");
  expect(within(roadmap).getByRole("link", { name: "Roadmap" })).toHaveAttribute("href", "https://github.com/orgs/fixture-org/projects/1");
  expect(roadmap).toHaveTextContent("Synced");
  expect(bugs).toHaveTextContent("Sync failed");
  expect(within(bugs).getByRole("alert")).toHaveTextContent("Project items could not be read.");
});

test("Projects copy explains blocked states instead of listing rows", async () => {
  const dialog = await openIntegrations({ ...multipleRepositoriesPayload, projects: { state: "permission_required", canManage: true, selected: [] } });
  expect(within(dialog).getByText("Read access to Projects needs approval. Repository work keeps syncing.")).toBeInTheDocument();
  expect(within(within(dialog).getByRole("region", { name: "GitHub Projects" })).queryByRole("list")).not.toBeInTheDocument();
});

test("unlinked GitHub installations appear in the accounts list with a Link action", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ installations: [
    { id: "123", login: "fixture-org", accountType: "Organization", linked: true },
    { id: "456", login: "fixture-labs", accountType: "Organization", linked: false },
  ] }), { status: 200 }));
  const dialog = await openIntegrations();
  const accounts = within(dialog).getByRole("region", { name: "GitHub accounts" });
  const link = await within(accounts).findByRole("link", { name: "Link" });
  expect(link).toHaveAttribute("href", "/api/integrations/github/callback?installation_id=456");
  expect(within(accounts).getAllByRole("listitem")).toHaveLength(2);
  expect(within(accounts).getAllByRole("listitem")[1]).toHaveTextContent("fixture-labs");
});

test("an Authors section appears when GitHub authors are unmatched and opens the matching dialog", async () => {
  const dialog = await openIntegrations({ ...multipleRepositoriesPayload, attention: { ...multipleRepositoriesPayload.attention, unmappedAuthors: [{ identityId: "id-1", login: "ghost", commitCount: 4, suggestedDeveloperId: null }] } });
  const authors = within(dialog).getByRole("region", { name: "Authors" });
  expect(authors).toHaveTextContent("1 GitHub author isn’t matched to a team member yet.");
  fireEvent.click(within(authors).getByRole("button", { name: "Match authors" }));
  expect(await screen.findByRole("dialog", { name: "Match GitHub authors" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Integrations" })).not.toBeInTheDocument());
});

test("failed repositories are called out under the accounts list", async () => {
  const dialog = await openIntegrations(partialCoveragePayload);
  expect(within(dialog).getByText("fixture-org/api")).toBeInTheDocument();
  expect(within(dialog).getByText("GitHub request timed out. Last successful data is shown.")).toBeInTheDocument();
});
