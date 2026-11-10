import { expect, test } from "@playwright/test";
import { SUPPORTED_TOOLS } from "../lib/public/config";

const teamInviteToken = process.env.E2E_TEAM_INVITE_TOKEN ?? "uj_team_e2e_calculation_invite";
const orgInviteToken = process.env.E2E_ORG_INVITE_TOKEN ?? "uj_invite_e2e_calculation_member";

const publicRoutes = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/contact",
  "/privacy",
  "/terms",
  "/dpa",
  "/subprocessors",
  "/gdpr",
  "/security",
  "/cookies",
  "/i/invalid-token",
  "/join/invalid-token",
  "/join/company/missing-org",
];

for (const route of publicRoutes) {
  test(`${route} renders without server or browser errors`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status(), `${route} response`).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    expect(pageErrors, `${route} page errors`).toEqual([]);
  });
}

test("unknown routes redirect unauthenticated visitors to sign in", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /Sign in to UseJunction/i })).toBeVisible();
});

test("landing page shows brand and primary CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("UseJunction — Team Usage Analytics for Claude, Cursor & Codex");
  await expect(page.locator("title")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "UseJunction home" }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /See who actually uses the AI coding seats you pay for\./i,
      level: 1,
    }),
  ).toBeVisible();

  const toolStrip = page.getByRole("region", { name: "Supported AI coding tools" });
  await expect(toolStrip).toBeVisible();
  await expect(toolStrip.getByRole("img")).toHaveCount(0);
  for (const tool of SUPPORTED_TOOLS) {
    await expect(toolStrip.getByText(tool.name, { exact: true }).first()).toBeVisible();
  }

  // A new visitor can sign up from the header, not only sign in.
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", /^\/signup/);
  await expect(header.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");

  const heroCta = page.getByRole("main").getByRole("link", { name: "Start free" }).first();
  await expect(heroCta).toBeVisible();
  await expect(heroCta).toHaveAttribute("href", /^\/signup\?from=/);
  await expect(
    page.getByText("Free for 5 seats. Then $1 per active developer a month. No card.").first(),
  ).toBeVisible();

  const video = page.getByLabel(/UseJunction product video/i);
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("poster", "/video/hero-poster.jpg");
  await expect(video).toHaveJSProperty("muted", true);

  const closing = page.getByRole("region", { name: /Find the seats you’re paying for and not using/i });
  await expect(closing.getByRole("link", { name: "Start free" })).toHaveAttribute("href", /^\/signup/);
});

test("homepage product story walks through the three renewal checks", async ({ page }) => {
  await page.goto("/");

  const tabs = page.getByRole("tablist", { name: "Product workflows" });
  const seeTab = tabs.getByRole("tab", { name: /Which seats are idle\?/ });
  const understandTab = tabs.getByRole("tab", { name: /Who is on the wrong plan\?/ });
  const actTab = tabs.getByRole("tab", { name: /What needs a look this week\?/ });

  await expect(seeTab).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "Seats this cycle" })).toBeVisible();
  await expect(panel.getByText("7 idle seats cost $177 a month.")).toBeVisible();
  await expect(panel.getByText("Example data.")).toBeVisible();
  // The old screenshots showed a real person's name and email; the panels must not.
  await expect(page.locator("#product img[src*='/elements/']")).toHaveCount(0);
  await seeTab.focus();
  await seeTab.press("ArrowRight");
  await expect(understandTab).toHaveAttribute("aria-selected", "true");

  await expect(panel.getByRole("heading", { name: "Claude Team, weekly limit used" })).toBeVisible();
  await expect(panel.getByText("Move to Standard")).toHaveCount(3);

  await understandTab.press("End");
  await expect(actTab).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("heading", { name: "Needs a look" })).toBeVisible();
  await expect(panel.getByText("Personal API key")).toBeVisible();
});

test("homepage shows current pricing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /\$1 per active developer\. Free for your first 5 seats\./i })).toBeVisible();
  await expect(page.getByText("Free", { exact: true })).toBeVisible();
  await expect(page.getByText("$1", { exact: true })).toBeVisible();
  await expect(page.getByText("Custom", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Managed", exact: true })).toBeVisible();
  await expect(page.locator("#pricing").getByRole("link", { name: "Start free" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Talk to us" })).toBeVisible();
});

test("login form rejects bad credentials and links to recovery", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Sign in to UseJunction/i })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/We could not sign you in/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
});

test("signup form validates password confirmation", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByLabel("Full name")).toBeVisible();
  await page.getByLabel("Full name").fill("E2E Signup");
  await page.getByLabel("Work email").fill("signup-e2e@example.com");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(/matching password of at least 12 characters/i),
  ).toBeVisible();
});

test("forgot password shows confirmation after submit", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: /Reset your password/i })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/Check your email for next steps/i)).toBeVisible();
});

test("reset password form is available", async ({ page }) => {
  await page.goto("/reset-password?token=invalid");
  await expect(page.getByRole("heading", { name: /Choose a new password/i })).toBeVisible();
  await expect(page.getByLabel("New password")).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toBeVisible();
});

test("contact form submits a note", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: /Tell us what your team needs/i })).toBeVisible();
  await page.getByLabel("Name").fill("E2E Contact");
  await page.getByLabel("Work email").fill("contact-e2e@example.com");
  await page.getByLabel("Company").fill("Calculation E2E");
  await page.getByLabel("What are you evaluating?").fill("Browser e2e coverage");
  await page.getByRole("button", { name: "Send note" }).click();
  await expect(page.getByText(/Thanks—your note has been received/i)).toBeVisible();
});

test("invalid invite routes show unavailable messaging", async ({ page }) => {
  await page.goto("/i/invalid-token");
  await expect(page.getByRole("heading", { name: /This invite is unavailable/i })).toBeVisible();

  await page.goto("/join/invalid-token");
  await expect(page.getByRole("heading", { name: /This invitation is unavailable/i })).toBeVisible();

  await page.goto("/join/company/missing-org");
  await expect(page.getByRole("heading", { name: /Company join is unavailable/i })).toBeVisible();
});

test("seeded invite links render join flows", async ({ page }) => {
  await page.goto(`/i/${teamInviteToken}`);
  await expect(page.getByRole("heading", { name: /Join Calculation E2E/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/You're already signed in/i)).toHaveCount(0);

  await page.goto(`/join/${orgInviteToken}`);
  await expect(page.getByRole("heading", { name: /Join Calculation E2E/i })).toBeVisible();
});
