import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * `npx usejunction` is published as part of the agent release cycle: promoting
 * a release in Agent release control publishes the npm package (and the
 * Homebrew formula) at the same version. The package carries the release's
 * checksums and is published with provenance.
 */

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const control = read(".github/workflows/agent-release-control.yml");
const distribute = read(".github/workflows/agent-release-distribute.yml");
const publish = read("scripts/publish-npm-wrapper.sh");

/** The text of one top-level job in a workflow: from `  <name>:` to the next job. */
function job(workflow: string, name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `no job "${name}"`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test("promoting a release publishes npm and Homebrew at the same version", () => {
  const distributeJob = job(control, "distribute");
  assert.match(distributeJob, /uses: \.\/\.github\/workflows\/agent-release-distribute\.yml/);
  // Only after the promotion itself succeeded, only for promote, and never for a pre-release.
  assert.match(distributeJob, /needs: control/);
  assert.match(distributeJob, /if: inputs\.action == 'promote' && !contains\(inputs\.version, '-'\)/);
  assert.match(distributeJob, /version: \$\{\{ inputs\.version \}\}/);
  assert.match(distributeJob, /secrets: inherit/);
  assert.match(distributeJob, /id-token: write/);

  // The publish workflow can be called by release control and still be run by hand to retry.
  assert.match(distribute, /on:\n  workflow_call:\n    inputs:\n      version:/);
  assert.match(distribute, /\n  workflow_dispatch:\n/);
});

test("the npm package is published with provenance and the release's checksums, and a rerun is safe", () => {
  const npmJob = job(distribute, "npm");
  assert.match(npmJob, /id-token: write/);
  assert.match(npmJob, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);

  assert.match(publish, /PUBLISH\+=\(--provenance\)/);
  assert.match(publish, /printf '%s\\n' "\$CHECKSUMS" > "\$STAGE\/checksums\.txt"/);
  assert.match(publish, /already on npm; nothing to publish/);

  const pkg = JSON.parse(read("npm/usejunction/package.json")) as { files: string[] };
  assert.ok(pkg.files.includes("checksums.txt"), "checksums.txt must be in the published files");
});

test("release workflows never paste an input into a shell script", () => {
  for (const [name, workflow] of [["agent-release-control.yml", control], ["agent-release-distribute.yml", distribute]] as const) {
    for (const line of workflow.split("\n")) {
      if (!line.includes("${{ inputs.")) continue;
      // Allowed: an env value (VERSION: ${{ inputs.version }}) or a reusable-workflow input (version: ...).
      assert.match(line, /^\s+(?:[A-Z_]+|version): \$\{\{ inputs\.[a-z]+ \}\}$/, `${name}: an input is used outside env/with: ${line.trim()}`);
    }
  }
});
