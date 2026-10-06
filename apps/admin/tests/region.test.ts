import { describe, expect, it } from "vitest";
import {
  analyticsHost,
  euPostHogMisconfiguration,
  isEuDeployment,
  parseDeploymentRegion,
  POSTHOG_EU_HOST,
  POSTHOG_US_HOST,
  regionSwitchUrl,
  signalsAllowed,
  signalsProductEnabled,
} from "@/lib/region";

describe("deployment region", () => {
  it("defaults to us", () => {
    expect(parseDeploymentRegion(undefined)).toBe("us");
    expect(parseDeploymentRegion("EU")).toBe("eu");
    expect(isEuDeployment({ DEPLOYMENT_REGION: "eu" } as NodeJS.ProcessEnv)).toBe(true);
    expect(signalsAllowed({ DEPLOYMENT_REGION: "eu" } as NodeJS.ProcessEnv)).toBe(false);
    expect(signalsAllowed({ DEPLOYMENT_REGION: "us" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("allows Signals only when the product flag is on and the region is not EU", () => {
    expect(signalsProductEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      signalsProductEnabled({ NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED: "true" } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      signalsAllowed({
        DEPLOYMENT_REGION: "us",
        NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      signalsAllowed({
        DEPLOYMENT_REGION: "eu",
        NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("does not bounce localhost to production region hosts", () => {
    expect(
      regionSwitchUrl("eu", "http://localhost:3001/signup?intent=team", {
        NEXT_PUBLIC_EU_APP_URL: "https://eu.usejunction.dev",
        NEXT_PUBLIC_US_APP_URL: "https://usejunction.dev",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      regionSwitchUrl("eu", "https://usejunction.dev/signup", {
        NEXT_PUBLIC_EU_APP_URL: "https://eu.usejunction.dev",
        NEXT_PUBLIC_US_APP_URL: "https://usejunction.dev",
      } as NodeJS.ProcessEnv),
    ).toBe("https://eu.usejunction.dev/signup");
  });

  it("selects the PostHog host for the region", () => {
    expect(analyticsHost({} as NodeJS.ProcessEnv)).toBe(POSTHOG_US_HOST);
    expect(analyticsHost({ DEPLOYMENT_REGION: "eu" } as NodeJS.ProcessEnv)).toBe(POSTHOG_EU_HOST);
    expect(
      analyticsHost({
        DEPLOYMENT_REGION: "eu",
        NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com/",
      } as NodeJS.ProcessEnv),
    ).toBe("https://eu.i.posthog.com");
  });

  it("rejects a US PostHog host on an EU deployment", () => {
    expect(
      euPostHogMisconfiguration({
        DEPLOYMENT_REGION: "eu",
        NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_US_HOST,
      } as NodeJS.ProcessEnv),
    ).toMatch(/EU PostHog host/);
    expect(
      euPostHogMisconfiguration({
        DEPLOYMENT_REGION: "eu",
        NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_EU_HOST,
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      euPostHogMisconfiguration({
        DEPLOYMENT_REGION: "us",
        NEXT_PUBLIC_POSTHOG_HOST: POSTHOG_US_HOST,
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
