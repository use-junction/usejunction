// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../setup/component";
import { collectionNoticeCopy } from "@/lib/privacy/collection-notice";
import type { MyDataAccountRow, MyDataPreferenceEvent } from "@/lib/privacy/my-data-types";
import { MyDataCollection } from "@/components/me/my-data-collection";

vi.mock("@/components/panel", () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolLogoTile: () => null,
}));

const invalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  };
});

function account(partial: Partial<MyDataAccountRow> & Pick<MyDataAccountRow, "id" | "accountKey" | "email">): MyDataAccountRow {
  return {
    deviceId: "device-1",
    hostname: "laptop",
    toolName: "cursor",
    displayName: "Cursor",
    plan: "pro",
    authPresent: true,
    usageEnabled: false,
    loggingEnabled: false,
    usageAdminLocked: false,
    loggingAdminLocked: false,
    usageAllowed: false,
    loggingAllowed: false,
    updatedAt: "2026-09-23T00:00:00.000Z",
    usageStorage: { state: "none", lastUsageDay: null },
    ...partial,
  };
}

const notice = collectionNoticeCopy({ orgName: "Acme", usageRetentionDays: 365 });

function renderCollection(
  accounts: MyDataAccountRow[],
  extras: { events?: MyDataPreferenceEvent[] } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyDataCollection
        accounts={accounts}
        preferenceEvents={extras.events ?? []}
        notice={notice}
      />
    </QueryClientProvider>,
  );
}

