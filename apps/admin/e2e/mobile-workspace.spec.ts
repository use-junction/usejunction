import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/dashboard",
  "/activity",
  "/settings",
  "/me/data",
  "/team",
  "/team/e2e-developer",
  "/team/e2e-developer/work",
  "/team/e2e-developer/coding",
  "/team/e2e-developer/fleet",
  "/tools",
  "/tools/cursor",
  "/work-spend",
  "/onboarding?resume=1",
];

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const route of routes) {
  test(`${route} fits the owner mobile viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    await expectNoPageOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("workspace navigation uses a closing mobile drawer", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "People", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "People", exact: true }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});

test("mobile dashboard uses the compact header, period picker, and KPI grid", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("link", { name: "UseJunction home" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

  const audience = page.getByRole("tablist", { name: "Audience" });
  await expect(audience).toBeVisible();
  await Promise.all([
    page.waitForURL(/scope=you/),
    audience.getByRole("tab", { name: "You" }).click(),
  ]);
  await expectNoPageOverflow(page);
  await Promise.all([
    page.waitForURL((url) => !url.searchParams.has("scope") || url.searchParams.get("scope") !== "you"),
    audience.getByRole("tab", { name: "Team" }).click(),
  ]);
  await expectNoPageOverflow(page);

  const periodPicker = page.getByRole("button", { name: "Choose reporting period" });
  await expect(periodPicker).toBeVisible();
  await periodPicker.click();
  await expect(page.getByRole("menuitem", { name: "Current cycles" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Previous cycles" })).toBeVisible();
  await page.keyboard.press("Escape");

  const people = page.locator("p").filter({ hasText: /^People$/ }).first().locator("..");
  const usage = page.locator("p").filter({ hasText: /^Estimated usage$/ }).first().locator("..");
  const spendPerDay = page.locator("p").filter({ hasText: /^Est\. spend\/day$/ }).first().locator("..");
  const [peopleBox, usageBox, spendPerDayBox] = await Promise.all([
    people.boundingBox(),
    usage.boundingBox(),
    spendPerDay.boundingBox(),
  ]);
  expect(peopleBox).not.toBeNull();
  expect(usageBox).not.toBeNull();
  expect(spendPerDayBox).not.toBeNull();
  expect(Math.abs(peopleBox!.y - usageBox!.y)).toBeLessThan(4);
  expect(usageBox!.x).toBeGreaterThan(peopleBox!.x);
  expect(spendPerDayBox!.y).toBeGreaterThan(peopleBox!.y);

  const syncStatus = page.getByText(/^Last synced/);
  const syncButton = page.getByRole("button", { name: /Sync now|Syncing/ });
  if ((await syncStatus.count()) && (await syncButton.count())) {
    const [statusBox, buttonBox] = await Promise.all([
      syncStatus.first().boundingBox(),
      syncButton.first().boundingBox(),
    ]);
    expect(statusBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(Math.abs(statusBox!.y - buttonBox!.y)).toBeLessThan(24);
  }
});

test("mobile data views expose readable cards and controls", async ({ page }) => {
  await page.goto("/tools/cursor");
  await expect(page.locator("[data-slot='mobile-data-card']").first()).toBeVisible();

  await page.goto("/team/e2e-developer/coding");
  const cards = page.locator("[data-slot='mobile-data-card']");
  if (await cards.count()) await expect(cards.first()).toBeVisible();
});

test("critical workspace routes fit at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const route of ["/dashboard", "/activity", "/team", "/tools", "/settings"]) {
    await page.goto(route);
    await expectNoPageOverflow(page);
  }
});
