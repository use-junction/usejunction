// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "../setup/component";

vi.mock("@/components/tools/tool-brand-icon", () => ({ ToolBrandIcon: () => <svg aria-hidden /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewCollectionBanner } from "@/components/new-collection-banner";

const account = (over: Record<string, unknown>) => ({
  id: "a1", deviceId: "d1", hostname: "MacBook.local", toolName: "cursor", displayName: "Cursor",
  accountKey: "me@x.com", email: "me@x.com", plan: "Pro", authPresent: true,
  usageEnabled: false, loggingEnabled: false, usageAdminLocked: false, loggingAdminLocked: false,
  usageAllowed: false, loggingAllowed: false, updatedAt: "2026-10-01T00:00:00Z", newProvider: false, ...over,
});

afterEach(() => vi.unstubAllGlobals());

test("asks about new tools and accounts, and records Not now", async () => {
  let pending = [
    account({}),
    account({ id: "a2", toolName: "roo", displayName: "Roo", accountKey: "roo@x.com", email: "roo@x.com", newProvider: true }),
    account({ id: "a3", toolName: "claude", displayName: "Claude", accountKey: "claude:uuid", email: null }),
  ];
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      pending = pending.filter((row) => row.accountKey !== body.accountKey);
      return new Response(JSON.stringify({ account: {} }), { status: 200 });
    }
    return new Response(JSON.stringify({ pending }), { status: 200 });
  }));

  render(<NewCollectionBanner refreshKey="w1" />);
  expect(await screen.findByText("New on your machine: Roo.")).toBeInTheDocument();
  expect(screen.getByText("New tool")).toBeInTheDocument();
  expect(screen.queryByText("Claude")).not.toBeInTheDocument();
  expect(screen.queryByText(/no email/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Include all" })).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]!);
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({ scope: "account", toolName: "cursor", enabled: false, decision: true });
  await waitFor(() => expect(screen.queryByText("me@x.com · Pro · MacBook")).not.toBeInTheDocument());
});

test("renders nothing when the only login has no email", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    pending: [account({ toolName: "claude", displayName: "Claude", accountKey: "claude:uuid", email: null })],
  }), { status: 200 })));
  const { container } = render(<NewCollectionBanner />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("renders nothing when there is nothing to decide", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pending: [] }), { status: 200 })));
  const { container } = render(<NewCollectionBanner />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
