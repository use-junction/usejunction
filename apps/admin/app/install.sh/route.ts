import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { installerControlPlaneUrl, stampControlPlaneUrl } from "@/lib/install-script";
import { isLoopbackHostname } from "@/lib/security/env-guard";

type InstallScript = {
  body: string;
  root: string;
};

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function readInstallScript(): Promise<InstallScript | null> {
  const candidates = [
    path.join(process.cwd(), "install.sh"),
    path.join(process.cwd(), "..", "install.sh"),
    path.join(process.cwd(), "..", "..", "install.sh"),
  ];
  for (const candidate of candidates) {
    try {
      const body = await readFile(candidate, "utf8");
      return {
        body,
        root: path.dirname(candidate),
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function GET(request: Request) {
  const found = await readInstallScript();
  if (!found) return NextResponse.json({ error: "install.sh not found" }, { status: 404 });

  // A one-line install passes no --url, so the script defaults to this deployment.
  const controlPlaneUrl = installerControlPlaneUrl(request);
  let body = controlPlaneUrl ? stampControlPlaneUrl(found.body, "sh", controlPlaneUrl) : found.body;
  // When developers curl the local admin install.sh, inject the monorepo root so
  // the customer-facing installer builds from this checkout instead of falling
  // back to an ancient GitHub agent-v0.1.0 release. Production hosts are untouched.
  const hostname = new URL(request.url).hostname;
  if (isLoopbackHostname(hostname) && found.root) {
    body = [
      "# Injected by local control plane — build agent from this checkout.",
      `export USEJUNCTION_ROOT=${shellSingleQuote(found.root)}`,
      "export USEJUNCTION_PROFILE=test",
      "",
      body,
    ].join("\n");
  }

  return new NextResponse(body, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
