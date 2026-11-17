import { expect, test, type APIRequestContext } from "@playwright/test";
import path from "node:path";

/**
 * The browser half of the one-command install: the terminal prints a link,
 * and this page turns it into a connected device. Approving is covered against
 * the database in tests/device-auth.integration.test.ts; here nothing is
 * connected, so the seeded workspace keeps its device counts.
 */

async function startRequest(request: APIRequestContext, hostname: string) {
  const response = await request.post("/api/device-auth/start", {
    data: { hostname, os: "darwin", architecture: "arm64", agentVersion: "0.9.0" },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { deviceCode: string; userCode: string; verificationUrl: string };
  return { ...body, path: `/connect?code=${body.userCode}` };
}

async function pollStatus(request: APIRequestContext, deviceCode: string) {
  const response = await request.post("/api/device-auth/poll", { data: { deviceCode } });
  return ((await response.json()) as { status: string }).status;
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the link from the terminal asks for an account and keeps the code through sign-in", async ({ page, request }) => {
    const started = await startRequest(request, "signed-out-laptop");
    expect(started.verificationUrl.endsWith(started.path)).toBe(true);

    await page.goto(started.path);
    await expect(page.getByRole("heading", { name: "Connect this device." })).toBeVisible();
    await expect(page.getByText(started.userCode)).toBeVisible();
    // The machine's name is shown only after sign-in.
    await expect(page.getByText("signed-out-laptop")).toHaveCount(0);

    const returnTo = encodeURIComponent(started.path);
    await expect(page.getByRole("link", { name: "Create account" })).toHaveAttribute("href", `/signup?from=${returnTo}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?from=${returnTo}`);
  });

  test("without a code the page asks for the one the terminal printed", async ({ page }) => {
    await page.goto("/connect");
    await expect(page.getByRole("heading", { name: "Connect a device." })).toBeVisible();
    await page.getByLabel("Code").fill("kqrt");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/Enter the 8-letter code/)).toBeVisible();
  });
});

test("an owner sees which machine is asking and what it will collect", async ({ page, request }) => {
  const started = await startRequest(request, "owner-laptop.local");

  await page.goto(started.path);
  await expect(page.getByRole("heading", { name: "Connect this device?" })).toBeVisible();
  await expect(page.getByText("owner-laptop.local")).toBeVisible();
  await expect(page.getByText("macOS")).toBeVisible();
  await expect(page.getByText(started.userCode)).toBeVisible();
  await expect(page.getByText("Never collected")).toBeVisible();
  await expect(page.getByText("Source code or file contents")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect this device" })).toBeEnabled();

  // Looking is not approving.
  expect(await pollStatus(request, started.deviceCode)).toBe("pending");
});

test("a code nobody issued is called out", async ({ page }) => {
  await page.goto("/connect?code=ZZZZ-ZZZZ");
  await expect(page.getByRole("heading", { name: "This code isn’t valid." })).toBeVisible();
});

test.describe("someone who already has a device", () => {
  test.use({ storageState: path.join(__dirname, ".auth", "developer.json") });

  test("cannot connect a second one, and refusing tells the terminal", async ({ page, request }) => {
    const started = await startRequest(request, "second-laptop.local");

    await page.goto(started.path);
    await expect(page.getByRole("heading", { name: "Connect this device?" })).toBeVisible();
    await expect(page.getByText("You already have a device connected in this workspace.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect this device" })).toBeDisabled();

    await page.getByRole("button", { name: "This isn’t my device" }).click();
    await expect(page.getByRole("heading", { name: "Request refused." })).toBeVisible();
    expect(await pollStatus(request, started.deviceCode)).toBe("denied");
  });
});
