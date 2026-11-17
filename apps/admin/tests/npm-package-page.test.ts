import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

/**
 * The npm page is the README in npm/usejunction, and the line under the
 * package name is package.json's description. Both have to list the reports
 * the agent really has, so nobody copies a command that does not exist, and
 * nobody misses one that does.
 */

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packageDir = path.join(repoRoot, "npm", "usejunction");
const readme = readFileSync(path.join(packageDir, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
  description: string;
  keywords: string[];
  files: string[];
};

/** The usage commands, read from the agent's cobra definitions (`Use: "weekly"`). */
function agentUsageCommands(): string[] {
  const cmdDir = path.join(repoRoot, "agent", "cmd");
  const source = ["usage_cmd.go"].map((file) => readFileSync(path.join(cmdDir, file), "utf8")).join("\n");
  return [...source.matchAll(/Use:\s+"([a-z]+)"/g)].map((match) => match[1]!);
}

test("the npm README shows every usage command the agent has, and only those", () => {
  const commands = agentUsageCommands();
  assert.deepEqual(
    [...commands].sort(),
    ["blocks", "daily", "month", "monthly", "session", "statusline", "today", "week", "weekly"],
  );
  for (const command of commands) {
    assert.match(readme, new RegExp(`npx usejunction ${command}\\b`), `README has no example of "usejunction ${command}"`);
  }

  // Every `npx usejunction <word>` in the README is a command that exists.
  const shown = new Set([...readme.matchAll(/npx usejunction ([a-z]+)/g)].map((match) => match[1]!));
  for (const word of shown) {
    assert.ok(commands.includes(word), `README shows "npx usejunction ${word}", which is not a command`);
  }

  for (const flag of ["--last", "--since", "--until", "--tool", "--breakdown", "--json", "--order", "--active"]) {
    assert.ok(readme.includes(flag), `README does not mention ${flag}`);
  }
});

test("the npm page is laid out like ccusage's: quick start, sources, installation, usage, features", () => {
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1]!);
  const order = ["Quick Start", "Supported Sources", "Installation", "Usage", "Features"];
  let last = -1;
  for (const heading of order) {
    const at = headings.indexOf(heading);
    assert.ok(at > last, `"## ${heading}" is missing or out of order: ${headings.join(" / ")}`);
    last = at;
  }

  // Images on an npm page need absolute URLs, and the screenshot has to be in the repo to be served.
  const images = [...readme.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]!);
  for (const url of images) assert.match(url, /^https:\/\//);
  const screenshot = images.find((url) => url.endsWith("/npm/usejunction/docs/screenshot.png"));
  assert.ok(screenshot, "no terminal screenshot");
  assert.ok(readdirSync(path.join(packageDir, "docs")).includes("screenshot.png"));
  // The screenshot is for the page, not the download.
  assert.ok(!pkg.files.some((file) => file.startsWith("docs")));
});

test("the package description names the periods people look for", () => {
  for (const word of ["today", "week", "month", "weekly", "monthly", "session"]) {
    assert.match(pkg.description, new RegExp(`\\b${word}\\b`), `description does not say "${word}"`);
  }
  assert.match(pkg.description, /No account/);
  assert.ok(pkg.keywords.includes("ccusage"));
});
