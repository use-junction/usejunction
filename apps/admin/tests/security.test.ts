import assert from "node:assert/strict";
import { test } from "vitest";
import { constantTimeHashMatch, decryptSecret, encryptSecret, hashOpaqueToken } from "../lib/security";
import { assertSecureProductionEnv, validateHttpsUnlessLoopback } from "../lib/security/env-guard";

test("integration credentials round-trip through authenticated encryption", () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptSecret("key_super_secret");
  assert.notEqual(encrypted, "key_super_secret");
  assert.equal(decryptSecret(encrypted), "key_super_secret");
});

test("opaque token comparisons operate on fixed length hashes", () => {
  const hash = hashOpaqueToken("uj_token_value");
  assert.equal(constantTimeHashMatch("uj_token_value", hash), true);
  assert.equal(constantTimeHashMatch("wrong", hash), false);
});

const secureProductionEnv = {
  NODE_ENV: "production",
  AUTH_SECRET: "a".repeat(32),
  INGEST_SECRET: "b".repeat(32),
  CRON_SECRET: "c".repeat(32),
  AGENT_RELEASE_OPERATIONS_TOKEN: "d".repeat(32),
  ABLY_API_KEY: "ably-key:" + "e".repeat(32),
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
  NEXTAUTH_URL: "https://app.example.com",
} as NodeJS.ProcessEnv;

test("production env guard rejects insecure defaults", () => {
  assert.throws(() => assertSecureProductionEnv({
    NODE_ENV: "production",
    AUTH_SECRET: "change-me-in-production",
    INGEST_SECRET: "change-me-ingest-secret",
    CRON_SECRET: "development-cron",
    AGENT_RELEASE_OPERATIONS_TOKEN: "short",
    USEJUNCTION_ALLOW_INSECURE_DEVELOPMENT: "true",
  } as NodeJS.ProcessEnv), /Insecure production configuration/);
});

test("production env guard rejects partial Lemon billing configuration", () => {
  assert.throws(
    () =>
      assertSecureProductionEnv({
        ...secureProductionEnv,
        LEMONSQUEEZY_API_KEY: "x".repeat(32),
      }),
    /LEMONSQUEEZY_WEBHOOK_SECRET/,
  );
});

test("production env guard accepts complete Lemon billing configuration", () => {
  assert.doesNotThrow(() =>
    assertSecureProductionEnv({
      ...secureProductionEnv,
      LEMONSQUEEZY_API_KEY: "x".repeat(32),
      LEMONSQUEEZY_WEBHOOK_SECRET: "w".repeat(32),
      LEMONSQUEEZY_STORE_ID: "12345",
      LEMONSQUEEZY_VARIANT_ID_TEAM: "67890",
    }),
  );
});

test("production env guard rejects a US PostHog host on an EU deployment", () => {
  assert.throws(
    () =>
      assertSecureProductionEnv({
        ...secureProductionEnv,
        DEPLOYMENT_REGION: "eu",
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
        NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
      }),
    /EU PostHog host/,
  );
});

test("remote HTTP URLs are rejected while loopback HTTP is allowed", () => {
  assert.equal(validateHttpsUnlessLoopback("APP", "http://127.0.0.1:3001"), null);
  assert.equal(validateHttpsUnlessLoopback("APP", "https://app.example.com"), null);
  assert.match(validateHttpsUnlessLoopback("APP", "http://192.168.1.10:3001") ?? "", /HTTPS/);
});
