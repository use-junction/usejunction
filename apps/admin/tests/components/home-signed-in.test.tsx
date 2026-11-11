// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
// The logo is a static image import, which next/image cannot size outside a Next build.
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
// A signed-in session, in case the page asks for one.
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("@/components/public/use-junction-home-content", () => ({
  UseJunctionHomeContent: () => <main>homepage</main>,
}));

import HomePage from "../../app/(public)/page";
import { MarketingTopNav } from "../../components/public/marketing-top-nav";

afterEach(() => {
  cleanup();
  redirect.mockClear();
});

test("a signed-in visitor sees the homepage instead of being sent to the dashboard", async () => {
  render(await HomePage());

  expect(redirect).not.toHaveBeenCalled();
  expect(screen.getByText("homepage")).toBeTruthy();
});

test("the header gives a signed-in visitor a Dashboard button in place of Sign in and Start free", () => {
  render(<MarketingTopNav isAuthenticated />);

  // One in the desktop bar and one in the phone bar; the phone menu adds a third when it is open.
  const dashboard = screen.getAllByRole("link", { name: "Dashboard" });
  expect(dashboard).toHaveLength(2);
  for (const link of dashboard) expect(link.getAttribute("href")).toBe("/dashboard");
  expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Start free" })).toBeNull();
});

test("the header gives a signed-out visitor Sign in and Start free, and no Dashboard button", () => {
  render(<MarketingTopNav isAuthenticated={false} />);

  expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  expect(screen.getAllByRole("link", { name: "Start free" }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
});

test("the header's first link is Home, pointing at the homepage", () => {
  render(<MarketingTopNav isAuthenticated={false} />);

  const primary = screen.getByRole("navigation", { name: "Primary navigation" });
  const links = [...primary.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
  expect(links).toEqual([
    ["Home", "/"],
    ["Blog", "/blog"],
  ]);
  expect(screen.queryByText("For coders")).toBeNull();
});
