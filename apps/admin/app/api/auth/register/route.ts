import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@usejunction/db";
import { appUrl, createAuthActionToken, safeAuthNextPath, sendAuthEmail } from "@/lib/auth-actions";
import { ensureOwnerWorkspace } from "@/lib/ensure-workspace";
import { notifyUserSignedUp } from "@/lib/notifications/slack";
import { limitedJson } from "@/lib/security/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordLegalAcceptance } from "@/lib/legal/acceptance";
import { logServerError } from "@/lib/errors/public";

const MAX_PASSWORD_BYTES = 256;

function isInviteSignup(from: string) {
  return from.startsWith("/i/") || from.startsWith("/join/");
}

export async function POST(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, { key: "auth-register", limit: 10, windowSeconds: 60 });
    if (limited !== true) return limited;
    const parsedBody = await limitedJson(request, 16 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const intent = body.intent === "team" ? "team" : null;
    const from = safeAuthNextPath(typeof body.from === "string" ? body.from : null, "/dashboard");
    if (body.acceptTerms !== true) {
      return NextResponse.json(
        { error: "Accept the Terms of Service and Privacy Policy to create an account." },
        { status: 400 },
      );
    }
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES || password !== body.confirmPassword) {
      return NextResponse.json(
        { error: "Enter a valid name, work email, and matching password of at least 12 characters." },
        { status: 400 },
      );
    }

    const joiningViaInvite = isInviteSignup(from);
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { name, email, passwordHash: await hash(password, 12) } });
      await recordLegalAcceptance(user.id);
      notifyUserSignedUp({ email, name, method: "email" });
      if (intent) await prisma.planInterest.create({ data: { plan: intent, email, name, userId: user.id } });
      // Invitees join an existing org on redeem — don't create a personal workspace first.
      if (!joiningViaInvite) {
        await ensureOwnerWorkspace({ id: user.id, email: user.email, name: user.name });
      }
    } else if (!joiningViaInvite) {
      await ensureOwnerWorkspace({ id: user.id, email: user.email, name: user.name });
    }

    if (!user.emailVerified) {
      const token = await createAuthActionToken(user.id, "email_verification", 24 * 60 * 60 * 1000);
      const verifyPath = `/api/auth/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(from)}`;
      await sendAuthEmail({
        to: email,
        subject: "Verify your UseJunction account",
        url: appUrl(verifyPath),
      });
    }

    return NextResponse.json({
      ok: true,
      next: from,
      needsVerification: true,
    });
  } catch (error) {
    logServerError("auth/register", error);
    return NextResponse.json({ error: "Unable to create your account right now." }, { status: 500 });
  }
}
