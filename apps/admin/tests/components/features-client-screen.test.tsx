// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";

const mocks = vi.hoisted(() => ({
  useAppPageQuery: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  replace: vi.fn(),
  fetch: vi.fn(),
  toast: {
    loading: vi.fn(() => "github-sync"),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/features",
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/lib/api/client", () => ({
  useAppPageQuery: mocks.useAppPageQuery,
  useInvalidateAppData: () => mocks.invalidate,
  browserMutationInit: (method: string, body?: unknown) => ({
    method,
    body: JSON.stringify(body ?? {}),
  }),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/components/features/github-install-review", () => ({
  GithubInstallReview: ({ canManage }: { canManage: boolean }) => (
    <div>{canManage ? "Connect GitHub to explore features" : "Ask a workspace admin to connect GitHub"}</div>
  ),
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolBrandIcon: () => null,
  hasToolBrandIcon: () => false,
}));

vi.mock("@/components/app-data-state", () => ({
  AppPageError: () => <div>Could not load features</div>,
  AppPageSkeleton: () => <div>Loading features</div>,
  isBlockingAppQueryError: (error: unknown, hasData: boolean) => Boolean(error) && !hasData,
  useAppQueryErrorToast: vi.fn(),
}));

function payload(canMapIdentities = true) {
  return {
    days: 90,
    window: { from: "2026-06-27", to: "2026-09-24" },
    canMapIdentities,
    connection: {
      id: "github-connection",
      state: "ready",
      githubOrg: "acme",
      accountType: "Organization",
      installationId: "42",
      needsMembers: false,
      approveUrl: "https://github.com/organizations/acme/settings/installations/42",
      appPermissionsUrl: null,
      lastSyncedAt: "2026-09-24T09:00:00.000Z",
      lastError: null,
      connections: [],
    },
    connections: [{
      id: "github-connection",
      state: "ready",
      githubOrg: "acme",
      accountType: "Organization",
      installationId: "42",
      needsMembers: false,
      approveUrl: "https://github.com/organizations/acme/settings/installations/42",
      appPermissionsUrl: null,
      lastSyncedAt: "2026-09-24T09:00:00.000Z",
      lastError: null,
    }],
    kpis: {
      mappedPct: 50,
      verifiedMicros: "2000000",
      estimatedMicros: "4000000",
      unattributedMicros: "3000000",
      medianCostPerCommit: "1000000",
    },
    features: [],
    unlinkedCommits: [],
    emptyReason: "no_ticket_keys",
    lastUsageAt: "2026-09-24T00:00:00.000Z",
    lastUsageSyncAt: "2026-09-24T09:00:00.000Z",
    unmappedAuthors: [],
    developers: [],
    limits: ["Costs are allocated per UTC day."],
  };
}

async function renderFeatures(canMapIdentities = true, overrides: Partial<ReturnType<typeof payload>> = {}) {
  mocks.useAppPageQuery.mockReturnValue({
    data: { ...payload(canMapIdentities), ...overrides },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
  const { default: FeaturesClientScreen } = await import("@/components/features/features-client-screen");
  return render(<FeaturesClientScreen />);
}

async function openDisconnect() {
  fireEvent.click(screen.getByRole("button", { name: "GitHub connection" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Disconnect acme…$/ }));
  return screen.findByRole("dialog", { name: "Disconnect acme?" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});

test("opening and cancelling disconnect never changes the connection", async () => {
  await renderFeatures();
  expect(mocks.fetch).not.toHaveBeenCalled();
  const dialog = await openDisconnect();
  expect(mocks.fetch.mock.calls.every(([url]) => String(url).includes("/installations"))).toBe(true);
  expect(dialog).toHaveTextContent(/commit|feature/i);
  fireEvent.click(within(dialog).getByRole("button", { name: /cancel|keep connected/i }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Disconnect acme?" })).not.toBeInTheDocument());
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/disconnect"))).toBe(false);
});

test("disconnect requires confirmation and refreshes the page after success", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  await renderFeatures();
  const dialog = await openDisconnect();
  fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect acme" }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
    "/api/integrations/github-connection/disconnect",
    expect.objectContaining({ method: "POST" }),
  ));
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
  expect(mocks.toast.success).toHaveBeenCalled();
});

test("a failed disconnect keeps the confirmation open with a retryable error", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "Unable to disconnect" }), { status: 502 }));
  await renderFeatures();
  const dialog = await openDisconnect();
  fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect acme" }));
  await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
  expect(screen.getByRole("dialog", { name: "Disconnect acme?" })).toBeInTheDocument();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(/disconnect|try again/i);
  expect(within(dialog).getByRole("button", { name: "Disconnect acme" })).toBeEnabled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  expect(mocks.toast.success).not.toHaveBeenCalled();
});

test("a manager can sync but cannot disconnect GitHub", async () => {
  await renderFeatures(false);
  expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "GitHub connection" }));
  expect(screen.queryByRole("button", { name: /disconnect github/i })).not.toBeInTheDocument();
});

test("disconnected managers receive administrator guidance without installation requests", async () => {
  await renderFeatures(false, { connection: { ...payload().connection, state: "none" } });
  expect(screen.getByText("Ask a workspace admin to connect GitHub")).toBeInTheDocument();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /sync now/i })).not.toBeInTheDocument();
});

test("a failed sync reports an error and allows retry without a success notification", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
    error: { code: "SYNC_FAILED", message: "GitHub sync failed." },
  }), { status: 502 }));
  await renderFeatures();
  fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
  await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(/sync|github/i);
  expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled();
});

test("a network failure is caught and shown to the user", async () => {
  mocks.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await renderFeatures();
  fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
  await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled();
});

test("an in-flight sync prevents duplicate requests", async () => {
  mocks.fetch.mockImplementation(() => new Promise<Response>(() => undefined));
  await renderFeatures();
  const button = screen.getByRole("button", { name: /sync now/i });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(screen.getByRole("button", { name: /syncing/i })).toBeDisabled();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.toast.loading).toHaveBeenCalledTimes(1);
});

test.each([
  { githubError: "GitHub temporarily unavailable" },
  { githubSkipped: true, githubReason: "permission_required" },
  { githubSkipped: true, githubReason: "no_repositories" },
])("a partial HTTP 200 sync reports the incomplete result (%j)", async (counts) => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { ok: true, counts } }), { status: 200 }));
  await renderFeatures();
  fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
  await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalled());
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(mocks.invalidate).toHaveBeenCalled();
});

test("a complete sync reports actual repository and commit counts", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
    data: { ok: true, counts: { githubRepos: 2, githubCommits: 12, githubPullRequests: 3, githubSkipped: false } },
  }), { status: 200 }));
  await renderFeatures();
  fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
  await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  expect(screen.getByRole("status")).toHaveTextContent(/12/);
  expect(screen.getByRole("status")).toHaveTextContent(/2/);
  expect(mocks.toast.error).not.toHaveBeenCalled();
});
