import { getPublicAppUrl } from "@/lib/public-url";

/**
 * The installers default to the local admin (`http://localhost:3001`) when no
 * `--url` is given. A one-line install has no `--url`, so the script is served
 * with this deployment's own address as its default.
 */

// Only an address that is safe to paste into a shell or PowerShell string.
const SAFE_CONTROL_PLANE_URL = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

const SH_DEFAULT = 'CONTROL_PLANE_URL="${USEJUNCTION_URL:-http://localhost:3001}"';
const PS1_DEFAULT = 'else { "http://localhost:3001" }';

export function stampControlPlaneUrl(body: string, kind: "sh" | "ps1", controlPlaneUrl: string): string {
  const url = controlPlaneUrl.replace(/\/$/, "");
  if (!SAFE_CONTROL_PLANE_URL.test(url)) return body;
  if (kind === "sh") {
    return body.replace(SH_DEFAULT, `CONTROL_PLANE_URL="\${USEJUNCTION_URL:-${url}}"`);
  }
  return body.replace(PS1_DEFAULT, `else { "${url}" }`);
}

/** This deployment's address for the installer default, or null when it is not configured. */
export function installerControlPlaneUrl(request: Request): string | null {
  try {
    return getPublicAppUrl(request);
  } catch {
    return null;
  }
}
