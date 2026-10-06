import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { jsonSafe } from "@/lib/api/app-response";
import { browserMutationGuard } from "@/lib/security/http";
import { appApiSuccessSchema, memberSectionSchema } from "@/lib/api/contracts";
import { isPublicPath } from "@/auth.config";

describe("app API serialization", () => {
  it("serializes dates and bigint values without leaking server-only types", () => {
    expect(jsonSafe({ at: new Date("2026-07-21T00:00:00.000Z"), value: 42n })).toEqual({
      at: "2026-07-21T00:00:00.000Z",
      value: "42",
    });
  });

  it("validates the stable response envelope and query enums", () => {
    expect(appApiSuccessSchema.parse({
      data: { ok: true },
      meta: { generatedAt: "2026-07-21T00:00:00.000Z", requestId: "request-1" },
    }).data).toEqual({ ok: true });
    expect(memberSectionSchema.catch("overview").parse("invalid")).toBe("overview");
  });
});

describe("app API middleware boundary", () => {
  it("lets page-data handlers return JSON auth errors while UI routes stay protected", () => {
    expect(isPublicPath("/api/app/workspace-context")).toBe(true);
    expect(isPublicPath("/api/app/team/developer-1")).toBe(true);
    expect(isPublicPath("/api/integrations/github/callback")).toBe(true);
    expect(isPublicPath("/api/integrations/github/connect")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
  });
});

describe("browser mutation guard", () => {
  const production = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it("accepts same-origin JSON mutations", () => {
    const request = new NextRequest("https://usejunction.dev/api/example", {
      method: "POST",
      headers: { origin: "https://usejunction.dev", host: "usejunction.dev", "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "{}",
    });
    expect(browserMutationGuard(request, production)).toBeNull();
  });

  it("rejects cross-origin mutations", () => {
    const request = new NextRequest("https://usejunction.dev/api/example", {
      method: "POST",
      headers: { origin: "https://attacker.example", host: "usejunction.dev", "content-type": "application/json" },
      body: "{}",
    });
    expect(browserMutationGuard(request, production)?.status).toBe(403);
  });

  it("rejects non-JSON cookie-authenticated mutations", () => {
    const request = new NextRequest("https://usejunction.dev/api/example", {
      method: "POST",
      headers: {
        origin: "https://usejunction.dev",
        host: "usejunction.dev",
        "content-type": "text/plain",
        "content-length": "1",
        "sec-fetch-site": "same-origin",
      },
      body: "x",
    });
    expect(browserMutationGuard(request, production)?.status).toBe(415);
  });

  it("allows mutations without a request body", () => {
    const request = new NextRequest("https://usejunction.dev/api/example", {
      method: "DELETE",
      headers: {
        origin: "https://usejunction.dev",
        host: "usejunction.dev",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(browserMutationGuard(request, production)).toBeNull();
  });

  it("requires an explicit same-origin browser header", () => {
    const request = new NextRequest("https://usejunction.dev/api/example", {
      method: "POST",
      headers: { origin: "https://usejunction.dev", host: "usejunction.dev", "content-type": "application/json" },
      body: "{}",
    });
    expect(browserMutationGuard(request, production)?.status).toBe(403);
  });
});
