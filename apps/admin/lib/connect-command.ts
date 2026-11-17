export { getPublicAppUrl } from "@/lib/public-url";

export function buildInstallCommand(token: string, controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  return `curl -fsSL ${base}/install.sh | sh -s -- --token ${token} --url ${base}`;
}

export type PlatformCommands = {
  macosLinux: string;
  windows: string;
};

function powerShellLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPowerShellInstallCommand(token: string, controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  const scriptUrl = powerShellLiteral(`${base}/install.ps1`);
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing ${scriptUrl}))) -Token ${powerShellLiteral(token)} -Url ${powerShellLiteral(base)}"`;
}

export function buildWindowsInstallCommand(token: string, controlPlaneUrl: string) {
  return buildPowerShellInstallCommand(token, controlPlaneUrl);
}

/**
 * The one-line install: no token. The installer shows local usage, then opens
 * the browser to sign in and approve the device. install.sh is a bash script,
 * so it is piped to bash rather than sh.
 */
export function buildSignInInstallCommand(controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  return `curl -fsSL ${base}/install.sh | bash`;
}

export function buildWindowsSignInInstallCommand(controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  const scriptUrl = powerShellLiteral(`${base}/install.ps1`);
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing ${scriptUrl})))"`;
}

export function buildResumeCommand(controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  return `curl -fsSL ${base}/install.sh | sh -s -- --resume --url ${base}`;
}

export function buildWindowsResumeCommand(controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  const scriptUrl = powerShellLiteral(`${base}/install.ps1`);
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing ${scriptUrl}))) -Resume -Url ${powerShellLiteral(base)}"`;
}

export function buildPlatformInstallCommands(token: string, controlPlaneUrl: string): PlatformCommands {
  return {
    macosLinux: buildInstallCommand(token, controlPlaneUrl),
    windows: buildWindowsInstallCommand(token, controlPlaneUrl),
  };
}

export function buildPlatformResumeCommands(controlPlaneUrl: string): PlatformCommands {
  return {
    macosLinux: buildResumeCommand(controlPlaneUrl),
    windows: buildWindowsResumeCommand(controlPlaneUrl),
  };
}

export function buildTeamInviteLinkUrl(token: string, controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  return `${base}/i/${encodeURIComponent(token)}`;
}

/**
 * One-liner that POSTs to /api/enroll — simulates agent connect without a full install.
 */
export function buildSimulateConnectCommand(token: string, controlPlaneUrl: string) {
  const base = controlPlaneUrl.replace(/\/$/, "");
  const payload =
    `{"token":"${token}","hostname":"'"$(hostname)"'","os":"'"$(uname -s)"'","architecture":"'"$(uname -m)"'","agentVersion":"sim-0.1.0"}`;
  return `curl -fsS -X POST "${base}/api/enroll" -H "content-type: application/json" -d '${payload}'`;
}
