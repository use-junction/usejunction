import { expect, test } from "@playwright/test";
import { setOnboardingState } from "./onboarding-state";

const developerEmail = process.env.E2E_DEVELOPER_EMAIL ?? "developer@example.com";

test("developer calculation views use personal usage totals", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Usage." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current cycles." })).toBeVisible();
  await expect(page.getByRole("row", { name: /Cursor gpt-4\.1 10 .*\$6\.00 Verified/i })).toBeVisible();
  await expect(page.getByRole("row", { name: /OpenCode opencode-go\/kimi-k2\.7-code/i })).toBeVisible();

  await page.goto("/activity");
  await expect(page.getByRole("heading", { level: 1, name: "How are you using it?" })).toBeVisible();
  await expect(page.getByText("Requests").first()).toBeVisible();
  await expect(page.getByText("10").first()).toBeVisible();

  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "What are you paying for?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your tools." })).toBeVisible();
  await expect(page.getByText("Active tools")).toBeVisible();
  await expect(page.getByText("Total tokens")).toBeVisible();
  await expect(page.getByText("Most active tool")).toBeVisible();
  await expect(page.locator("main").getByRole("heading", { name: "Cursor", exact: true })).toBeVisible();
  await expect(page.locator("main").getByRole("heading", { name: "OpenCode", exact: true })).toBeVisible();
});

test("developer chrome hides owner-only navigation", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Coverage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cost", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Adoption", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "People" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Signals" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing settings" })).toHaveCount(0);
  // Developers stay personal-only — no Team | You audience switcher.
  await expect(page.getByRole("tablist", { name: "Audience" })).toHaveCount(0);

  await page.goto("/activity");
  await expect(page.getByRole("tablist", { name: "Audience" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings." })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Audience" })).toHaveCount(0);

  await page.goto("/reports/daily");
  await expect(page).toHaveURL(/\/activity/);
  await expect(page.getByRole("heading", { name: "Reports." })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Audience" })).toHaveCount(0);
});

test("developer is redirected from owner-only calculation routes", async ({ page }) => {
  for (const route of [
    "/team",
    "/team/e2e-developer",
    "/signals",
    "/signals/activity?days=30",
    "/signals/settings",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/dashboard/);
  }
});

test("developer can open tool detail by default", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "Your tools." })).toBeVisible();

  await page.goto("/tools/cursor");
  await expect(page).not.toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /cursor/i }).first()).toBeVisible();
});

test("developer onboarding resume opens connect flow", async ({ page }) => {
  setOnboardingState(developerEmail, "incomplete");
  try {
    await page.goto("/onboarding?resume=1");
    await expect(
      page.getByText(/e2e-laptop is live|Connect this computer|Connect command|Device enrolled|Connected/i).first(),
    ).toBeVisible();
  } finally {
    setOnboardingState(developerEmail, "complete");
  }
});
