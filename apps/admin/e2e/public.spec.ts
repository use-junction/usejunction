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
      name: /See where your AI coding spend goes\./i,
      level: 1,
    }),
  ).toBeVisible();

  // The strip names the paid tools; every supported tool is listed next to the FAQ.
  const toolStrip = page.getByRole("region", { name: "Supported AI coding tools" });
  await expect(toolStrip).toBeVisible();
  await expect(toolStrip.getByRole("img")).toHaveCount(0);
  for (const tool of ["Claude Code", "Cursor", "Codex", "GitHub Copilot"]) {
    await expect(toolStrip.getByText(tool, { exact: true })).toBeVisible();
  }
  await expect(toolStrip.getByRole("link", { name: `and ${SUPPORTED_TOOLS.length - 4} more` })).toHaveAttribute("href", "#tools");
  const allTools = page.getByRole("list", { name: "Supported tools" });
  for (const tool of SUPPORTED_TOOLS) {
    await expect(allTools.getByText(tool.name, { exact: true })).toBeVisible();
  }

  // A new visitor can sign up from the header, not only sign in.
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", /^\/signup/);
  await expect(header.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");

  const heroCta = page.getByRole("main").getByRole("link", { name: "Start free" }).first();
  await expect(heroCta).toBeVisible();
  await expect(heroCta).toHaveAttribute("href", /^\/signup\?from=/);
  await expect(
    page.getByText("Free for 5 seats, then $1 per active developer a month. No card.").first(),
  ).toBeVisible();

  const video = page.getByLabel(/UseJunction product video/i);
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("poster", "/video/hero-loop-poster.jpg");
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  // The loop actually loads and plays: the browser picked a source and the clock moves.
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentSrc)).toMatch(/\/video\/hero-loop(-mobile)?\.(mp4|webm)$/);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.5);

  // The chapter strip jumps the film to a chapter and marks it; the pause button stops the clock.
  const chapters = page.getByRole("group", { name: "Video chapters" });
  await chapters.getByRole("button", { name: /^Forecast/ }).click();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThanOrEqual(11.1);
  await expect(chapters.getByRole("button", { name: /^Forecast/ })).toHaveAttribute("aria-current", "true");
  await chapters.getByRole("button", { name: "Pause video" }).click();
  await expect(video).toHaveJSProperty("paused", true);
  await expect(chapters.getByRole("button", { name: "Play video" })).toBeVisible();

  const closing = page.getByRole("region", { name: /Connect your own laptop first/i });
  await expect(closing.getByRole("link", { name: "Start free" })).toHaveAttribute("href", /^\/signup/);
});

test("homepage shows the example team's real screens with notes", async ({ page }) => {
  await page.goto("/");

  const weeks = page.getByRole("region", { name: "You’ve probably had one of these weeks." });
  await expect(weeks.getByRole("img", { name: /Priya is at 97% of her weekly limit/ })).toBeVisible();
  await expect(weeks.getByText("On Standard, at 97% of her week")).toBeVisible();

  const adoption = page.getByRole("region", { name: "Who has started, and who needs a nudge." });
  await expect(adoption.getByRole("img", { name: /Regular, Occasional or Not using yet/ })).toBeVisible();

  const work = page.getByRole("region", { name: "Where the AI spend landed." });
  await expect(work.getByRole("img", { name: /\$693\.48 merged/ })).toBeVisible();
  await expect(work.getByText("$693 landed on work that merged")).toBeVisible();
  await expect(work.getByText("$173 on work that isn’t moving")).toBeVisible();

  const paidTwice = page.getByRole("region", { name: "Paid twice." });
  await expect(paidTwice.getByRole("img", { name: /9 are paid twice/ })).toBeVisible();

  // Value beyond cost: one row per reader, each answered by a real view.
  const roles = page.getByRole("region", { name: "Who asks, and what they see." });
  for (const who of ["Engineering manager", "Project manager", "Leadership", "Finance", "Developer"]) {
    await expect(roles.getByText(who, { exact: true })).toBeVisible();
  }
  await expect(roles.getByRole("img", { name: /projected at current daily pace/ })).toBeVisible();
  await expect(roles.getByRole("img", { name: /^Biggest items/ })).toBeVisible();
  await expect(roles.getByRole("img", { name: /Spend by week by project/ })).toBeVisible();
  const sheet = roles.getByRole("figure", { name: /cost\.csv/ });
  await expect(sheet.getByRole("cell", { name: "People using it (30d)" })).toBeVisible();
  await expect(sheet.getByRole("cell", { name: "Next renewal" })).toBeVisible();
});

test("homepage compares each vendor's admin, explains pricing, and shows the rollout and what is collected", async ({ page }) => {
  await page.goto("/");

  const compare = page.getByRole("region", { name: "What each tool’s own admin shows per person." });
  for (const vendor of ["Claude", "Cursor", "GitHub Copilot", "Codex"]) {
    await expect(compare.getByRole("columnheader", { name: vendor })).toBeVisible();
  }
  await expect(compare.getByRole("columnheader", { name: "UseJunction" }).getByRole("img", { name: "UseJunction" })).toBeVisible();
  const prRow = compare.getByRole("row", { name: /Spend by pull request and issue/ });
  await expect(prRow.getByRole("cell")).toHaveText([/Not in their docs/, /Not in their docs/, /Not in their docs/, /Not in their docs/, /Yes/]);

  const pricing = page.locator("#pricing");
  await expect(pricing.getByRole("heading", { name: /\$1 per active developer a month\. Your first 5 seats are free\./ })).toBeVisible();
  const plans = pricing.getByRole("list", { name: "Plans" }).getByRole("listitem");
  await expect(plans).toHaveCount(2);
  await expect(plans.nth(0)).toContainText("Hosted");
  await expect(plans.nth(1)).toContainText("Self-hosted");
  await expect(pricing.getByText(/pays for/)).toHaveCount(0);
  await expect(pricing.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", /^\/signup/);

  const start = page.getByRole("region", { name: /Try it on your own laptop/ });
  for (const step of ["Connect your laptop", "Look at your own usage", "Invite the team", "Connect GitHub"]) {
    await expect(start.getByRole("heading", { name: step })).toBeVisible();
  }
  await expect(start.getByText("--token")).toHaveCount(0);

  const privacy = page.getByRole("region", { name: "Your developers will ask what it collects." });
  await expect(privacy.getByRole("list", { name: "Collected", exact: true }).getByRole("listitem")).toHaveCount(5);
  await expect(privacy.getByRole("list", { name: "Never collected" })).toContainText("Keystrokes or screenshots");

  const faq = page.getByRole("region", { name: "Before you install." });
  await expect(faq.getByText("Do developers have to change how they work?")).toBeVisible();
  await expect(faq.getByText("More questions")).toBeVisible();
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
