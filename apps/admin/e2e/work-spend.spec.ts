import { expect, test, type Page } from "@playwright/test";
import { projectDistribution, projectInspection, projectLinkedPayload, projectLinkedFeed, workDetails, repositoryTrend, projectTrend, personTrend, peopleSpend } from "../tests/fixtures/work-spend";

const titles = ["Add team invitations", "Fix repeated webhook deliveries", "Improve sign-in error messages", "Update repository permission checks", "Add invoice download", "Document the local setup"];
const states = ["MERGED", "OPEN", "OPEN", "MERGED", "OPEN", "CLOSED"] as const;
const workStates = ["shipped", "in_flight", "in_flight", "shipped", "stalled", "stalled"] as const;
const populated = {
  items: titles.map((title, i) => ({
    ...projectLinkedFeed.items[0],
    id: `fixture-${i}`, workId: `fixture-${i}`, title, state: states[i], workState: workStates[i],
    activityAt: `2026-09-${24 - i}T10:00:00Z`, commitCount: i === 5 ? 0 : 1,
    verifiedMicros: ["1500000", "1000000", "900000", "600000", "600000", "400000"][i],
    estimatedMicros: ["500000", "500000", "300000", "300000", "200000", "200000"][i],
  })),
  totalCount: titles.length, nextCursor: null,
};
const envelope = (data: unknown) => ({ data, meta: { generatedAt: new Date().toISOString(), requestId: "work-spend-ui-fixture" } });

type ProjectMode = "wi_order" | "named_only";

async function fixture(page: Page, options: { project?: typeof projectInspection; onPatch?: (mode: ProjectMode) => typeof projectInspection | void } = {}) {
  let project = options.project ?? projectInspection;
  await page.route("**/api/app/work-spend**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/work-spend/projects/") && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { attributionMode?: ProjectMode };
      const mode = body.attributionMode === "named_only" ? "named_only" : "wi_order";
      project = options.onPatch?.(mode) ?? { ...project, attributionMode: mode };
      return route.fulfill({ json: envelope({ attributionMode: mode }) });
    }
    if (url.pathname.endsWith("/details")) return route.fulfill({ json: envelope(workDetails) });
    if (url.pathname.includes("/work-spend/projects/")) return route.fulfill({ json: envelope(project) });
    if (url.pathname.endsWith("/distribution")) return route.fulfill({ json: envelope(projectDistribution) });
    if (url.pathname.endsWith("/people")) return route.fulfill({ json: envelope(peopleSpend) });
    if (url.pathname.endsWith("/trend")) {
      const by = url.searchParams.get("by");
      return route.fulfill({ json: envelope(by === "project" ? projectTrend : by === "person" ? personTrend : repositoryTrend) });
    }
    if (url.pathname.endsWith("/export")) return route.fulfill({ status: 200, body: "title,repository\n", headers: { "content-type": "text/csv" } });
    if (url.pathname.endsWith("/work")) {
      const workState = url.searchParams.get("workState");
      const projectId = url.searchParams.get("projectId");
      const developerId = url.searchParams.get("developerId");
      let items = populated.items;
      if (workState) items = items.filter((item) => item.workState === workState);
      if (projectId === "__none__") items = items.filter((item) => !item.projectLinks.length);
      else if (projectId) items = items.filter((item) => item.projectLinks.some((link) => link.projectId === projectId));
      if (developerId === "dev-a") items = items.filter((_, i) => i < 3);
      else if (developerId === "dev-b") items = items.filter((_, i) => i >= 3);
      return route.fulfill({ json: envelope({ items, totalCount: items.length, nextCursor: null }) });
    }
    return route.fulfill({ json: envelope(projectLinkedPayload) });
  });
}

for (const width of [1440, 390]) {
  test(`allocated overview at ${width}px with state cards, sheet focus, and no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await fixture(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/work-spend");
    await expect(page.getByRole("heading", { name: "What did it produce?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spend by project." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spend by person." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By repository." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Commit types." })).toBeVisible();
    await expect(page.getByText("3 items · 70% of recorded")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Integrations/ })).toBeVisible();
    await page.getByRole("button", { name: "More options" }).click();
    await expect(page.getByRole("menuitem", { name: /Export CSV/ })).toBeVisible();
    await page.keyboard.press("Escape");
    const shipped = page.getByRole("button", { name: /Merged · 1/i });
    await expect(shipped).toBeVisible();
    await expect(page.getByRole("button", { name: /Open · 1/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Not moving · 1/i })).toBeVisible();
    const row = page.getByRole("button", { name: /Add team invitations, \$2\.00/ });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/work-spend-${width}.png`, fullPage: true });
    await row.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Add team invitations" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("feat: create invitation flow ↗")).toBeVisible();
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    if (width === 390) expect((await sheet.boundingBox())?.width).toBe(390);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(row).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("clicking a state card filters the top work list", async ({ page }) => {
  await fixture(page);
  await page.goto("/work-spend");
  await page.getByRole("button", { name: /Merged · 1/i }).click();
  await expect(page).toHaveURL(/workState=shipped/);
  const list = page.getByRole("region", { name: "Work that received the most AI cost" });
  await expect(list.getByText(/Merged work/)).toBeVisible();
  await expect(list.getByRole("button", { name: /Add team invitations, \$2\.00/ })).toBeVisible();
  await expect(list.getByRole("button", { name: /Fix repeated webhook deliveries/ })).toHaveCount(0);
});

