// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), picker: {
  state: "available", available: [{ id: "PVT_1", number: 1, title: "Roadmap", url: "https://github.com/orgs/acme/projects/1" }],
  selected: [] as Array<{ id: string; externalId: string; title: string; syncStatus: string; lastError: string | null }>, canManage: true,
} }));
vi.mock("@/lib/api/client", () => ({
  useAppQuery: () => ({ data: mocks.picker, isPending: false, error: null, refetch: mocks.refetch }),
  useInvalidateAppData: () => mocks.invalidate,
  browserMutationInit: (method: string, body: unknown) => ({ method, body: JSON.stringify(body) }),
}));
vi.mock("sonner", () => ({ toast: { loading: vi.fn(() => "toast"), success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.picker.state = "available";
  mocks.picker.selected = [];
  mocks.refetch.mockResolvedValue({});
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { selected: 1, sync: { failed: 0 } } }), { status: 200 }));
  vi.stubGlobal("fetch", mocks.fetch);
});

test("opening the picker and changing a checkbox do not mutate until Save selection", async () => {
  const { ProjectToolConnectDialog } = await import("@/components/features/project-tool-connect-dialog");
  render(<ProjectToolConnectDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Connect GitHub Projects" }));
  const dialog = await screen.findByRole("dialog", { name: "GitHub Projects" });
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Roadmap/ }));
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save selection" }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/app/project-tools/github-projects", expect.objectContaining({ method: "PUT", body: JSON.stringify({ projectIds: ["PVT_1"] }) })));
});

test("disconnect is only sent after the confirmation action", async () => {
  mocks.picker.selected = [{ id: "local-1", externalId: "PVT_1", title: "Roadmap", syncStatus: "available", lastError: null }];
  const { ProjectToolConnectDialog } = await import("@/components/features/project-tool-connect-dialog");
  render(<ProjectToolConnectDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Connect GitHub Projects" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "GitHub Projects" })).getByRole("button", { name: "Disconnect…" }));
  const confirm = await screen.findByRole("dialog", { name: "Disconnect GitHub Projects?" });
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(within(await screen.findByRole("dialog", { name: "GitHub Projects" })).getByRole("button", { name: "Disconnect…" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Disconnect GitHub Projects?" })).getByRole("button", { name: "Disconnect GitHub Projects" }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/app/project-tools/github-projects/disconnect", expect.objectContaining({ method: "POST" })));
});

test("missing Project permission explains App configuration and installation approval", async () => {
  mocks.picker.state = "permission_required";
  const { ProjectToolConnectDialog } = await import("@/components/features/project-tool-connect-dialog");
  render(<ProjectToolConnectDialog appPermissionsUrl="https://github.com/settings/apps/example/permissions" approveUrl="https://github.com/organizations/acme/settings/installations/123" />);
  fireEvent.click(screen.getByRole("button", { name: "Connect GitHub Projects" }));
  const dialog = await screen.findByRole("dialog", { name: "GitHub Projects" });
  expect(within(dialog).getByText(/organization Projects: read/)).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: /Configure App permissions/ })).toHaveAttribute("href", "https://github.com/settings/apps/example/permissions");
  expect(within(dialog).getByRole("link", { name: /Approve installation/ })).toHaveAttribute("href", "https://github.com/organizations/acme/settings/installations/123");
  expect(mocks.fetch).not.toHaveBeenCalled();
});
