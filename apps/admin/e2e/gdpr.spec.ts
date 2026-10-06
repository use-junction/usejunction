import { expect, test } from "@playwright/test";
import path from "node:path";

test.describe("cookie banner and signup acceptance", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("cookie banner records a choice", async ({ page }) => {
    await page.goto("/signup");
    const banner = page.getByRole("dialog", { name: "Cookie consent" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Necessary only" }).click();
    await expect(banner).toHaveCount(0);
  });

  test("signup requires terms and privacy acceptance", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("dialog", { name: "Cookie consent" }).getByRole("button", { name: "Necessary only" }).click();
    await page.getByLabel("Full name").fill("Casey Example");
    await page.getByLabel("Work email").fill("casey@example.com");
    await page.getByLabel("Password", { exact: true }).fill("super-secret-12");
    await page.getByLabel("Confirm password").fill("super-secret-12");
    await expect(page.getByRole("button", { name: /Create account/ })).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: /Create account/ })).toBeEnabled();
  });
});

test.describe("developer data subject view", () => {
  test.use({ storageState: path.join(__dirname, ".auth", "developer.json") });

  test("My data loads once and exposes collection, export, and erasure", async ({ page }) => {
    const dataRequests: string[] = [];
    const accountGets: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/app/me/data") dataRequests.push(`${request.method()} ${url.pathname}`);
      if (url.pathname === "/api/app/me/accounts" && request.method() === "GET") {
        accountGets.push(url.pathname);
      }
    });

    await page.goto("/me/data");
    await expect(page.getByRole("heading", { name: "What do we hold?" })).toBeVisible();
    await expect(page.getByRole("region", { name: "At a glance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tool logins" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your rights" })).toBeVisible();
    await expect(page.getByText(/A complete machine-readable copy/i)).toBeVisible();
    await expect(page.getByText(/usage kept 3 years/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download export" })).toBeVisible();
    await expect(page.getByRole("link", { name: "GDPR" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Work sessions uploaded" })).toHaveCount(0);
    await expect(page.getByText("Ship onboarding polish")).toHaveCount(0);
    await expect(page.getByText(/recently tracked/i)).toHaveCount(0);

    expect(dataRequests.filter((entry) => entry.startsWith("GET ")).length).toBeLessThanOrEqual(2);
    // Workspace chrome may GET pending accounts for the new-tool banner (Strict Mode can remount).
    expect(accountGets.length).toBeLessThanOrEqual(2);

    const usage = page.getByRole("switch", { name: /OpenCode .* — Usage/ });
    await expect(usage).toBeVisible();
    const wasChecked = await usage.isChecked();
    await usage.focus();
    await page.keyboard.press("Space");
    await expect(usage).toBeChecked({ checked: !wasChecked });
    await usage.press("Space");
    await expect(usage).toBeChecked({ checked: wasChecked });

    await page.getByRole("button", { name: "Request erasure" }).click();
    await expect(page.getByRole("dialog", { name: "Request erasure?" })).toBeVisible();
    await expect(page.getByText(/30 days/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Request erasure?" })).toHaveCount(0);

    if ((process.env.DEPLOYMENT_REGION ?? process.env.NEXT_PUBLIC_DEPLOYMENT_REGION) === "eu") {
      await expect(page.getByText(/EU · usage kept 3 years/)).toBeVisible();
    }
  });
});

test("Settings hides the Signals product card", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "How is this set up?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signals", level: 2 })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Work extraction" })).toHaveCount(0);
});
