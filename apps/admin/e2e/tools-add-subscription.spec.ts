import { expect, test } from "@playwright/test";

test("Add a team tool sheet lists Codex/Work once and creates a ChatGPT subscription", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  let createBody: Record<string, unknown> | null = null;
  await page.route("**/api/tools/subscriptions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        subscription: {
          id: "e2e-chatgpt-plus",
          toolKey: "chatgpt-codex",
          catalogPlanKey: "plus",
          name: "Plus",
          tier: "Plus",
          billingCadence: "monthly",
          seatCapacity: 2,
          cycleSeatMicros: "20000000",
          estimatedCycleMicros: "40000000",
          assignedSeats: 0,
          availableSeats: 2,
          customPrice: false,
          active: true,
        },
      }),
    });
  });

  await page.goto("/tools");
  await page.getByRole("button", { name: /Add tool/i }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Add a team tool" })).toBeVisible();

  await expect(sheet.getByRole("button", { name: /ChatGPT \/ Codex/i })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Codex Work/i })).toHaveCount(0);
  await expect(sheet.getByText(/6 plans available/i).first()).toBeVisible();

  const toolCards = sheet.locator("button").filter({ hasText: /plans available/i });
  await expect(toolCards).toHaveCount(6);

  await sheet.getByRole("button", { name: /ChatGPT \/ Codex/i }).click();
  await expect(sheet.getByRole("heading", { name: /Choose a ChatGPT plan/i })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Plus\b/i })).toBeVisible();
  await expect(sheet.getByText(/Work, and Codex/i).first()).toBeVisible();

  await sheet.getByRole("button", { name: /^Plus\b/i }).click();
  await expect(sheet.getByRole("heading", { name: /Add ChatGPT/i })).toBeVisible();
  await expect(sheet.getByLabel("Seats")).toHaveValue("1");

  await sheet.getByRole("button", { name: "Add one seat" }).click();
  await expect(sheet.getByLabel("Seats")).toHaveValue("2");

  await sheet.getByRole("button", { name: /Add 2 seats/i }).click();
  await expect.poll(() => createBody).toEqual({
    toolKey: "chatgpt-codex",
    planKey: "plus",
    billingCadence: "monthly",
    seatCapacity: 2,
    usageWindowPreference: "auto",
    billingOwner: null,
    externalReference: null,
    notes: null,
  });

  await expect(sheet).toBeHidden();
  expect(pageErrors, "Add tool sheet page errors").toEqual([]);
});

test("adding ChatGPT / Codex persists through the real subscriptions API", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let createdSubscriptionId: string | null = null;

  try {
    await page.goto("/tools");
    await page.getByRole("button", { name: /Add tool/i }).first().click();

    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: /ChatGPT \/ Codex/i }).click();
    await sheet.getByRole("button", { name: /^Plus\b/i }).click();
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/tools/subscriptions",
    );
    await sheet.getByRole("button", { name: /Add 1 seat/i }).click();
    const createResponse = await createResponsePromise;
    const createPayload = (await createResponse.json()) as { subscription?: { id?: string } };
    createdSubscriptionId = createPayload.subscription?.id ?? null;

    expect(createResponse.status()).toBe(201);
    expect(createdSubscriptionId).toBeTruthy();
    await expect(sheet).toBeHidden();
    // The /tools list now shows the added subscription as a table row.
    await expect(page.getByRole("row", { name: /ChatGPT Plus/i })).toBeVisible();
    await expect(page.getByText(/1 of 1 used/i).first()).toBeVisible();
    expect(pageErrors, "persisted add page errors").toEqual([]);
  } finally {
    if (createdSubscriptionId) {
      const cleanupStatus = await page.evaluate(async (subscriptionId) => {
        const response = await fetch(`/api/tools/subscriptions/${subscriptionId}`, { method: "DELETE" });
        return response.status;
      }, createdSubscriptionId);
      expect(cleanupStatus, "archive the subscription created by this test").toBe(200);
    }
  }
});

test("Add a team tool sheet recovers from create errors without crashing", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/tools/subscriptions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "invalid subscription" }),
    });
  });

  await page.goto("/tools");
  await page.getByRole("button", { name: /Add tool/i }).first().click();

  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /^Cursor\b/i }).click();
  await sheet.getByRole("button", { name: /^Pro\b(?!\+)/i }).click();
  await sheet.getByRole("button", { name: /Add 1 seat/i }).click();

  await expect(sheet.getByRole("alert")).toContainText(/invalid subscription|Could not add/i);
  await expect(sheet.getByRole("heading", { name: /Add Cursor/i })).toBeVisible();
  expect(pageErrors, "error-path page errors").toEqual([]);
});
