import { expect, test as setup, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const authDir = path.join(__dirname, ".auth");
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? "owner@example.com";
const ownerPassword = process.env.E2E_OWNER_PASSWORD ?? "e2e-password";
const developerEmail = process.env.E2E_DEVELOPER_EMAIL ?? "developer@example.com";

async function authenticate(page: Page, email: string, password: string, fileName: string) {
  await page.context().addCookies([
    {
      name: "uj_consent",
      value: encodeURIComponent(
        JSON.stringify({ analytics: false, version: "2026-09-18", at: "2026-09-18T00:00:00.000Z" }),
      ),
      url: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    },
  ]);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|overview)/, { timeout: 30_000 });
  await page.context().storageState({ path: path.join(authDir, fileName) });
}

setup("authenticate owner", async ({ page }) => {
  await fs.mkdir(authDir, { recursive: true });
  await authenticate(page, ownerEmail, ownerPassword, "owner.json");
});

setup("authenticate developer", async ({ page }) => {
  await fs.mkdir(authDir, { recursive: true });
  await authenticate(page, developerEmail, ownerPassword, "developer.json");
});
