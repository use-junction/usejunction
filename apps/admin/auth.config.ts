import type { NextAuthConfig } from "next-auth";

if (!process.env.AUTH_SECRET && process.env.NEXTAUTH_SECRET) {
  process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;
}

export function isPublicPath(pathname: string): boolean {
  if (/\.(?:png|svg|jpg|jpeg|gif|webp|ico|lottie|txt|xml|webmanifest)$/.test(pathname)) return true;
  if (
    pathname === "/" ||
    pathname === "/lottie-viewer" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/contact" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/dpa" ||
    pathname === "/subprocessors" ||
    pathname === "/gdpr" ||
    pathname === "/security" ||
    pathname === "/cookies" ||
    pathname === "/install.sh" ||
    pathname === "/install.ps1" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/llms.txt" ||
    pathname === "/llms-full.txt"
  ) {
    return true;
  }
  if (
    pathname.startsWith("/guides") ||
    pathname.startsWith("/compare") ||
    pathname.startsWith("/for") ||
    pathname.startsWith("/solutions") ||
    pathname.startsWith("/blog") ||
    pathname.startsWith("/authors") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/i/") ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/forgot") ||
    pathname.startsWith("/reset") ||

    pathname.startsWith("/releases/") ||
    pathname.startsWith("/api/auth") ||
    // Page-data handlers own authentication and must return typed JSON 401/403
    // responses instead of Auth.js middleware redirects to an HTML login page.
    pathname.startsWith("/api/app/") ||
    pathname.startsWith("/api/contact") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/join") ||
    pathname.startsWith("/api/i/") ||
    pathname.startsWith("/api/enroll") ||
    pathname.startsWith("/api/ingest") ||
    pathname.startsWith("/api/devices") ||
    pathname === "/api/agent-releases/latest" ||
    pathname.startsWith("/api/internal/agent-releases") ||
    pathname.startsWith("/api/otel") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/indexnow") ||
    // GitHub App Setup URL: a cross-site GET. Auth.js must not strip
    // installation_id by bouncing to /login?callbackUrl= before the route runs.
    pathname === "/api/integrations/github/callback"
  ) {
    return true;
  }
  return false;
}

export default {
  // Auth.js must trust the host header for local Next.js development. In
  // production this remains opt-in so a reverse proxy must be configured
  // explicitly with AUTH_TRUST_HOST=true.
  trustHost: process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV !== "production",
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request }) {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      return Boolean(auth);
    },
  },
  providers: [],
} satisfies NextAuthConfig;