test("clicking a person on the dollar plot filters biggest items", async ({ page }) => {
  await fixture(page);
  await page.goto("/work-spend");
  await page.getByRole("button", { name: /Ada Fixture · \$1\.80/ }).click();
  await expect(page).toHaveURL(/developerId=dev-a/);
  await expect(page).toHaveURL(/trendBy=person/);
  const list = page.getByRole("region", { name: "Work that received the most AI cost" });
  await expect(list.getByText(/Ada Fixture/)).toBeVisible();
  await expect(list.getByRole("button", { name: /Add team invitations, \$2\.00/ })).toBeVisible();
});

test("clicking a project spend segment filters biggest items", async ({ page }) => {
  await fixture(page);
  await page.goto("/work-spend");
  await page.getByRole("button", { name: /Product roadmap · Merged · \$2\.50/ }).click();
  await expect(page).toHaveURL(/projectId=project-roadmap/);
  await expect(page).toHaveURL(/workState=shipped/);
  const list = page.getByRole("region", { name: "Work that received the most AI cost" });
  await expect(list.getByText(/Product roadmap/).first()).toBeVisible();
});

test("clicking a project title opens spend, tasks, and pull requests", async ({ page }) => {
  await fixture(page);
  await page.goto("/work-spend");
  await page.getByRole("button", { name: "Product roadmap", exact: true }).click();
  await expect(page).toHaveURL(/projectView=project-roadmap/);
  await expect(page.getByRole("heading", { name: "Product roadmap" })).toBeVisible();
  await expect(page.getByText("AI spend · last 90 days")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it produced" })).toBeVisible();
  await expect(page.getByText("Merged PRs")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add team invitations, $4.00" })).toBeVisible();
  await expect(page.getByText("Unmatched board issue")).toHaveCount(0);
  await page.getByRole("button", { name: /\+1 more task/ }).click();
  await expect(page.getByText("Unmatched board issue")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pull requests and commits/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "All 2" })).toBeVisible();
  await page.getByText("How spend is placed on tasks").click();
  await expect(page.getByText(/Commits that name no issue are spread across 2 WI tasks in date order/)).toBeVisible();
  await page.getByRole("button", { name: "Add team invitations, $4.00" }).click();
  const why = page.getByRole("dialog", { name: "Add team invitations" });
  await expect(why).toBeVisible();
  await expect(why.getByRole("heading", { name: "Why $4.00" })).toBeVisible();
  await expect(why.getByText("pull request says #123")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(why).toBeHidden();
  await page.getByRole("button", { name: "Spend overview" }).click();
  await expect(page.getByRole("heading", { name: "Spend by project." })).toBeVisible();
});

test("how we split this switches unnamed commits off tasks", async ({ page }) => {
  const estimated = {
    ...projectInspection,
    methodMicros: { named: "1000000", wiOrder: "3000000", untasked: "0" },
  };
  await fixture(page, {
    project: estimated,
    onPatch: (mode) => mode === "named_only"
      ? { ...estimated, attributionMode: "named_only", methodMicros: { named: "1000000", wiOrder: "0", untasked: "3000000" } }
      : estimated,
  });
  await page.goto("/work-spend?projectView=project-roadmap");
  await expect(page.getByRole("heading", { name: "Product roadmap" })).toBeVisible();
  await page.getByRole("button", { name: "How we split this" }).click();
  await expect(page.getByText("$3.00 would move to Not on a task.")).toBeVisible();
  await page.getByRole("menuitemradio", { name: /Only work that names an issue/ }).click();
  await page.getByText("How spend is placed on tasks").click();
  await expect(page.getByText(/Only commits and pull requests that name an issue are on tasks/)).toBeVisible();
});

test("project work list filters by outcome", async ({ page }) => {
  await fixture(page);
  await page.goto("/work-spend?projectView=project-roadmap");
  await expect(page.getByRole("button", { name: "Invitation flow, $4.00" })).toBeVisible();
  await page.getByRole("radio", { name: "Open 1" }).click();
  await expect(page.getByRole("button", { name: "Commit a1b2c3d, $0.50" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invitation flow, $4.00" })).toHaveCount(0);
});

test("chart tabs, see all work, and cancelling disconnect make no mutation", async ({ page }) => {
  await fixture(page);
  const mutations: string[] = [];
  await page.route("**/api/app/features/**", async (route) => {
    if (route.request().method() !== "GET") mutations.push(route.request().url());
    return route.abort();
  });
  await page.goto("/work-spend");
  await expect(page.getByRole("heading", { name: "Spend by week." })).toBeVisible();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/trendBy=project/);
  await expect(page.getByText(/Work on two projects counts in both/)).toBeVisible();
  await page.getByRole("button", { name: "See all work" }).click();
  await expect(page).toHaveURL(/explore=1/);
  await expect(page.getByRole("searchbox", { name: "Search work" })).toBeVisible();
  await page.getByRole("button", { name: "Spend overview" }).click();
  await expect(page.getByRole("heading", { name: "Biggest items." })).toBeVisible();
  await page.getByRole("button", { name: /Integrations/ }).click();
  await expect(page.getByRole("dialog", { name: "Integrations" })).toBeVisible();
  await page.getByRole("button", { name: /^Disconnect fixture-org…$/ }).click();
  await expect(page.getByRole("dialog", { name: "Disconnect fixture-org?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(mutations).toEqual([]);
});
