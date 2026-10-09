// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  BillingSettingsCard,
  type BillingSettingsMember,
} from "@/components/settings/billing-settings-card";
import type { OrgBillingStatus } from "@/lib/saas-billing/status";
import "../setup/component";

const members: BillingSettingsMember[] = [
  { id: "member-1", name: "Alice Admin", email: "alice@example.com" },
  { id: "member-2", name: "Dev User", email: "dev@example.com" },
];

const baseBilling: OrgBillingStatus = {
  plan: "community",
  effectivePlan: "community",
  planLabel: "Community",
  subscriptionStatus: null,
  usersUsed: 2,
  usersLimit: 10,
  usagePercent: 20,
  canUpgrade: true,
  canManage: false,
  isAtUserLimit: false,
  billingSeatQuantity: null,
  seatSyncPending: false,
};

function billing(overrides: Partial<OrgBillingStatus>): OrgBillingStatus {
  return { ...baseBilling, ...overrides };
}

function stubLocation() {
  let href = "http://localhost/settings";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return href;
      },
      set href(next: string) {
        href = next;
      },
    },
  });
  return () => href;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("Team billing shows a simple plan summary, billed users, total, and seat sync state", () => {
  render(
    <BillingSettingsCard
      billing={billing({
        plan: "team",
        effectivePlan: "team",
        planLabel: "Team",
        subscriptionStatus: "active",
        usersLimit: null,
        usagePercent: null,
        canUpgrade: false,
        canManage: true,
        billingSeatQuantity: 5,
        seatSyncPending: true,
      })}
      members={members}
    />,
  );

  expect(screen.getByRole("region", { name: "Billing" })).toBeTruthy();
  expect(screen.getByText("Active subscription")).toBeTruthy();
  expect(screen.getByText("$2 / month")).toBeTruthy();
  expect(screen.getByText("2 active users billed at $1 per user per month.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Billed users/ })).toBeTruthy();
  expect(screen.getAllByText("$1 / month")).toHaveLength(2);
  expect(screen.queryByText(/estimat/i)).toBeNull();
  expect(screen.getByText("Alice Admin")).toBeTruthy();
  expect(screen.getByText("alice@example.com")).toBeTruthy();
  expect(screen.getByText("Dev User")).toBeTruthy();
  expect(screen.getByText(/it lists 5 seats/i)).toBeTruthy();
  expect(screen.getByRole("status")).toHaveTextContent(/Updating your subscription/i);
  expect(screen.getByRole("button", { name: /Manage billing/i })).toBeTruthy();
});

test.each([
  {
    name: "Community",
    state: baseBilling,
    total: "$0 / month",
    detail: "Community is free. Team costs $1 per active user per month.",
    status: "Free tier",
  },
  {
    name: "Enterprise",
    state: billing({
      plan: "enterprise",
      effectivePlan: "enterprise",
      planLabel: "Enterprise",
      subscriptionStatus: "active",
      usersLimit: null,
      usagePercent: null,
      canUpgrade: false,
      canManage: true,
    }),
    total: "Custom pricing",
    detail: "2 active users covered by your contract.",
    status: "Active subscription",
  },
])("$name shows the correct price and status", ({ state, total, detail, status }) => {
  render(<BillingSettingsCard billing={state} members={members} />);
  expect(screen.getByText(total)).toBeTruthy();
  expect(screen.getByText(detail)).toBeTruthy();
  expect(screen.getByText(status)).toBeTruthy();
});

test("the billing roster is a named keyboard-scrollable list", () => {
  const largeRoster = Array.from({ length: 6 }, (_, index) => ({
    id: `member-${index}`,
    name: `Member ${index + 1}`,
    email: `member-${index + 1}@example.com`,
  }));
  render(
    <BillingSettingsCard
      billing={billing({ usersUsed: largeRoster.length })}
      members={largeRoster}
    />,
  );

  const roster = screen.getByRole("region", { name: "Scrollable member list" });
  expect(roster).toHaveAttribute("tabindex", "0");
  expect(screen.getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getByText("member-6@example.com")).toBeTruthy();
});

test("paid workspaces without a Lemon portal show a non-actionable state", () => {
  render(
    <BillingSettingsCard
      billing={billing({
        plan: "team",
        effectivePlan: "team",
        planLabel: "Team",
        subscriptionStatus: "active",
        usersLimit: null,
        usagePercent: null,
        canUpgrade: false,
        canManage: false,
      })}
      members={members}
    />,
  );

  expect(screen.getByText("Billing management is unavailable for this workspace.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Manage billing/i })).toBeNull();
});

test("upgrade opens Lemon checkout", async () => {
  const currentHref = stubLocation();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ url: "https://lemon.test/checkout" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<BillingSettingsCard billing={baseBilling} members={members} />);

  fireEvent.click(screen.getByRole("button", { name: /Upgrade to Team/i }));

  await waitFor(() => expect(currentHref()).toBe("https://lemon.test/checkout"));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/billing/checkout",
    expect.objectContaining({ method: "POST", body: "{}" }),
  );
});

test("manage billing opens the Lemon portal and surfaces API failures", async () => {
  const currentHref = stubLocation();
  const teamBilling = billing({
    plan: "team",
    effectivePlan: "team",
    planLabel: "Team",
    subscriptionStatus: "active",
    usersLimit: null,
    usagePercent: null,
    canUpgrade: false,
    canManage: true,
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://lemon.test/portal" }) })
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Portal temporarily unavailable" }),
    });
  vi.stubGlobal("fetch", fetchMock);

  const { unmount } = render(<BillingSettingsCard billing={teamBilling} members={members} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage billing/i }));
  await waitFor(() => expect(currentHref()).toBe("https://lemon.test/portal"));
  expect(fetchMock).toHaveBeenCalledWith("/api/billing/portal", { method: "POST" });

  unmount();
  render(<BillingSettingsCard billing={teamBilling} members={members} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage billing/i }));
  await waitFor(() => expect(screen.getByText("Portal temporarily unavailable")).toBeTruthy());
});
