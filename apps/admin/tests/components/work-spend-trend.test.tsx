// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { personTrend, projectTrend, shortTrend } from "../fixtures/work-spend";
import { WorkSpendTrend } from "@/components/features/work-spend-trend";

const mocks = vi.hoisted(() => ({ useAppQuery: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ useAppQuery: mocks.useAppQuery }));

function mount(data: typeof shortTrend, extras: { canViewPeople?: boolean; repositoryCount?: number } = {}) {
  mocks.useAppQuery.mockReturnValue({ data, isPending: false, error: null });
  const onBy = vi.fn();
  render(<WorkSpendTrend days={90} by={data.by} canViewPeople={extras.canViewPeople ?? true} repositoryCount={extras.repositoryCount ?? 3} allocatedMicros="7000000" onBy={onBy} />);
  return onBy;
}

beforeEach(() => { vi.clearAllMocks(); });

test("falls back to a ranked list when fewer than four weeks are available", () => {
  mount(shortTrend);
  expect(screen.getByText("fixture-org/web")).toBeInTheDocument();
  expect(screen.getByText("$2.20")).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

test("Project view discloses overlapping totals", () => {
  mount(projectTrend);
  expect(screen.getByText(/Work on two projects counts in both/i)).toBeInTheDocument();
  expect(screen.getByText("Guessed from the repo")).toBeInTheDocument();
});

test("People is hidden from non-admins and Repos is hidden for a single repo", () => {
  mount(shortTrend, { canViewPeople: false, repositoryCount: 1 });
  expect(screen.queryByRole("button", { name: "People" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Repos" })).not.toBeInTheDocument();
});

test("group-by tabs switch the trend query", () => {
  const onBy = mount(personTrend);
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  expect(onBy).toHaveBeenCalledWith("project");
});
