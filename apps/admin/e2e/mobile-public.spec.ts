import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/blog",
  "/blog/what-is-ai-coding-observability",
  "/authors/dinuda-yaggahavita",
  "/guides",
  "/guides/see-plan-usage-and-waste",
  "/compare",
  "/compare/wakatime",
  "/for",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password?token=invalid",
  "/contact",
  "/privacy",
  "/terms",
  "/i/invalid-token",
  "/join/invalid-token",
  "/join/company/missing-org",
];

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const route of routes) {
  test(`${route} fits a mobile viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    await expectNoPageOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("public mobile navigation opens, navigates, and closes", async ({ page }) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Open menu" });
  await menuButton.click();
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "Pricing", exact: true }).click();
  await expect(page.locator("#pricing")).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
});

test("homepage pictures read on a phone", async ({ page }) => {
  await page.goto("/");

  // Each note sits right under what it is about, with its arrow pointing up at it; the comparison is one block per question.
  const weeks = page.getByRole("region", { name: "You’ve probably had one of these weeks." });
  const below = async (note: string, target: import("@playwright/test").Locator) => {
    const pin = page.locator(".home-note-pin").filter({ hasText: note });
    await expect(pin).toBeVisible();
    await expect(pin.locator("svg")).toBeVisible();
    // The arrow starts under the target and reaches up close to it.
    const [arrowBox, targetBox] = [(await pin.locator("svg").boundingBox())!, (await target.boundingBox())!];
    expect(arrowBox.y).toBeGreaterThan(targetBox.y + targetBox.height - 4);
    expect(arrowBox.y - (targetBox.y + targetBox.height)).toBeLessThan(64);
  };
  await below("Move her to Premium", weeks.getByText("97%"));
  await below("Does Elena still need hers?", weeks.getByText("6%", { exact: true }));
  await below("57% landed on work that merged", page.getByText("$35,120").filter({ visible: true }));
  await below("$9,220 in, and it stopped", page.getByText("Not moving", { exact: true }).filter({ visible: true }).first());
  await below("Cancel nine Cursor seats by 14 Dec", page.getByText("$360", { exact: true }));
  await below("24 paid, 15 using. Decide by 14 Dec.", page.getByRole("figure", { name: /cost\.csv/ }).getByRole("cell", { name: "15", exact: true }));
  // The notes placed over the pictures on desktop are not shown here.
  await expect(page.locator(".home-note:not(.home-note-pin)").filter({ visible: true })).toHaveCount(0);

  // Paid twice is one small table: a Claude column in use, a Cursor column that is not.
  const paidTwice = page.getByRole("figure", { name: /hold a Claude seat and a Cursor seat/ });
  const priya = paidTwice.getByRole("listitem").filter({ hasText: "Priya Natarajan" });
  await expect(priya.getByText("In use")).toBeVisible();
  await expect(priya.getByText("No usage")).toBeVisible();
  // Side by side on one line, Claude first.
  const [inUse, noUsage] = [(await priya.getByText("In use").boundingBox())!, (await priya.getByText("No usage").boundingBox())!];
  expect(Math.abs(inUse.y + inUse.height / 2 - (noUsage.y + noUsage.height / 2))).toBeLessThan(6);
  expect(noUsage.x).toBeGreaterThan(inUse.x);

  const compare = page.getByRole("region", { name: "Four tabs open, and you’re still guessing." });
  await expect(compare.getByRole("table")).toHaveCount(0);
  await expect(compare.getByRole("heading", { name: "Who is about to hit a limit?" })).toBeVisible();
  await expect(compare.getByRole("listitem").filter({ hasText: "Who is about to hit a limit?" }).getByText("Priya, 97%")).toBeVisible();
  // What the four tools' own pages give you is one plain line, not four marks to decode.
  await expect(compare.getByRole("listitem").filter({ hasText: "Where will this month’s bill land?" }).getByText("Four separate bills, and no total")).toBeVisible();
  await expect(compare.getByText("Own bill").filter({ visible: true })).toHaveCount(0);
  await expect(compare.getByRole("button", { name: /Amara/ }).filter({ visible: true })).toContainText("Amara");
  const sprint = compare.getByRole("listitem").filter({ hasText: "What will the next feature cost?" });
  await expect(sprint.getByText("SSO login, about $5,400")).toBeVisible();
  await sprint.getByRole("button", { name: /Tom/ }).click();
  await expect(sprint.getByText("Tom, about $1,100")).toBeVisible();

  // The cell the finance note is about fits the screen without scrolling the sheet sideways.
  const sheet = page.getByRole("figure", { name: /cost\.csv/ });
  const marked = await sheet.getByRole("cell", { name: "15", exact: true }).boundingBox();
  expect(marked!.x + marked!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(sheet.getByRole("cell", { name: "Plans" })).toBeHidden();

  await expectNoPageOverflow(page);
});

test("critical public flows fit at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const route of ["/", "/login", "/signup", "/contact"]) {
    await page.goto(route);
    await expectNoPageOverflow(page);
  }
});
