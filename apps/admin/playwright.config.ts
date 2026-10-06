import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// Keep Playwright, its seed script, and the inherited Next.js dev server on the
// same monorepo-root environment. Next would otherwise auto-load apps/admin/.env
// after the seed has populated the root test database.
loadEnvConfig(path.join(__dirname, "../.."));

const authDir = path.join(__dirname, "e2e", ".auth");

/** Keep the Playwright-managed dev server on the same DB/auth env as seed + tests (CI has no .env file). */
function definedEnv(entries: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

const forceDedicatedServer = Boolean(process.env.E2E_FORCE_WEB_SERVER);
const e2ePort = process.env.E2E_PORT ?? (forceDedicatedServer ? "3011" : "3001");
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;

const webServerEnv = definedEnv({
  DATABASE_URL: process.env.DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "ci-test-secret",
  AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "ci-test-secret",
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? "true",
  E2E_AS_OF: process.env.E2E_AS_OF ?? "2026-07-16T12:00:00.000Z",
  E2E_OWNER_EMAIL: process.env.E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD: process.env.E2E_OWNER_PASSWORD,
  E2E_DEVELOPER_EMAIL: process.env.E2E_DEVELOPER_EMAIL,
  DEPLOYMENT_REGION: process.env.DEPLOYMENT_REGION ?? "us",
  NEXT_PUBLIC_DEPLOYMENT_REGION: process.env.NEXT_PUBLIC_DEPLOYMENT_REGION ?? process.env.DEPLOYMENT_REGION ?? "us",
  // Workspace e2e asserts the shipped product: Signals routes stay hidden.
  // Do not inherit a host/CI `true` or `/signals` will render instead of redirecting.
  NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED: "false",
  PORT: e2ePort,
  ...(forceDedicatedServer ? { NEXT_DIST_DIR: ".next-e2e" } : {}),
});

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: forceDedicatedServer
          ? `pnpm exec next dev --turbopack --port ${e2ePort}`
          : "pnpm dev",
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI && !forceDedicatedServer,
        timeout: 120_000,
        env: webServerEnv,
      },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "public",
      testMatch: /(?:^|\/)public\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(authDir, "owner.json"),
      },
      testIgnore: [/.*\.setup\.ts$/, /(?:^|\/)developer\.spec\.ts$/, /(?:^|\/)public\.spec\.ts$/, /mobile-.*\.spec\.ts$/],
    },
    {
      name: "developer",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(authDir, "developer.json"),
      },
      testMatch: /(?:^|\/)developer\.spec\.ts$/,
    },
    {
      name: "mobile-public",
      testMatch: /mobile-public\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: "mobile-owner",
      dependencies: ["setup"],
      testMatch: /mobile-workspace\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        storageState: path.join(authDir, "owner.json"),
      },
    },
    {
      name: "mobile-developer",
      dependencies: ["setup"],
      testMatch: /mobile-developer\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        storageState: path.join(authDir, "developer.json"),
      },
    },
  ],
});