describe("MyDataCollection", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    invalidateQueries.mockReset();
  });

  it("lists every login in one list and can collect usage from more than one at once", async () => {
    const accounts = [
      account({ id: "1", accountKey: "personal", email: "me@home.com", authPresent: false }),
      account({
        id: "2",
        accountKey: "work",
        email: "me@work.com",
        usageEnabled: true,
        usageAllowed: true,
        usageStorage: { state: "active_day", lastUsageDay: "2026-09-23" },
      }),
      account({ id: "3", accountKey: "contractor", email: "me@agency.com" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe("PATCH");
        return new Response(JSON.stringify({ account: accounts[0] }), { status: 200 });
      }),
    );

    renderCollection(accounts);

    expect(screen.getByRole("heading", { name: "Tool logins" })).toBeTruthy();
    expect(screen.getByText("me@home.com")).toBeTruthy();
    expect(screen.getByText("me@work.com")).toBeTruthy();
    expect(screen.getByText("me@agency.com")).toBeTruthy();
    expect(screen.getByText("1 of 3 on")).toBeTruthy();
    expect(screen.getByText(/Last stored usage day:/)).toBeTruthy();
    expect(screen.getAllByText("Usage off · nothing stored for this login")).toHaveLength(2);

    const usageSwitches = screen.getAllByRole("switch", { name: /Usage$/ }) as HTMLInputElement[];
    expect(usageSwitches).toHaveLength(3);
    expect(usageSwitches.filter((input) => input.checked)).toHaveLength(1);

    fireEvent.click(screen.getByRole("switch", { name: /me@home.com on laptop — Usage/ }));
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["app", "me", "data"] });
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows search only after eight accounts and filters email, provider, and hostname", () => {
    const accounts = Array.from({ length: 9 }, (_, index) =>
      account({
        id: String(index + 1),
        accountKey: `acct-${index}`,
        email: index === 8 ? "unique@example.com" : `user${index}@example.com`,
        hostname: index === 7 ? "studio" : "laptop",
        toolName: index < 4 ? "cursor" : "opencode",
        displayName: index < 4 ? "Cursor" : "OpenCode",
      }),
    );
    renderCollection(accounts);
    const search = screen.getByLabelText("Filter by email or device name");

    fireEvent.change(search, { target: { value: "unique@" } });
    expect(screen.getByText("unique@example.com")).toBeTruthy();
    expect(screen.queryByText("user0@example.com")).toBeNull();

    fireEvent.change(search, { target: { value: "studio" } });
    expect(screen.getByText("user7@example.com")).toBeTruthy();
    expect(screen.queryByText("unique@example.com")).toBeNull();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Cursor" }));
    expect(screen.getByText("user0@example.com")).toBeTruthy();
    expect(screen.queryByText("user5@example.com")).toBeNull();
  });

  it("hides search and provider chips at eight accounts or fewer", () => {
    renderCollection([
      account({ id: "1", accountKey: "a", email: "a@x.com" }),
      account({ id: "2", accountKey: "b", email: "b@x.com", toolName: "opencode", displayName: "OpenCode" }),
    ]);
    expect(screen.queryByLabelText("Filter by email or device name")).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter by provider" })).toBeNull();
  });

  it("locks admin-disabled switches and keeps unique labels per account", () => {
    renderCollection([
      account({
        id: "1",
        accountKey: "work",
        email: "me@work.com",
        usageEnabled: true,
        usageAdminLocked: true,
        loggingAdminLocked: true,
      }),
    ]);
    const usage = screen.getByRole("switch", { name: /me@work.com on laptop — Usage/ }) as HTMLInputElement;
    expect(usage.disabled).toBe(true);
    expect(usage.checked).toBe(false);
    expect(screen.queryByRole("switch", { name: /Activity logging/ })).toBeNull();
    expect(screen.getByText("Locked off by a workspace admin")).toBeTruthy();
  });

  it("does not offer activity logging", () => {
    renderCollection([account({ id: "1", accountKey: "work", email: "me@work.com", loggingEnabled: true })]);
    expect(screen.queryByRole("switch", { name: /Activity logging/ })).toBeNull();
    fireEvent.click(screen.getByText("What is collected?"));
    expect(screen.queryByText(/Activity logging/)).toBeNull();
    expect(screen.getByText(/Turning Usage off stops new uploads/)).toBeTruthy();
  });

  it("offers provider bulk-off only for the selected collecting provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const accounts = Array.from({ length: 9 }, (_, index) =>
      account({
        id: String(index),
        accountKey: `k${index}`,
        email: `u${index}@x.com`,
        usageAllowed: index === 0,
        usageEnabled: index === 0,
        toolName: index < 3 ? "cursor" : "opencode",
        displayName: index < 3 ? "Cursor" : "OpenCode",
      }),
    );
    renderCollection(accounts);
    expect(screen.queryByRole("button", { name: /Turn off all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OpenCode" }));
    expect(screen.queryByRole("button", { name: /Turn off all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cursor" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off all Cursor" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ scope: "provider", toolName: "cursor", enabled: false });
  });

  it("phrases preference history as setting changes, not tracking activity", async () => {
    renderCollection(
      [account({ id: "1", accountKey: "work", email: "me@work.com" })],
      {
        events: [
          {
            id: "evt-1",
            deviceId: "device-1",
            toolName: "cursor",
            accountKey: "work",
            stream: "usage",
            enabled: false,
            actor: "developer",
            createdAt: "2026-09-23T09:15:00.000Z",
            hostname: "laptop",
            displayName: "Cursor",
            email: "me@work.com",
          },
        ],
      },
    );
    fireEvent.click(screen.getByText("Recent changes to collection settings"));
    expect(await screen.findByText(/not upload activity/)).toBeTruthy();
    expect(screen.getByText(/You turned Usage off for Cursor · me@work.com on laptop/)).toBeTruthy();
    expect(screen.queryByText(/recently tracked/i)).toBeNull();
  });

  it("keeps 44px tap targets on toggles", () => {
    renderCollection([account({ id: "1", accountKey: "work", email: "me@work.com" })]);
    const usage = screen.getByRole("switch", { name: /Usage$/ }).closest("label");
    expect(usage?.className).toMatch(/min-h-11/);
  });
});
