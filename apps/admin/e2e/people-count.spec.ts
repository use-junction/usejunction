import { expect, test, type Page } from "@playwright/test";

/** Innermost KPI tile holding both the label and its subtitle; returns the headline number. */
async function kpiValue(page: Page, label: string, subtitle: RegExp) {
  const tile = page
    .locator("div")
    .filter({ has: page.locator("p").filter({ hasText: new RegExp(`^${label}$`, "i") }) })
    .filter({ hasText: subtitle })
    .last();
  await expect(tile).toBeVisible();
  const value = (await tile.innerText()).replace(new RegExp(`^\\s*${label}`, "i"), "").match(/\d+/);
  expect(value, `${label} tile shows a number`).not.toBeNull();
  return Number(value![0]);
}

test("Usage People matches the People roster", async ({ page }) => {
  await page.goto("/team");
  const members = await kpiValue(page, "Members", /on the roster/);

  await page.goto("/dashboard?view=current_cycles");
  const people = await kpiValue(page, "People", /\d+ active · /);
  expect(people).toBe(members);

  const active = Number((await page.getByText(/^\d+ active · /).first().innerText()).match(/^\d+/)![0]);
  expect(active).toBeLessThanOrEqual(people);
});
