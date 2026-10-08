// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import "../setup/component";

vi.mock("@/components/signals/signals-ui", () => ({
  SignalsSectionHeader: ({ title, description }: { title: string; description?: string }) => (
    <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
  ),
  SignalsKpi: ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
    <div><p>{label}</p><div>{value}</div>{sub ? <div>{sub}</div> : null}</div>
  ),
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolBrandIcon: ({ tool }: { tool: string }) => <svg data-testid={`logo-${tool}`} />,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
import { TeamAdoptionView } from "@/components/activity/team-adoption-view";
import { buildTeamAdoption } from "@/lib/queries/activity/adoption";

const device = (lastSeenAt = "2026-10-01") => ({
  createdAt: new Date("2026-06-01T00:00:00Z"),
  lastSeenAt: new Date(`${lastSeenAt}T12:00:00Z`),
  decommissionedAt: null,
});

const data = buildTeamAdoption({
  window: { from: new Date("2026-09-04T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") },
  developers: [
    { id: "ada", name: "Ada", devices: [device()] },
    { id: "cy", name: "Cy", devices: [device()] },
    { id: "dee", name: "Dee", devices: [device("2026-08-01")] },
    { id: "eve", name: "Eve", devices: [] },
  ],
  activity: ["2026-09-05", "2026-09-12", "2026-09-20", "2026-09-30"].map((date) => ({ developerId: "ada", toolName: "Cursor", date }))
    .concat(["2026-08-10", "2026-08-20", "2026-08-25"].map((date) => ({ developerId: "cy", toolName: "Cursor", date }))),
  plans: [{ developerId: "cy", toolName: "Cursor", cycleSeatMicros: 40_000_000n, seatCount: 1 }],
});

test("adoption view leads with regular use and lists nudges without volume", () => {
  render(<TeamAdoptionView data={data} />);
  expect(screen.queryByText(/enrolled people use AI most weeks/)).not.toBeInTheDocument();
  expect(screen.queryByText(/up to today/)).toBeNull();
  expect(screen.getAllByText("$40.00").length).toBeGreaterThan(0);

  for (const name of ["Everyone 3", "Regular 1", "Not using yet 1", "No data 1"]) {
    expect(screen.getByRole("radio", { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole("radio", { name: /Occasional/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Legend" })).getByText("Agent not reporting")).toBeInTheDocument();
  expect(screen.getByText(/Daily activity/)).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: /: used AI$/ }).length).toBe(4);
  fireEvent.click(screen.getByRole("radio", { name: "No data 1" }));
  expect(screen.getAllByText(/Agent not reporting · last seen/).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: "Ada" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Everyone 3" }));
  expect(screen.getByText("Down from regular")).toBeInTheDocument();

  const nudges = screen.getByRole("heading", { name: "Needs a nudge." }).closest("section")!;
  expect(within(nudges).getByText("Stopped using AI · was regular last period")).toBeInTheDocument();
  expect(within(nudges).getByText(/Agent not reporting/)).toBeInTheDocument();
  expect(within(nudges).getByText("No machine enrolled")).toBeInTheDocument();
  expect(within(nudges).getByText("Cursor seat unused")).toBeInTheDocument();
  expect(within(nudges).queryByText("$40.00")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("logo-cursor").length).toBeGreaterThan(0);
  expect(screen.queryByText("cursor")).not.toBeInTheDocument();
  expect(screen.queryByText(/tokens|requests/i)).not.toBeInTheDocument();
});

test("a team with nothing to chase skips the nudge list and the one-option filter", () => {
  const settled = buildTeamAdoption({
    window: { from: new Date("2026-09-04T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") },
    developers: [{ id: "ada", name: "Ada", devices: [device()] }],
    activity: ["2026-09-05", "2026-09-12", "2026-09-20", "2026-09-30"].map((date) => ({ developerId: "ada", toolName: "Cursor", date })),
    plans: [],
  });
  render(<TeamAdoptionView data={settled} />);
  expect(screen.getByText("everyone is set up")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Needs a nudge." })).not.toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Filter by habit" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Spread by tool." })).toBeInTheDocument();
  expect(screen.queryByText("no change")).not.toBeInTheDocument();
});

test("each tool in the spread links to that tool's usage page", () => {
  render(<TeamAdoptionView data={data} />);
  expect(screen.getByRole("link", { name: /^Cursor usage · / })).toHaveAttribute("href", "/tools/cursor");
});
