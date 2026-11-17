/**
 * The short code a person sees in the terminal and on the approval page.
 * Kept free of server-only imports so the page can use it too.
 */

// Consonants only, so a code can never spell a word, and none of the letters
// that are misread for each other or for digits.
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_LENGTH = 8;

/** Accepts what a person types or pastes ("kqrt-bxwm", "KQRT BXWM") and returns the stored form, or null. */
export function normalizeUserCode(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (cleaned.length !== USER_CODE_LENGTH) return null;
  for (const letter of cleaned) {
    if (!USER_CODE_ALPHABET.includes(letter)) return null;
  }
  return cleaned;
}

/** "KQRTBXWM" → "KQRT-BXWM", the way the terminal and the page both show it. */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
