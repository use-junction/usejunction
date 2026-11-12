import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { installerControlPlaneUrl, stampControlPlaneUrl } from "@/lib/install-script";

async function readInstallScript() {
  const candidates = [
    path.join(process.cwd(), "install.ps1"),
    path.join(process.cwd(), "..", "install.ps1"),
    path.join(process.cwd(), "..", "..", "install.ps1"),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next standalone/monorepo location.
    }
  }
  return null;
}

export async function GET(request: Request) {
  const script = await readInstallScript();
  if (!script) return NextResponse.json({ error: "install.ps1 not found" }, { status: 404 });
  // A one-line install passes no -Url, so the script defaults to this deployment.
  const controlPlaneUrl = installerControlPlaneUrl(request);
  const body = controlPlaneUrl ? stampControlPlaneUrl(script, "ps1", controlPlaneUrl) : script;
  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
