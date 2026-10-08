import { expect, test } from "@playwright/test";
import { setOnboardingState } from "./onboarding-state";

const ownerEmail = process.env.E2E_OWNER_EMAIL ?? "owner@example.com";

const workspaceRoutes = [
  "/dashboard",
  "/dashboard?view=current_cycles",
  "/dashboard?view=previous_cycles",
  "/dashboard?view=last_30_days&days=14",
  "/dashboard?view=last_30_days&from=2026-07-01&to=2026-07-16",
  "/activity",
  "/features",
  "/work-spend",
  "/settings",
  "/me/data",
  "/team",
  "/team/e2e-developer",
  "/team/e2e-developer/work",
  "/team/e2e-developer/coding",
  "/team/e2e-developer/fleet",
  "/tools",
  "/tools/cursor",
  "/signals",
  "/signals/activity?days=30",
  "/signals/journeys?days=30",
  "/signals/journeys/github.com__cursor__slack.com?days=30",
  "/signals/tools?days=30",
  "/signals/settings",
  "/onboarding?resume=1",
];

test("workspace startup has no bootstrap gate or duplicate page-data request", async ({ page }) => {
  const appRequests: string[] = [];
  const failedAppRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/app/")) {
      appRequests.push(`${url.pathname}${url.search}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (failure.includes("ERR_ABORTED") || failure.includes("NS_BINDING_ABORTED")) return;
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/app/")) {
      failedAppRequests.push(`${url.pathname}${url.search}`);
    }
  });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "What's reporting?" })).toBeVisible();

  expect(appRequests).not.toContain("/api/app/bootstrap");
  // The client workspace context and destination page model each load at most once.
  expect(appRequests.filter((path) => path === "/api/app/workspace-context").length).toBeLessThanOrEqual(1);
  const dashboardRequests = appRequests.filter((path) => path.startsWith("/api/app/dashboard"));
  expect(dashboardRequests.filter((path) => path.includes("slice=shell")).length).toBeLessThanOrEqual(2);
  expect(dashboardRequests.filter((path) => path.includes("slice=metrics")).length).toBeLessThanOrEqual(2);
  expect(
    dashboardRequests.filter((path) => !path.includes("slice=shell") && !path.includes("slice=metrics")).length,
  ).toBeLessThanOrEqual(1);
  expect(failedAppRequests).toEqual([]);
});

test("features redirects into work and spend and keeps the window", async ({ page }) => {
  await page.goto("/features?days=30&repositoryId=repo-1");
  await expect(page).toHaveURL(/\/work-spend\?days=30&repositoryId=repo-1$/);
  await expect(page.locator("main")).toBeVisible();
});

for (const route of workspaceRoutes) {
  test(`${route} renders without server or browser errors`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status(), `${route} response`).toBeLessThan(500);
    const shell = route.startsWith("/onboarding") ? page.locator("body") : page.locator("main");
    await expect(shell).toBeVisible();
    expect(pageErrors, `${route} page errors`).toEqual([]);
  });
}

test("unknown routes show branded 404 recovery", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  // Next dev may stream not-found UI with HTTP 200; production returns 404.
  expect([200, 404]).toContain(response?.status());
  await expect(page.getByRole("heading", { name: /This page isn’t here/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open dashboard" })).toBeVisible();
});

test("owner chrome exposes nav, active-plan badge, and workspace switcher", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Coverage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Signals" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Cost", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Adoption" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Plan", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Team plan", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Manage billing|Upgrade to Team/i })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Workspace" })).toBeVisible();
});

test("owner Team | You switcher scopes Dashboard and Activity", async ({ page }) => {
  await page.goto("/dashboard");
  const audience = page.getByRole("tablist", { name: "Audience" });
  await expect(audience).toBeVisible();
  await expect(audience.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "What's reporting?" })).toBeVisible();

  await Promise.all([
    page.waitForURL(/scope=you/),
    audience.getByRole("tab", { name: "You" }).click(),
  ]);
  await expect(
    page
      .getByRole("heading", { name: "What's reporting?" })
      .or(page.getByRole("heading", { name: "Nothing reporting yet." }))
      .or(page.getByText(/Link a developer profile/i)),
  ).toBeVisible();

  await Promise.all([
    page.waitForURL((url) => !url.searchParams.has("scope") || url.searchParams.get("scope") !== "you"),
    audience.getByRole("tab", { name: "Team" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "What's reporting?" })).toBeVisible();

  await page.goto("/activity");
  const activityAudience = page.getByRole("tablist", { name: "Audience" });
  await expect(activityAudience.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Adoption." })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/activity\?.*scope=you/),
    activityAudience.getByRole("tab", { name: "You" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "How are you using it?" })).toBeVisible();
});

test("owner Activity shows Team adoption and You usage with Reports", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByRole("heading", { level: 1, name: "Adoption." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who uses AI, day by day." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs a nudge." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spread by tool." })).toBeVisible();
  await page.getByText("Collection health and sent reports").click();
  await expect(page.getByRole("heading", { name: "Reports." })).toBeVisible();

  const audience = page.getByRole("tablist", { name: "Audience" });
  await Promise.all([
    page.waitForURL(/scope=you/),
    audience.getByRole("tab", { name: "You" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "How are you using it?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reports." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By tool." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By model." })).toBeVisible();

  await page.goto("/reports/daily?scope=you&date=2026-07-21");
  await expect(page).toHaveURL(/\/activity/);
  await expect(page).toHaveURL(/scope=you/);
  await expect(page).toHaveURL(/#reports/);
});

test("dashboard exposes seeded calculation output and all period controls", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "What's reporting?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Requests." })).toBeVisible();
  await expect(page.getByText("Subscription commitment")).toBeVisible();
  await expect(
    page.getByText(/All tracked plans on track|Purchased seats · run-out from allowance pace|Earliest run-out/i),
  ).toBeVisible();
  await expect(page.getByText("$40.00").first()).toBeVisible();
  await expect(page.getByText("Estimated usage").first()).toBeVisible();
  await expect(page.getByText("$27.00").first()).toBeVisible();
  await expect(page.getByText("$25.00 verified · $2.00 estimated")).toBeVisible();
  await expect(page.getByText("Price per 1M tokens").first()).toBeVisible();
  await expect(page.getByText("$4.84").first()).toBeVisible();
  await expect(page.getByText("Est. spend/day").first()).toBeVisible();
  // Free/detected tools (OpenCode, ChatGPT Free) appear in Current cycles.
  await expect(page.getByRole("link", { name: /OpenCode/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /ChatGPT.*Free/i }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top models." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current cycles." })).toBeVisible();
  await page.getByRole("link", { name: "Previous cycles" }).click();
  await expect(page).toHaveURL(/view=previous_cycles/);
  await expect(page.getByRole("heading", { name: "Previous cycles." })).toBeVisible();
  await expect(page.getByText("verified + estimated · previous cycles")).toBeVisible();
  await page.getByRole("link", { name: "Current cycles" }).click();
  await expect(page).toHaveURL(/view=current_cycles/);
  await expect(page.getByRole("heading", { name: "Current cycles." })).toBeVisible();
  await page.goto("/dashboard?view=last_30_days");
  await page.getByRole("button", { name: "Adjust rolling period" }).click();
  await page.getByText("Last 14 days").click();
  await expect(page).toHaveURL(/days=14/);
});

test("hidden Signals product routes redirect to dashboard", async ({ page }) => {
  for (const route of [
    "/signals",
    "/signals/activity",
    "/signals/settings",
    "/signals/journeys?days=30",
    "/signals/tools?days=30",
    "/signals/journeys/github.com__cursor__slack.com?days=30",
  ]) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/dashboard/);
  }
});

test("Settings shows workspace, billing, and team visibility controls", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "How is this set up?", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspace", level: 2 })).toBeVisible();
  const billing = page.getByRole("region", { name: "Billing" });
  await expect(billing).toBeVisible();
  await expect(billing.getByText("Team", { exact: true }).first()).toBeVisible();
  await expect(billing.getByText("2 active users billed at $1 per user per month.", { exact: true })).toBeVisible();
  await expect(billing.getByText("$2 / month", { exact: true })).toBeVisible();
  await expect(billing.getByRole("heading", { name: /Billed users/ })).toBeVisible();
  await expect(billing.getByText("$1 / month", { exact: true })).toHaveCount(2);
  await expect(billing.getByText("E2E Owner", { exact: true })).toBeVisible();
  await expect(billing.getByText("owner@example.com", { exact: true })).toBeVisible();
  await expect(billing.getByText("E2E Developer", { exact: true })).toBeVisible();
  await expect(billing.getByText("developer@example.com", { exact: true })).toBeVisible();
  await expect(billing.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signals", level: 2 })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Team visibility", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toBeVisible();
  await expect(page.getByRole("button", { name: /Allow for team|Restrict to admins/ }).first()).toBeVisible();
});

test("settings mutations rename workspace and toggle team visibility", async ({ page }) => {
  await page.goto("/settings");
  const nameInput = page.getByLabel("Workspace name");
  await nameInput.fill("Calculation E2E Renamed");
  await page.getByRole("button", { name: "Save workspace" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const visibilityButton = page.getByRole("button", { name: /Allow for team|Restrict to admins/ }).first();
  const before = await visibilityButton.textContent();
  await visibilityButton.click();
  await expect(visibilityButton).not.toHaveText(before ?? "");

  await nameInput.fill("Calculation E2E");
  await page.getByRole("button", { name: "Save workspace" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await visibilityButton.click();
  await expect(visibilityButton).toHaveText(before ?? "");
});

test("seeded usage totals stay consistent across owner calculation views", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByText("$40.00").first()).toBeVisible();
  await expect(page.getByRole("table").getByText("Cursor Pro")).toBeVisible();
  await expect(page.getByRole("table").getByText("0 of 2")).toBeVisible();

  await page.goto("/tools/cursor");
  await expect(page.getByText(/Usage cost \(/)).toBeVisible();
  await expect(page.getByText("verified + estimated")).toBeVisible();
  await expect(page.getByText("$6.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust rolling period" })).toBeVisible();

  await page.goto("/tools/cursor?view=last_30_days&days=7");
  await expect(page.getByText("Usage cost (7d)")).toBeVisible();

  await page.goto("/team/e2e-developer");
  await expect(page.getByText("Verified usage").first()).toBeVisible();
  await expect(page.getByText("$5.00").first()).toBeVisible();
  await expect(page.getByText("Estimated API value").first()).toBeVisible();
  await expect(page.getByText("$2.00").first()).toBeVisible();
});

test("team member mirrors dashboard rolling and cycle filters", async ({ page }) => {
  await page.goto("/team/e2e-developer?view=last_30_days&days=7");
  await expect(page.getByText("Last 7 days").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Current cycles" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous cycles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust rolling period" })).toBeVisible();

  await page.goto("/team/e2e-developer?view=current_cycles");
  await expect(page.getByRole("link", { name: "Current cycles" })).toBeVisible();
  await expect(page.getByText("Verified usage").first()).toBeVisible();
  await expect(page.getByText("$5.00").first()).toBeVisible();

  await page.goto("/team/e2e-developer?view=previous_cycles");
  await expect(page.getByRole("link", { name: "Previous cycles" })).toBeVisible();
  await expect(page.getByText("previous billing cycles").first()).toBeVisible();
  await expect(page.getByText("Verified usage").first()).toBeVisible();
});

test("team roster lists seeded members and opens invite dialog", async ({ page }) => {
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Who's here?", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("E2E Developer").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit E2E Developer" })).toBeVisible();
  await expect(page.getByText("1 machine · 66 requests · current")).toBeVisible();
  await expect(page.getByRole("meter", { name: /Average plan use/i })).toBeVisible();
  await page.getByRole("button", { name: "Invite teammates" }).click();
  await expect(page.getByRole("heading", { name: "Invite teammates." })).toBeVisible();
  await expect(page.getByText(/Invite someone else to help you build out the workspace/i)).toBeVisible();
  await expect(page.getByLabel(/Email addresses/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy invite link|Copied/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("member hub tabs expose coding and fleet", async ({ page }) => {
  await page.goto("/team/e2e-developer");
  await expect(page.getByRole("heading", { name: "E2E Developer." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Member sections" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Member sections" }).getByRole("link", { name: "Work", exact: true }),
  ).toHaveCount(0);

  await page.goto("/team/e2e-developer/work");
  await expect(page).toHaveURL(/\/team\/e2e-developer(?:\?|$)/);

  await page.getByRole("link", { name: "Coding", exact: true }).click();
  await expect(page).toHaveURL(/\/team\/e2e-developer\/coding/);
  await expect(page.getByRole("heading", { name: "AI coding." })).toBeVisible();

  await page.getByRole("link", { name: "Fleet", exact: true }).click();
  await expect(page).toHaveURL(/\/team\/e2e-developer\/fleet/);
  await expect(page.getByRole("heading", { name: "Fleet." })).toBeVisible();
  await expect(page.getByText("e2e-laptop")).toBeVisible();
  await expect(page.getByText(/Agent 0\.1\.0/i)).toBeVisible();
  await expect(page.getByText("darwin").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Signals" })).toHaveCount(0);
});

test("onboarding resume shows workspace setup choices", async ({ page }) => {
  setOnboardingState(ownerEmail, "incomplete");
  try {
    await page.goto("/onboarding?resume=1");
    await expect(page.getByRole("heading", { name: /Welcome to Calculation E2E/i })).toBeVisible();
    await expect(page.getByText(/How do you want to get started/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect this computer/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /I’m here to manage my team|I'm here to manage my team/i })).toBeVisible();
  } finally {
    setOnboardingState(ownerEmail, "complete");
  }
});
