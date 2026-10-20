// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AiCodingPanel } from "@/components/dashboard/ai-coding-panel";
import { RosterPlanUsage } from "@/components/developers/roster-plan-usage";
import { SignalsFilters } from "@/components/signals/signals-filters";
import { FlowPath, changeLabel, durationLabel } from "@/components/signals/signals-ui";
import { ToolProviderDetail } from "@/components/tools/tool-provider-detail";
import type { AiCodingMetrics, ModelUsageRow } from "@/lib/queries/me/overview";
import "../setup/component";

const router = { push: vi.fn() };

function renderWithQueryClient(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/signals/activity",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolLogoTile: ({ tool }: { tool: string }) => <span aria-label={`${tool} logo`} />,
  hasToolBrandIcon: () => true,
  ToolBrandIcon: ({ tool }: { tool: string }) => <span aria-label={`${tool} icon`} />,
}));

const baseMetrics: AiCodingMetrics = {
  suggestedLines: 100,
  acceptedLines: 25,
  addedLines: 30,
  deletedLines: 5,
  commits: 4,
  aiPercent: null,
  inputTokens: 1_000,
  outputTokens: 500,
  cacheReadTokens: 250,
  cacheWriteTokens: 50,
  reasoningTokens: 0,
  cost: 4.25,
  verifiedCost: 1.25,
};

function usageRow(index: number): ModelUsageRow {
  return {
    toolName: "cursor",
    model: `model-${index}`,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    reasoningTokens: 0,
    cost: 0.1,
    requests: index + 1,
    suggestedLines: 0,
    acceptedLines: 0,
    source: "gateway_observed",
    verified: false,
    costKind: "estimated_api",
    metricKind: "usage",
  };
}

