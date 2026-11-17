import { randomInt } from "node:crypto";
import { generateOpaqueToken } from "@/lib/security";
import { USER_CODE_ALPHABET, USER_CODE_LENGTH, formatUserCode } from "@/lib/device-auth-code";

export { formatUserCode, normalizeUserCode } from "@/lib/device-auth-code";

/**
 * Sign-in for devices without a copied enroll token.
 *
 * The agent starts a request and keeps the device code. It shows the person a
 * link carrying the short user code; a signed-in person approves that code in
 * the browser; the agent's next poll with the device code creates the device.
 */

/** Long enough to sign up with a password and click the verification email. */
export const DEVICE_AUTH_TTL_SECONDS = 15 * 60;
/** How often the agent is told to poll. */
export const DEVICE_AUTH_POLL_INTERVAL_SECONDS = 3;

export const DEVICE_AUTH_STATUS = {
  pending: "pending",
  approved: "approved",
  denied: "denied",
  consumed: "consumed",
} as const;

export function generateUserCode(): string {
  let code = "";
  for (let index = 0; index < USER_CODE_LENGTH; index += 1) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

export function generateDeviceCode(): string {
  return generateOpaqueToken("uj_device", 32);
}

export function buildVerificationUrl(userCode: string, publicAppUrl: string): string {
  return `${publicAppUrl.replace(/\/$/, "")}/connect?code=${formatUserCode(userCode)}`;
}

/** Operating system name as a person would say it, for the approval page. */
export function describeDeviceOs(os: string): string {
  switch (os.toLowerCase()) {
    case "darwin":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return os;
  }
}
