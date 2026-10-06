// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import "../setup/component";
import { projectInspection, workDetails } from "../fixtures/work-spend";
import { WorkSpendProjectView } from "@/components/features/work-spend-project";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { WorkSpendProjectInspection } from "@/components/features/work-spend-types";

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

function mount(data: WorkSpendProjectInspection | Promise<WorkSpendProjectInspection> | Error = projectInspection) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.appFetch.mockImplementation((url: string) => {
    if (String(url).includes("/details")) return Promise.resolve(workDetails);
    if (data instanceof Error) return Promise.reject(data);
    return Promise.resolve(data);
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorkSpendProjectView projectId="project-roadmap" days={90} allocationCurrent />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("project view leads with spend, outcome, tasks, then evidence", async () => {
  mount();
  expect(await screen.findByRole("heading", { name: "Product roadmap" })).toBeInTheDocument();
  expect(screen.getByText("AI spend · last 90 days")).toBeInTheDocument();
  expect(screen.getAllByText("$4.00").length).toBeGreaterThan(0);
  expect(screen.getByText(/measured from tool usage/)).toBeInTheDocument();
  expect(screen.getByText(/modelled/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "What it produced" })).toBeInTheDocument();
  expect(screen.getByText("Merged PRs")).toBeInTheDocument();
  expect(screen.getByText("$2.50")).toBeInTheDocument();
  expect(screen.getByText("Direct commits")).toBeInTheDocument();
  expect(screen.queryByText("Closed without merging")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  expect(screen.getByText(/\$4\.00 on 1 task · 1 with no spend/)).toBeInTheDocument();
  expect(screen.getByText("Linked by issue")).toBeInTheDocument();
  expect(screen.queryByText(/mostly an estimate/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add team invitations, $4.00" })).toBeInTheDocument();
  expect(screen.queryByText("Unmatched board issue")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /\+1 more task/ }));
  expect(screen.getByText("Unmatched board issue")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Pull requests and commits/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Invitation flow, $4.00" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "All 2" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Merged 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("How spend is placed on tasks"));
  expect(screen.getByText(/Commits that name no issue are spread across 2 WI tasks in date order/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "How we split this" })).toBeInTheDocument();
});

test("guessed task spend is rounded, labelled, and flagged when evidence is thin", async () => {
  const task = projectInspection.tasks[0]!;
  mount({
    ...projectInspection,
    methodMicros: { named: "0", wiOrder: "4000000", untasked: "0" },
    tasks: [{ ...task, title: "WI-04: Community Edition split", verifiedMicros: "91710000", estimatedMicros: "0", method: "wi_order", matches: [{ ...task.matches[0]!, commitCount: 1 }] }],
  });
  expect(await screen.findByText("~$92")).toBeInTheDocument();
  expect(screen.getByText("Estimated by date")).toBeInTheDocument();
  expect(screen.getByText("Thin evidence")).toBeInTheDocument();
  expect(screen.getByText(/The task split below is mostly an estimate/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "WI-04: Community Edition split, $91.71" })).toBeInTheDocument();
  expect(screen.getByText(/placed on tasks by date, not by an issue link/)).toBeInTheDocument();
});

test("closed unmerged pull requests are listed apart", async () => {
  const pr = projectInspection.pullRequests[0]!;
  mount({
    ...projectInspection,
    outcomeMicros: { ...projectInspection.outcomeMicros, closedPr: "1000000" },
    pullRequests: [{ ...pr, title: "Abandoned spike", state: "CLOSED", workState: "stalled", verifiedMicros: "1000000", estimatedMicros: "0" }],
  });
  expect(await screen.findByRole("heading", { name: "Closed without merging" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Abandoned spike, $1.00" }).length).toBeGreaterThan(0);
});

test("filtering pull requests and commits hides other outcomes", async () => {
  mount();
  expect(await screen.findByRole("button", { name: "Invitation flow, $4.00" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Merged 1" }));
  expect(screen.getByRole("button", { name: "Invitation flow, $4.00" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Commit a1b2c3d, $0.50" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Open 1" }));
  expect(screen.getByRole("button", { name: "Commit a1b2c3d, $0.50" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Invitation flow, $4.00" })).not.toBeInTheDocument();
});

test("a task opens the why sheet with the attribution reason, then the work sheet", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Add team invitations, $4.00" }));
  const why = await screen.findByRole("dialog", { name: "Add team invitations" });
  expect(within(why).getByRole("heading", { name: "Why $4.00" })).toBeInTheDocument();
  expect(within(why).getByText("pull request says #123")).toBeInTheDocument();
  fireEvent.click(within(why).getByRole("button", { name: "Add team invitations, $4.00" }));
  expect(await screen.findByText("How this cost was allocated")).toBeInTheDocument();
});

test("how we split this is hidden without canManage", async () => {
  mount({ ...projectInspection, canManage: false });
  expect(await screen.findByRole("heading", { name: "Product roadmap" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "How we split this" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("How spend is placed on tasks"));
  expect(screen.getByText(/Commits that name no issue are spread across 2 WI tasks in date order\.$/)).toBeInTheDocument();
});

test("a missing project shows a retryable error", async () => {
  const error = Object.assign(new Error("not found"), { status: 404 });
  mount(error);
  expect(await screen.findByRole("alert")).toHaveTextContent("This project is not in the current GitHub connection.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
