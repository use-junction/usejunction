import { expect, test } from "@playwright/test";

test("Add a team tool sheet lists OpenCode with Zen and multi-provider plans", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/tools");
  await page.getByRole("button", { name: /Add tool/i }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: /OpenCode/i })).toBeVisible();
  await expect(sheet.getByText(/2 plans available/i).first()).toBeVisible();

  await sheet.getByRole("button", { name: /OpenCode/i }).click();
  await expect(sheet.getByRole("heading", { name: /Choose an? OpenCode plan/i })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Zen\b/i })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Multi-provider/i })).toBeVisible();

  expect(pageErrors, "OpenCode add-tool sheet page errors").toEqual([]);
});
