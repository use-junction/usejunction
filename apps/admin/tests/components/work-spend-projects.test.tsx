// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { multipleRepositoriesPayload, projectDistribution, projectLinkedPayload } from "../fixtures/work-spend";
import { WorkSpendProjects } from "@/components/features/work-spend-projects";

const mocks = vi.hoisted(() => ({ useAppQuery: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ useAppQuery: mocks.useAppQuery, useInvalidateAppData: () => vi.fn() }));
vi.mock("@/components/features/project-tool-connect-dialog", () => ({
  ProjectToolConnectDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function mount(data = projectLinkedPayload, selected: { projectId?: string | null; workState?: "shipped" | "in_flight" | "stalled" | null } = {}) {
  mocks.useAppQuery.mockReturnValue({ data: projectDistribution, isPending: false, error: null, refetch: vi.fn() });
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  render(
    <WorkSpendProjects
      data={data}
      selectedProjectId={selected.projectId ?? null}
      selectedWorkState={selected.workState ?? null}
      onSelect={onSelect}
      onOpen={onOpen}
    />,
  );
  return { onSelect, onOpen };
}

beforeEach(() => { vi.clearAllMocks(); });

test("connected boards render a spend ledger and a not-on-a-project row", () => {
  mount();
  expect(screen.getByRole("heading", { name: "Spend by project." })).toBeInTheDocument();
  expect(screen.getByText("Product roadmap")).toBeInTheDocument();
  expect(screen.getByText("Launch readiness")).toBeInTheDocument();
  expect(screen.getByText("Not on a project")).toBeInTheDocument();
  expect(screen.getByText(/Work on two projects counts in both/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Product roadmap · Merged · \$2\.50/ })).toBeInTheDocument();
});

test("clicking a merged segment filters biggest items to that board and state", () => {
  const { onSelect } = mount();
  fireEvent.click(screen.getByRole("button", { name: /Product roadmap · Merged · \$2\.50/ }));
  expect(onSelect).toHaveBeenCalledWith("project-roadmap", "shipped");
});

test("clicking a project title opens the project view", () => {
  const { onOpen, onSelect } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Product roadmap" }));
  expect(onOpen).toHaveBeenCalledWith("project-roadmap");
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Not on a project" })).not.toBeInTheDocument();
});

test("an unconnected workspace shows the connect empty state instead of bars", () => {
  mocks.useAppQuery.mockReturnValue({ data: undefined, isPending: false, error: null, refetch: vi.fn() });
  render(
    <WorkSpendProjects
      data={multipleRepositoriesPayload}
      selectedProjectId={null}
      selectedWorkState={null}
      onSelect={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText(/Connect GitHub Projects to see where spend landed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect GitHub Projects" })).toBeInTheDocument();
  expect(screen.queryByText("Product roadmap")).not.toBeInTheDocument();
});
