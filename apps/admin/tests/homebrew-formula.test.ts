import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";

/**
 * scripts/build-homebrew-formula.sh writes the formula `brew install` uses.
 * A wrong or missing checksum there breaks the install for everyone, so the
 * script has to take each one from the release and stop if one is absent.
 */

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = path.join(repoRoot, "scripts", "build-homebrew-formula.sh");

const sums = {
  "usejunction-darwin-amd64": "a".repeat(64),
  "usejunction-darwin-arm64": "b".repeat(64),
  "usejunction-linux-amd64": "c".repeat(64),
  "usejunction-linux-arm64": "d".repeat(64),
  "usejunction-windows-amd64.exe": "e".repeat(64),
};

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function build(version: string, entries: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "uj-brew-"));
  scratch.push(dir);
  const checksums = path.join(dir, "checksums.txt");
  writeFileSync(checksums, Object.entries(entries).map(([name, sum]) => `${sum}  ${name}`).join("\n") + "\n");
  return spawnSync("bash", [script, version, checksums], { encoding: "utf8" });
}

test.skipIf(process.platform === "win32")("the Homebrew formula takes each platform's checksum from the release", () => {
  const result = build("1.2.3", sums);
  assert.equal(result.status, 0, result.stderr);
  const formula = result.stdout;

  assert.match(formula, /^class Usejunction < Formula$/m);
  assert.match(formula, /version "1\.2\.3"/);
  const release = "https://github.com/use-junction/usejunction/releases/download/agent-v1.2.3";
  for (const name of ["usejunction-darwin-arm64", "usejunction-darwin-amd64", "usejunction-linux-arm64", "usejunction-linux-amd64"] as const) {
    // Each url is followed directly by that file's own checksum.
    assert.ok(formula.includes(`url "${release}/${name}"\n      sha256 "${sums[name]}"`), `${name} is missing or has the wrong checksum`);
  }
  assert.match(formula, /bin\.install Dir\["usejunction-\*"\]\.first => "usejunction"/);
  // It installs the viewer only, and says where sign-in lives.
  assert.match(formula, /No account is needed and nothing is uploaded\./);
  assert.match(formula, /curl -fsSL https:\/\/usejunction\.dev\/install\.sh \| bash/);

  const ruby = spawnSync("ruby", ["-c"], { input: formula, encoding: "utf8" });
  if (!ruby.error) assert.equal(ruby.status, 0, ruby.stderr);
});

test.skipIf(process.platform === "win32")("the Homebrew formula is not written when a platform has no checksum", () => {
  const { "usejunction-linux-arm64": _missing, ...partial } = sums;
  const result = build("1.2.3", partial);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lists no checksum for usejunction-linux-arm64/);
  assert.equal(result.stdout, "");

  assert.equal(build("latest", sums).status, 2, "a version that is not x.y.z is refused");
});
