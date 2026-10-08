// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import "../setup/component";

vi.mock("@/components/signals/signals-ui", () => ({
  SignalsSectionHeader: ({ title, description }: { title: string; description?: string }) => (
    <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
  ),
}));
vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolBrandIcon: ({ tool }: { tool: string }) => <span data-tool={tool} aria-hidden />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { CostOverviewView } from "@/components/tools/cost-overview-view";
import { buildCostOverview } from "@/lib/queries/tools/cost-overview";

const plan = (toolKey: string, micros: number, over: Record<string, unknown> = {}) => ({
  id: toolKey,
  toolKey,
  toolName: toolKey,
  name: "Pro",
  billingCadence: "monthly",
  billingCycleDays: null,
  billingCycleAnchorDate: new Date("2026-09-10T00:00:00Z"),
  createdAt: new Date("2026-07-01T00:00:00Z"),
  seatCapacity: 1,
  assignedSeats: 1,
  cycleSeatMicros: BigInt(micros),
  includedCycleMicros: 0n,
  customPrice: false,
  priceSource: "provider_catalog",
  ...over,
});

const data = buildCostOverview({
  now: new Date("2026-10-03T12:00:00Z"),
  plans: [
    plan("claude", 25_000_000),
    plan("antigravity", 19_990_000),
    plan("chatgpt-codex", 20_000_000),
    plan("cursor", 20_000_000, { includedCycleMicros: 20_000_000n }),
    plan("github-copilot", 0),
  ],
  usage: [{ toolName: "cursor", verifiedMicros: 139_000_000n, estimatedMicros: 0n, actualMicros: 0n }],
  previousUsage: [],
  activePeople: [{ toolName: "cursor", developerId: "a" }, { toolName: "codex", developerId: "a" }],
  quotaPeaks: [{ toolName: "codex", developerId: "a", peak: 100 }],
  idleSeats: [
    { toolName: "claude", count: 1, cycleMicros: "25000000" },
    { toolName: "antigravity", count: 1, cycleMicros: "19990000" },
  ],
});

test("cost hero leads with the seat bill and leaves the unused saving to the action list", () => {
  render(<CostOverviewView data={data} />);
  expect(screen.getByText("$84.99")).toBeInTheDocument();
  expect(screen.getByText(/on 4 paid plans/)).toBeInTheDocument();
  expect(screen.getAllByText("$44.99")).toHaveLength(1);
  expect(screen.queryByText(/of it went to/)).not.toBeInTheDocument();
  expect(screen.queryByText(/53%/)).not.toBeInTheDocument();
  expect(screen.queryByText(/pay-as-you-go/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Also on free plans/)).not.toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: /Claude \$25\.00 · No use in 30 days/ })).toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: /Cursor \$20\.00 · Past its allowance/ })).toBeInTheDocument();
});

test("actions are ordered by saving, with limits and allowance after", () => {
  render(<CostOverviewView data={data} />);
  const titles = screen.getAllByText(/^(Cancel or reassign|.* is past its included allowance|.* is hitting its limit)/).map((node) => node.textContent);
  expect(titles[0]).toBe("Cancel or reassign Claude and Antigravity");
  expect(titles).toContain("Cursor is past its included allowance");
  expect(titles.some((title) => /is hitting its limit/.test(title ?? ""))).toBe(true);
  expect(screen.getByText(/^Save/)).toHaveTextContent("Save $44.99/mo");
});

test("the tool table gives each tool one plain status and links to its page", () => {
  render(<CostOverviewView data={data} />);
  const row = (tool: string) => screen.getByRole("link", { name: new RegExp(`^${tool}$`) }).closest("tr")!;
  expect(row("Cursor")).toHaveTextContent("Past its allowance");
  expect(row("Cursor")).toHaveTextContent("~$139 at API prices");
  expect(row("Cursor")).toHaveTextContent("7× over");
  expect(row("Claude")).toHaveTextContent("No use in 30 days");
  expect(row("Claude")).toHaveTextContent("$25.00/mo · list price");
  expect(screen.getByRole("link", { name: /^Cursor$/ })).toHaveAttribute("href", "/tools/cursor");
  expect(screen.queryByText(/under 10%/)).not.toBeInTheDocument();
});
