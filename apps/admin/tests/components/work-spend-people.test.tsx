// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { multipleRepositoriesPayload, peopleSpend, projectLinkedPayload } from "../fixtures/work-spend";
import { WorkSpendPeoplePanel } from "@/components/features/work-spend-people";

const mocks = vi.hoisted(() => ({ useAppQuery: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ useAppQuery: mocks.useAppQuery, useInvalidateAppData: () => vi.fn() }));

function mount(data = projectLinkedPayload, selectedDeveloperId: string | null = null) {
  mocks.useAppQuery.mockReturnValue({ data: peopleSpend, isPending: false, error: null, refetch: vi.fn() });
  const onSelect = vi.fn();
  const onAuthors = vi.fn();
  render(
    <WorkSpendPeoplePanel
      data={data}
      selectedDeveloperId={selectedDeveloperId}
      onSelect={onSelect}
      onAuthors={onAuthors}
    />,
  );
  return { onSelect, onAuthors };
}

beforeEach(() => { vi.clearAllMocks(); });

test("people sit on a dollar plot and are clickable", () => {
  const { onSelect } = mount();
  expect(screen.getByRole("heading", { name: "Spend by person." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Ada Fixture · \$1\.80/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Ben Fixture · \$1\.60/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Ada Fixture · \$1\.80/ }));
  expect(onSelect).toHaveBeenCalledWith("dev-a");
});

test("clicking the selected person clears the filter", () => {
  const { onSelect } = mount(projectLinkedPayload, "dev-a");
  fireEvent.click(screen.getByRole("button", { name: /Ada Fixture · \$1\.80/ }));
  expect(onSelect).toHaveBeenCalledWith(null);
});

test("unmatched authors get a match action when nobody has spend yet", () => {
  mocks.useAppQuery.mockReturnValue({ data: { people: [] }, isPending: false, error: null, refetch: vi.fn() });
  const onAuthors = vi.fn();
  render(
    <WorkSpendPeoplePanel
      data={{
        ...multipleRepositoriesPayload,
        attention: {
          ...multipleRepositoriesPayload.attention,
          unmappedAuthors: [{ identityId: "id-1", login: "ghost", commitCount: 4, suggestedDeveloperId: null }],
        },
      }}
      selectedDeveloperId={null}
      onSelect={vi.fn()}
      onAuthors={onAuthors}
    />,
  );
  expect(screen.getByText("Match GitHub authors to see spend by person.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Match authors \(1\)/ }));
  expect(onAuthors).toHaveBeenCalled();
});