describe("calculation-bearing components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("AiCodingPanel calculates acceptance, filters productivity, and paginates", async () => {
    const rows = Array.from({ length: 26 }, (_, index) => usageRow(index));
    rows.push({ ...usageRow(99), model: "productivity-row", metricKind: "productivity" });

    render(<AiCodingPanel metrics={baseMetrics} models={rows} />);

    expect(screen.getByText(/100 suggested · 25% accept/)).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument();
    expect(screen.getByText("All 26 models used in this period")).toBeInTheDocument();
    expect(screen.queryByText("Productivity attribution")).not.toBeInTheDocument();
    expect(screen.queryByText("productivity-row")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1–25 of 26")).toBeInTheDocument();
    expect(screen.getAllByText("model-25").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("model-0")).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Next" })[0]!);
    expect(screen.getByText("Showing 26–26 of 26")).toBeInTheDocument();
    expect(screen.getAllByText("model-0").length).toBeGreaterThanOrEqual(1);

    const search = screen.getAllByPlaceholderText("Search models…")[0]!;
    await userEvent.type(search, "model-25");
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument();
  });

  test("AiCodingPanel embedded personal variant hides spend and leads with accept rate", () => {
    render(<AiCodingPanel metrics={baseMetrics} models={[usageRow(0)]} embedded />);

    expect(screen.getByText("Accept rate")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/25 accepted · 100 suggested/)).toBeInTheDocument();
    expect(screen.getByText("Lines changed")).toBeInTheDocument();
    expect(screen.getByText(/30 added · 5 deleted/)).toBeInTheDocument();
    expect(screen.queryByText("Verified usage")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated API value")).not.toBeInTheDocument();
  });

  test("AiCodingPanel handles zero suggested lines and zero token breakdown", () => {
    render(
      <AiCodingPanel
        metrics={{ ...baseMetrics, suggestedLines: 0, acceptedLines: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }}
        models={[]}
      />,
    );

    expect(screen.queryByText(/accept$/)).not.toBeInTheDocument();
    expect(screen.getByText("No token breakdown yet.")).toBeInTheDocument();
    expect(screen.getByText("Models appear once usage reports")).toBeInTheDocument();
  });

  test("RosterPlanUsage averages signaled plans, clamps the visual meter, and chooses the worst verdict", () => {
    render(
      <RosterPlanUsage
        plans={[
          { toolName: "cursor", toolKey: "cursor", planName: "Pro", primaryRatio: 0.5, verdict: { code: "HEALTHY", severity: "info", reasons: [], policyVersion: "plan-utilization-v1" } },
          { toolName: "claude", toolKey: "claude", planName: "Max", primaryRatio: 1.2, verdict: { code: "LIMIT_EXCEEDED", severity: "critical", reasons: [], policyVersion: "plan-utilization-v1" } },
        ]}
      />,
    );

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "85");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-label", "Average plan use 85 percent, Over quota");
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText(/avg across 2 plans · Over quota/)).toBeInTheDocument();
  });

  test("RosterPlanUsage calls a paid seat at 0% unused instead of within allowance", () => {
    render(
      <RosterPlanUsage
        plans={[{ toolName: "cursor", toolKey: "cursor", planName: "Pro", primaryRatio: 0, verdict: { code: "LIGHT_USE", severity: "info", reasons: [], policyVersion: "plan-utilization-v1" } }]}
      />,
    );

    expect(screen.getByRole("meter")).toHaveAttribute("aria-label", "Average plan use 0 percent, No use yet");
    expect(screen.getByText("No use yet")).toBeInTheDocument();
    expect(screen.queryByText(/Within allowance/)).not.toBeInTheDocument();
  });

  test("RosterPlanUsage reports no signal without inventing a percentage", () => {
    render(
      <RosterPlanUsage
        plans={[{ toolName: "cursor", toolKey: "cursor", planName: "Pro", primaryRatio: null, verdict: { code: "UNKNOWN", severity: "info", reasons: [], policyVersion: "plan-utilization-v1" } }]}
      />,
    );

    expect(screen.getByRole("meter")).toHaveAttribute("aria-label", "Plan use waiting for quota signal");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  test("SignalsFilters debounces URL updates and removes hidden filters", async () => {
    vi.useFakeTimers();
    try {
      render(
        <SignalsFilters
          value={{ tool: "cursor", developerId: "dev-1" }}
          tools={["cursor", "claude"]}
          developers={[{ id: "dev-1", name: "Alice" }]}
          showPerson
        />,
      );

      expect(screen.queryByLabelText("Team")).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("AI tool"), { target: { value: "claude" } });
      expect(router.push).not.toHaveBeenCalled();
      vi.advanceTimersByTime(399);
      expect(router.push).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(router.push).toHaveBeenCalledWith("/signals/activity?tool=claude&developerId=dev-1");

      fireEvent.change(screen.getByLabelText("Person"), { target: { value: "" } });
      vi.advanceTimersByTime(400);
      expect(router.push).toHaveBeenLastCalledWith("/signals/activity?tool=claude");
    } finally {
      vi.useRealTimers();
    }
  });

  test("Signals formatters and FlowPath preserve edge-case semantics", () => {
    expect(durationLabel(45)).toBe("45s");
    expect(durationLabel(90)).toBe("2m");
    expect(durationLabel(3600)).toBe("1h");
    expect(changeLabel(null)).toBe("—");
    expect(changeLabel(0)).toBe("0%");
    expect(changeLabel(12)).toBe("+12%");
    expect(changeLabel(-8)).toBe("-8%");

    render(<FlowPath flow="github -> cursor -> slack" />);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getAllByText("→")).toHaveLength(2);
  });

  test("ToolProviderDetail labels usage cost separately from subscription seats", () => {
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "cursor",
          name: "Cursor",
          shortName: "Cursor",
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          aliases: [],
          sourceUrl: "https://example.com",
          accounts: [],
          kpis: { devices: 0, people: 1, peopleInstallOnly: 0, seatsFree: 1, seatsPurchased: 2, seatsAssigned: 1, usageCost: 6, requests: 10, tokens: 1_500_000 },
          people: [],
          quotas: [],
          plans: [],
          modelsByDeveloper: [],
        }}
      />,
    );

    expect(screen.getByText("Usage at API prices")).toBeInTheDocument();
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByText(/not a bill/)).toBeInTheDocument();
    expect(screen.getByText("You pay")).toBeInTheDocument();
    expect(screen.getByLabelText("Subscription view")).toBeInTheDocument();
  });

  test("ToolProviderDetail makes plans and live quota pressure scannable", () => {
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "chatgpt-codex",
          name: "ChatGPT / Codex",
          shortName: "Codex",
          provider: "openai",
          product: "codex",
          toolName: "codex",
          aliases: [],
          sourceUrl: "https://example.com",
          accounts: [],
          kpis: { devices: 1, people: 1, peopleInstallOnly: 0, seatsFree: 0, seatsPurchased: 1, seatsAssigned: 1, usageCost: 0, requests: 0, tokens: 0 },
          people: [
            {
              developerId: "dev-1",
              name: "Ada Lovelace",
              email: "ada@example.com",
              detected: true,
              coverage: "covered",
              deviceHostname: "ada-mac",
              vendorPlan: "Plus",
              vendorEmail: "ada@example.com",
              mappedCatalogPlanKey: "plus",
              assignment: {
                id: "assignment-1",
                planTemplateId: "plan-1",
                planName: "Plus",
                catalogPlanKey: "plus",
                source: "detected",
              },
              planMismatch: false,
            },
          ],
          quotas: [
            {
              toolName: "codex",
              windowType: "weekly",
              usedPercent: 92,
              creditsRemaining: null,
              resetAt: new Date("2026-07-23T07:10:20Z"),
              deviceHostname: "ada-mac",
              developerId: "dev-1",
              developerName: "Ada Lovelace",
            },
          ],
          plans: [],
          modelsByDeveloper: [],
        }}
      />,
    );

    expect(screen.queryByText("Tools used.")).not.toBeInTheDocument();
    expect(screen.getByText("Plus")).toBeInTheDocument();
    expect(screen.getByText(/Detected plan/)).toBeInTheDocument();
    expect(screen.getByText("Near limit")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Weekly usage" })).toHaveAttribute("aria-valuenow", "92");
  });

  test("ToolProviderDetail lists a person once, leading with their busiest login", async () => {
    const login = (accountKey: string, email: string | null, planName: string, planKey: string) => ({
      developerId: "dev-1",
      accountKey,
      email,
      plan: planKey,
      mappedCatalogPlanKey: planKey,
      mappedCatalogPlanName: planName,
      planInferredFromOrg: false,
      deviceHostname: "ada-mac",
    });
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "claude",
          name: "Claude",
          shortName: "Claude",
          provider: "anthropic",
          product: "claude",
          toolName: "claude",
          aliases: [],
          sourceUrl: "https://example.com",
          accounts: [
            login("personal@example.com", "personal@example.com", "Pro", "pro"),
            login("claude:stale-uuid", null, "Pro", "pro"),
            login("work@example.com", "work@example.com", "Team Standard", "team-standard"),
          ],
          kpis: { devices: 1, people: 1, peopleInstallOnly: 0, seatsFree: 0, seatsPurchased: 0, seatsAssigned: 0, usageCost: 0, requests: 0, tokens: 0 },
          people: [
            {
              developerId: "dev-1",
              name: "Ada Lovelace",
              email: "ada@example.com",
              detected: true,
              coverage: "covered",
              deviceHostname: "ada-mac",
              vendorPlan: "pro",
              vendorEmail: "personal@example.com",
              mappedCatalogPlanKey: "pro",
              assignment: null,
              planMismatch: false,
            },
          ],
          quotas: [
            {
              toolName: "claude",
              windowType: "session_5h",
              usedPercent: 40,
              creditsRemaining: null,
              resetAt: null,
              deviceHostname: "ada-mac",
              developerId: "dev-1",
              developerName: "Ada Lovelace",
              accountKey: "work@example.com",
            },
          ],
          plans: [],
          modelsByDeveloper: [],
        }}
      />,
    );

    // One person row, led by the login that reports live limits.
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
    expect(screen.getByText("work@example.com")).toBeInTheDocument();
    expect(screen.queryByText("personal@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 1 reporting")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Show 2 other logins/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Hide 2 other logins/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("personal@example.com")).toBeInTheDocument();
    // The named login comes before the nameless stale one.
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const personal = rows.findIndex((text) => text.includes("personal@example.com"));
    const work = rows.findIndex((text) => text.includes("work@example.com"));
    expect(work).toBeLessThan(personal);
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
  });

  test("ToolProviderDetail leads with the most-used login and never flags extra detected plans", async () => {
    const login = (accountKey: string, planName: string, planKey: string, requests: number) => ({
      developerId: "dev-1",
      accountKey,
      email: accountKey,
      plan: planKey,
      mappedCatalogPlanKey: planKey,
      mappedCatalogPlanName: planName,
      planInferredFromOrg: false,
      deviceHostname: "ada-mac",
      requests,
      cost: requests / 10,
    });
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "claude",
          name: "Claude",
          shortName: "Claude",
          provider: "anthropic",
          product: "claude",
          toolName: "claude",
          aliases: [],
          sourceUrl: "https://example.com",
          accounts: [
            login("work@example.com", "Team Standard", "team-standard", 12),
            login("personal@example.com", "Max 5x", "max-5x", 300),
          ],
          kpis: { devices: 1, people: 1, peopleInstallOnly: 0, seatsFree: 0, seatsPurchased: 2, seatsAssigned: 2, usageCost: 0, requests: 0, tokens: 0 },
          people: [
            {
              developerId: "dev-1",
              name: "Ada Lovelace",
              email: "ada@example.com",
              detected: true,
              coverage: "covered",
              deviceHostname: "ada-mac",
              vendorPlan: "max-5x",
              vendorEmail: "personal@example.com",
              mappedCatalogPlanKey: "max-5x",
              assignment: { id: "a-1", planTemplateId: "t-1", planName: "Team Standard", catalogPlanKey: "team-standard", source: "detected" },
              planMismatch: false,
            },
          ],
          quotas: [
            {
              toolName: "claude",
              windowType: "session_5h",
              usedPercent: 70,
              creditsRemaining: null,
              resetAt: null,
              deviceHostname: "ada-mac",
              developerId: "dev-1",
              developerName: "Ada Lovelace",
              accountKey: "work@example.com",
            },
          ],
          plans: [],
          modelsByDeveloper: [],
        }}
      />,
    );

    // The login used most this period leads, even though the other is closer to a limit.
    expect(screen.getByText("personal@example.com")).toBeInTheDocument();
    expect(screen.queryByText("work@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use detected plan" })).not.toBeInTheDocument();
    expect(screen.queryByText(/none of their logins report it/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Show 1 other login/ }));
    expect(screen.getByText("work@example.com")).toBeInTheDocument();
    expect(screen.getByText("Team Standard")).toBeInTheDocument();
  });

  test("ToolProviderDetail notes an admin seat that no login reports, without a button", () => {
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "claude",
          name: "Claude",
          shortName: "Claude",
          provider: "anthropic",
          product: "claude",
          toolName: "claude",
          aliases: [],
          sourceUrl: "https://example.com",
          accounts: [
            {
              developerId: "dev-1",
              accountKey: "ada@example.com",
              email: "ada@example.com",
              plan: "pro",
              mappedCatalogPlanKey: "pro",
              mappedCatalogPlanName: "Pro",
              planInferredFromOrg: false,
              deviceHostname: "ada-mac",
            },
          ],
          kpis: { devices: 1, people: 1, peopleInstallOnly: 0, seatsFree: 0, seatsPurchased: 1, seatsAssigned: 1, usageCost: 0, requests: 0, tokens: 0 },
          people: [
            {
              developerId: "dev-1",
              name: "Ada Lovelace",
              email: "ada@example.com",
              detected: true,
              coverage: "covered",
              deviceHostname: "ada-mac",
              vendorPlan: "pro",
              vendorEmail: "ada@example.com",
              mappedCatalogPlanKey: "pro",
              assignment: { id: "a-1", planTemplateId: "t-1", planName: "Max 20x", catalogPlanKey: "max-20x", source: "admin_confirmed" },
              planMismatch: true,
            },
          ],
          quotas: [],
          plans: [],
          modelsByDeveloper: [],
        }}
      />,
    );

    expect(screen.getByText("Assigned Max 20x, but none of their logins report it")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use detected plan" })).not.toBeInTheDocument();
  });

  test("ToolProviderDetail aggregates tokens per person in Models", () => {
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "cursor",
          name: "Cursor",
          shortName: "Cursor",
          provider: "cursor",
          product: "cursor",
          toolName: "cursor",
          aliases: [],
          sourceUrl: "https://example.com",
          accounts: [],
          kpis: { devices: 1, people: 1, peopleInstallOnly: 0, seatsFree: 0, seatsPurchased: 1, seatsAssigned: 1, usageCost: 12.5, requests: 30, tokens: 15_000 },
          people: [],
          quotas: [],
          plans: [],
          modelsByDeveloper: [
            {
              developerId: "dev-1",
              developerName: "Ada Lovelace",
              model: "gpt-5",
              requests: 20,
              tokens: 10_000,
              cost: 8,
            },
            {
              developerId: "dev-1",
              developerName: "Ada Lovelace",
              model: "composer-2",
              requests: 10,
              tokens: 5_000,
              cost: 4.5,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(/2 models · 30 requests/)).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("gpt-5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("composer-2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("10K")).toBeInTheDocument();
    expect(screen.getByText("5K")).toBeInTheDocument();
  });
  test("ToolProviderDetail leads each person with their tightest limit and flags pricey models", () => {
    const quota = (developerId: string, developerName: string, windowType: string, usedPercent: number | null, creditsRemaining: number | null = null) => ({
      toolName: "cursor", windowType, usedPercent, creditsRemaining, resetAt: new Date(Date.now() + 2 * 86_400_000), deviceHostname: `${developerId}-mac`, developerId, developerName,
    });
    renderWithQueryClient(
      <ToolProviderDetail
        data={{
          toolKey: "cursor", name: "Cursor", shortName: "Cursor", provider: "cursor", product: "cursor", toolName: "cursor", aliases: [], sourceUrl: "https://example.com", accounts: [],
          kpis: { devices: 2, people: 2, peopleInstallOnly: 0, seatsFree: 0, seatsPurchased: 2, seatsAssigned: 2, usageCost: 500, requests: 1000, tokens: 1_000_000 },
          people: [],
          quotas: [
            quota("ada", "Ada", "api", 40),
            quota("ada", "Ada", "plan", 59),
            quota("ada", "Ada", "bonus", null, 272),
            quota("cy", "Cy", "plan", 93),
          ],
          plans: [],
          modelsByDeveloper: [
            { developerId: "ada", developerName: "Ada", model: "cheap-model", requests: 900, tokens: 500_000, cost: 100 },
            { developerId: "ada", developerName: "Ada", model: "pricey-model", requests: 100, tokens: 500_000, cost: 400 },
          ],
        }}
      />,
    );

    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const cy = rows.findIndex((text) => text.startsWith("Cy"));
    const ada = rows.findIndex((text) => text.startsWith("Ada"));
    expect(cy).toBeLessThan(ada);
    expect(rows[cy]).toMatch(/Plan93%Near limit/);
    expect(rows[ada]).toMatch(/Plan59%OK/);
    expect(screen.getByText("Closest to a limit").parentElement?.parentElement?.textContent).toMatch(/93%.*Cy · Plan · resets in 1d 23h|93%.*Cy · Plan · resets in 2d/);

    // Every window now shows inline (no "N more" collapse), so Ada's secondary
    // api and bonus windows are visible without expanding.
    expect(screen.getByText("API models")).toBeInTheDocument();
    expect(screen.getByText("$272 left")).toBeInTheDocument();

    expect(screen.getByText("80% of cost from 10% of requests")).toBeInTheDocument();
  });
});
