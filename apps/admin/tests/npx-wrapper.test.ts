import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

/**
 * `npx usejunction` runs npm/usejunction/bin/usejunction.js. It has to fetch
 * the agent for this platform, refuse one that does not match the release's
 * checksum, keep it for next time, and pass arguments and the exit code through.
 */

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const wrapper = path.join(repoRoot, "npm", "usejunction", "bin", "usejunction.js");

const platform = { darwin: "darwin", linux: "linux" }[process.platform as string];
const architecture = { x64: "amd64", arm64: "arm64" }[process.arch as string];
const asset = `usejunction-${platform}-${architecture}`;

// Stands in for the agent: says how it was called, and can fail on request.
const fakeAgent = `#!/bin/sh
echo "args=$*"
echo "runner=$USEJUNCTION_RUNNER"
[ "$1" = "fail" ] && exit 3
exit 0
`;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function release(options: { checksum?: string } = {}) {
  const requests: string[] = [];
  const checksum = options.checksum ?? createHash("sha256").update(fakeAgent).digest("hex");
  const server: Server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/checksums.txt") return response.end(`${"0".repeat(64)}  some-other-file\n${checksum}  ${asset}\n`);
    if (request.url === `/${asset}`) return response.end(fakeAgent);
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const cache = mkdtempSync(path.join(tmpdir(), "uj-npx-"));
  cleanups.push(() => {
    server.close();
    rmSync(cache, { recursive: true, force: true });
  });
  return { requests, cache, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function run(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [wrapper, ...args], { env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? Number((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

const supported = Boolean(platform && architecture);

test.skipIf(!supported)("npx usejunction downloads the agent once, verifies it and runs it with the arguments given", async () => {
  const { requests, cache, base } = await release();
  const env = { USEJUNCTION_RELEASE_BASE: base, USEJUNCTION_VERSION: "9.9.9", USEJUNCTION_NPX_CACHE: cache };

  const first = await run(["daily", "--since", "20261101"], env);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /args=daily --since 20261101/);
  // The agent uses this to name a sign-in command that works without it on PATH.
  assert.match(first.stdout, /runner=npx/);
  assert.match(first.stderr, /Downloading usejunction 9\.9\.9/);
  assert.deepEqual(requests.sort(), ["/checksums.txt", `/${asset}`].sort());
  assert.ok(existsSync(path.join(cache, "9.9.9", asset)));

  // The second run starts from the cache: no download, and nothing on stderr
  // to spoil a status line or a pipe.
  const second = await run([], env);
  assert.equal(second.code, 0);
  assert.equal(second.stderr, "");
  assert.equal(requests.length, 2);

  const failing = await run(["fail"], env);
  assert.equal(failing.code, 3, "the agent's exit code must pass through");
});

test.skipIf(!supported)("npx usejunction refuses a download that does not match the release checksum", async () => {
  const { cache, base } = await release({ checksum: "a".repeat(64) });
  const result = await run(["daily"], { USEJUNCTION_RELEASE_BASE: base, USEJUNCTION_VERSION: "9.9.9", USEJUNCTION_NPX_CACHE: cache });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not match its checksum, so it was not run/);
  assert.equal(result.stdout, "", "the mismatched binary must not run");
  const kept = existsSync(path.join(cache, "9.9.9")) ? readdirSync(path.join(cache, "9.9.9")) : [];
  assert.deepEqual(kept, [], "nothing is cached from a failed download");
});

test("npx usejunction explains a missing release instead of crashing", async () => {
  const { cache, base } = await release();

  // Run from the repository, the package has no release version yet.
  const unversioned = await run([], { USEJUNCTION_RELEASE_BASE: base, USEJUNCTION_NPX_CACHE: cache });
  assert.equal(unversioned.code, 1);
  assert.match(unversioned.stderr, /no release version/);

  const missing = await run([], { USEJUNCTION_RELEASE_BASE: `${base}/nowhere`, USEJUNCTION_VERSION: "9.9.9", USEJUNCTION_NPX_CACHE: cache });
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /answered 404\. Check that release 9\.9\.9 exists\./);
});
