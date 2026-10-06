import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "path";
import { assertSecureProductionEnv } from "./lib/security/env-guard";

// Load monorepo root .env (pnpm dev runs from apps/admin; Prisma needs DATABASE_URL)
loadEnvConfig(path.join(__dirname, "../.."));
assertSecureProductionEnv();

/** Prisma engineType=client loads query_compiler_bg.wasm at runtime; Vercel must trace it into lambdas. */
const prismaClientTraceIncludes = [
  "../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.wasm",
  "../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/query_compiler_bg.js",
  "../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/query_compiler_bg.wasm",
];

const nextConfig: NextConfig = {
  // Dev (Turbopack) and production builds must not share .next — concurrent writes
  // produce broken artifacts (e.g. turbopack runtime refs in webpack _document.js).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: ["@sparticuz/chromium", "ably", "puppeteer-core", "playwright"],
  outputFileTracingIncludes: {
    // "/*" only matches one path segment (e.g. /about), not /api/** routes that use Prisma.
    "/api/**/*": prismaClientTraceIncludes,
    "/auth/**/*": prismaClientTraceIncludes,
    "/onboarding/**": prismaClientTraceIncludes,
    "/api/cron/daily-report-send": [
      "../../node_modules/.pnpm/@sparticuz+chromium*/node_modules/@sparticuz/chromium/**/*",
      "./public/usejunction.png",
    ],
  },
  transpilePackages: ["@usejunction/db"],
  experimental: {
    optimizePackageImports: ["@lobehub/icons"],
  },
  async redirects() {
    return [
      {
        source: "/blog/visibility-before-control",
        destination: "/blog/what-is-ai-coding-observability",
        permanent: true,
      },
      {
        source: "/blog/stop-wasting-ai-coding-seats",
        destination: "/guides/see-plan-usage-and-waste",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.usejunction.dev" }],
        destination: "https://usejunction.dev/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "usejunction.com" }],
        destination: "https://usejunction.dev/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.usejunction.com" }],
        destination: "https://usejunction.dev/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    const commonHeaders = [
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://assets.calendly.com https://*.posthog.com https://eu.i.posthog.com https://us.i.posthog.com${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}; style-src 'self' 'unsafe-inline' https://assets.calendly.com; img-src 'self' data: https:; font-src 'self' data: https://assets.calendly.com; connect-src 'self' https: http://127.0.0.1:* http://localhost:* https://eu.i.posthog.com https://us.i.posthog.com; worker-src 'self' blob: data:; frame-src https://calendly.com https://*.calendly.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [
      {
        source: "/:path*",
        headers: [...commonHeaders, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
      },
      {
        source: "/:tokenPath(join|i|reset-password|verify)/:path*",
        headers: [...commonHeaders, { key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/api/:tokenPath(join|i|auth)/:path*",
        headers: [...commonHeaders, { key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
