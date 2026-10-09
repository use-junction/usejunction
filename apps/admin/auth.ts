import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@usejunction/db";
import { isOAuthAccountNotLinkedError } from "@/lib/auth/oauth-account-conflict";
import { notifyServerIssue } from "@/lib/notifications/slack";
import {
  applyWorkspaceJwtClaims,
  exposeWorkspaceSessionClaims,
} from "@/lib/auth/session-callbacks";
import {
  isRecentSignup,
  notifyUserLoggedIn,
  notifyUserSignedUp,
} from "@/lib/notifications/slack";
import { provisionWorkspaceOnCreateUser } from "@/lib/ensure-workspace";
import { recordLegalAcceptance } from "@/lib/legal/acceptance";
import authConfig from "./auth.config";

const MAX_PASSWORD_BYTES = 256;

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: updateSession,
} = NextAuth({
  ...authConfig,
  logger: {
    error(error) {
      const authError = error as Error & { type?: string };
      const type = authError.type || authError.name || "UnknownAuthError";
      const message = authError.message ? `: ${authError.message.slice(0, 500)}` : "";
      if (isOAuthAccountNotLinkedError(error)) {
        // This is an expected, safely recoverable identity conflict. Avoid a
        // production stack trace while retaining a concise operational signal.
        console.warn("[auth][account-conflict] OAuth sign-in requires account recovery");
        notifyServerIssue({
          severity: "warning",
          scope: `auth/${type}`,
          error: `${type}${message}`,
        });
        return;
      }
      if (type === "CredentialsSignin") {
        // Expected when login forms submit wrong credentials (including e2e bad-password tests).
        console.warn("[auth][credentials-rejected] Invalid email or password");
        return;
      }
      const cause =
        error && typeof error === "object" && "cause" in error
          ? (error as { cause?: unknown }).cause
          : undefined;
      const causeErr =
        cause && typeof cause === "object" && cause !== null && "err" in cause
          ? (cause as { err?: unknown }).err
          : cause;
      const causeMessage =
        causeErr instanceof Error
          ? `${causeErr.name}: ${causeErr.message}`
          : causeErr
            ? String(causeErr)
            : "";
      console.error(
        "[auth][error]",
        error,
        causeMessage ? `\n[auth][cause] ${causeMessage}` : "",
        cause && typeof cause === "object" ? cause : "",
      );
      notifyServerIssue({
        severity: "error",
        scope: `auth/${type}`,
        error: `${type}${message}${causeMessage ? ` | ${causeMessage.slice(0, 400)}` : ""}`,
      });
    },
    warn(code) {
      console.warn("[auth][warn]", code);
      notifyServerIssue({
        severity: "warning",
        scope: "auth/warning",
        error: String(code),
      });
    },
  },
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { memberships: { orderBy: { createdAt: "desc" }, take: 1 } },
        });
        if (!user?.passwordHash || !user.emailVerified) return null;
        if (!(await compare(password, user.passwordHash))) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          orgId: user.memberships[0]?.orgId ?? null,
          role: user.memberships[0]?.role ?? null,
        };
      },
    }),
    ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? [GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET })]
      : []),
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })]
      : []),
    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt: applyWorkspaceJwtClaims,
    session: exposeWorkspaceSessionClaims,
  },
  events: {
    async createUser({ user }) {
      if (!user.email) return;
      // OAuth signup shows the Terms/Privacy agreement next to the provider buttons.
      if (user.id) await recordLegalAcceptance(user.id);
      notifyUserSignedUp({
        email: user.email,
        name: user.name,
        method: "oauth",
      });
      // Provision before the JWT callback so applyWorkspaceJwtClaims can stamp orgId.
      await provisionWorkspaceOnCreateUser({
        id: user.id,
        email: user.email,
        name: user.name,
      });
    },
    async signIn({ user, account }) {
      if (!user.email || !user.id) return;

      if (account?.provider && ["google", "microsoft-entra-id", "github"].includes(account.provider)) {
        await prisma.user.updateMany({
          where: { id: user.id, emailVerified: null },
          data: { emailVerified: new Date() },
        });
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { createdAt: true, email: true, name: true },
      });
      if (!dbUser) return;
      if (isRecentSignup(dbUser.createdAt)) return;

      notifyUserLoggedIn({
        email: dbUser.email,
        name: dbUser.name,
        provider: account?.provider ?? "credentials",
      });
    },
  },
});
