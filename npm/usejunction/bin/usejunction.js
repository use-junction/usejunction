#!/usr/bin/env node
"use strict";

// `npx usejunction` — fetches the UseJunction agent for this platform, checks
// it against the release's checksums, and runs it with the arguments given.
// The binary is kept in the user's cache folder, so later runs start at once.
// Nothing is installed: no background service, no PATH change, no settings.

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLATFORMS = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCHITECTURES = { x64: "amd64", arm64: "arm64" };

function fail(message) {
  process.stderr.write(`usejunction: ${message}\n`);
  process.exit(1);
}

function releaseVersion() {
  const version = (process.env.USEJUNCTION_VERSION || require("../package.json").version).replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version) || version === "0.0.0") {
    fail("this copy has no release version; run the published package with `npx usejunction`, or set USEJUNCTION_VERSION.");
  }
  return version;
}

function assetName() {
  const platform = PLATFORMS[process.platform];
  const architecture = ARCHITECTURES[process.arch];
  if (!platform || !architecture) {
    fail(`no build for ${process.platform} ${process.arch}. Builds exist for macOS, Linux and Windows on x64 and arm64.`);
  }
  return `usejunction-${platform}-${architecture}${platform === "windows" ? ".exe" : ""}`;
}

function cacheRoot() {
  if (process.env.USEJUNCTION_NPX_CACHE) return process.env.USEJUNCTION_NPX_CACHE;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "usejunction", "npx");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "usejunction", "npx");
}

async function download(url) {
  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    fail(`could not reach ${url} (${error.cause?.code || error.message}). Check your connection and try again.`);
  }
  if (!response.ok) {
    fail(`${url} answered ${response.status}. Check that release ${releaseVersion()} exists.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function expectedChecksum(checksums, name) {
  for (const line of checksums.split(/\r?\n/)) {
    const [sum, file] = line.trim().split(/\s+/);
    if (file === name && /^[0-9a-f]{64}$/.test(sum)) return sum;
  }
  return "";
}

async function ensureBinary() {
  const version = releaseVersion();
  const name = assetName();
  const directory = path.join(cacheRoot(), version);
  const target = path.join(directory, name);
  if (fs.existsSync(target)) return target;

  const base = (process.env.USEJUNCTION_RELEASE_BASE || `https://github.com/use-junction/usejunction/releases/download/agent-v${version}`).replace(/\/+$/, "");
  process.stderr.write(`Downloading usejunction ${version}…\n`);
  const [checksums, binary] = await Promise.all([download(`${base}/checksums.txt`), download(`${base}/${name}`)]);

  const expected = expectedChecksum(checksums.toString("utf8"), name);
  if (!expected) fail(`release ${version} lists no checksum for ${name}.`);
  const actual = createHash("sha256").update(binary).digest("hex");
  if (actual !== expected) {
    fail(`the download of ${name} does not match its checksum, so it was not run. Try again.`);
  }

  // Written under another name first, so a half-finished download is never run.
  fs.mkdirSync(directory, { recursive: true });
  const partial = `${target}.${process.pid}.partial`;
  fs.writeFileSync(partial, binary, { mode: 0o755 });
  fs.renameSync(partial, target);
  return target;
}

async function main() {
  const binary = await ensureBinary();
  const result = spawnSync(binary, process.argv.slice(2), {
    stdio: "inherit",
    // Lets the agent name a sign-in command that works without it on PATH.
    env: { ...process.env, USEJUNCTION_RUNNER: "npx" },
  });
  if (result.error) fail(`could not start ${binary}: ${result.error.message}`);
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}

main();
