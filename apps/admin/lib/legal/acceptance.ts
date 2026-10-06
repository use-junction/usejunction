import { prisma } from "@usejunction/db";
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from "@/lib/legal/versions";

export function legalAcceptanceIsCurrent(user: {
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
} | null | undefined) {
  return Boolean(
    user?.termsAcceptedAt &&
      user.termsVersion === LEGAL_TERMS_VERSION &&
      user.privacyVersion === LEGAL_PRIVACY_VERSION,
  );
}

export async function recordLegalAcceptance(userId: string, at = new Date()) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      termsAcceptedAt: at,
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION,
    },
    select: {
      termsAcceptedAt: true,
      termsVersion: true,
      privacyVersion: true,
    },
  });
}

export async function loadLegalAcceptance(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { termsAcceptedAt: true, termsVersion: true, privacyVersion: true },
  });
  return {
    accepted: legalAcceptanceIsCurrent(user),
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
    termsAcceptedAt: user?.termsAcceptedAt?.toISOString() ?? null,
  };
}
