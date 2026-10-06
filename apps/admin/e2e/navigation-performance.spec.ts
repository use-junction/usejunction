import { expect, test, type Page, type Response } from "@playwright/test";

const enabled = process.env.E2E_NAV_BENCHMARK === "1";
const routeSequence = [
  { href: "/team", link: "Team", heading: "Who's here?" },
  { href: "/activity", link: "Adoption", heading: "Adoption." },
  { href: "/dashboard", link: "Coverage", heading: "What's reporting?" },
] as const;

function percentile(samples: number[], percentileValue: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentileValue) - 1] ?? 0;
}

async function clickToHeading(page: Page, link: string, href: string, heading: string) {
  const started = performance.now();
  await page.getByRole("link", { name: link, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${href.replace("/", "\\/")}(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  return performance.now() - started;
}

test.skip(!enabled, "Set E2E_NAV_BENCHMARK=1 against an authenticated preview deployment.");

test("dashboard → Team → Activity → dashboard navigation meets warm-cache targets", async ({
  page,
}, testInfo) => {
  const rscDurations: number[] = [];
  const apiTimings: Array<{ url: string; serverTiming: string }> = [];
  const requestStarts = new Map<string, number>();

  page.on("request", (request) => {
    if (request.url().includes("_rsc=")) requestStarts.set(request.url(), performance.now());
  });
  page.on("response", async (response: Response) => {
    const started = requestStarts.get(response.url());
    if (started !== undefined) rscDurations.push(performance.now() - started);
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/app/")) {
      apiTimings.push({
        url: `${url.pathname}${url.search}`,
        serverTiming: (await response.allHeaders())["server-timing"] ?? "",
      });
    }
  });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "What's reporting?" })).toBeVisible();

  // Warm all destination page-data queries using the same interactions users
  // make before a click, then measure three cached navigation loops.
  for (const destination of routeSequence) {
    await page.getByRole("link", { name: destination.link, exact: true }).hover();
  }
  await page.waitForTimeout(500);

  const clickToHeadingDurations: number[] = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (const destination of routeSequence) {
      clickToHeadingDurations.push(
        await clickToHeading(
          page,
          destination.link,
          destination.href,
          destination.heading,
        ),
      );
    }
  }

  const results = {
    clickToHeadingDurations,
    clickToHeadingP75: percentile(clickToHeadingDurations, 0.75),
    rscDurations,
    rscP75: percentile(rscDurations, 0.75),
    apiTimings,
  };
  await testInfo.attach("navigation-performance.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  expect(results.clickToHeadingP75).toBeLessThan(300);
  expect(apiTimings.every((timing) => timing.serverTiming.length > 0)).toBe(true);
});
