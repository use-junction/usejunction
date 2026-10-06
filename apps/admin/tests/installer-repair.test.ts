import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("resume repair preserves enrollment while refreshing outdated binaries", () => {
  const unix = readFileSync(path.join(repoRoot, "install.sh"), "utf8");
  const windows = readFileSync(path.join(repoRoot, "install.ps1"), "utf8");

  assert.match(unix, /Refreshing the outdated agent/);
  assert.match(unix, /Using existing UseJunction agent for setup recovery/);
  assert.match(windows, /\$repairInstall/);
  assert.match(windows, /Resuming UseJunction setup from the existing enrollment/);
});

test("macOS installer installs the app bundle into ~/Applications", () => {
  const unix = readFileSync(path.join(repoRoot, "install.sh"), "utf8");
  assert.match(unix, /APPS_DIR="\$\{HOME\}\/Applications"/);
  assert.match(unix, /APP_DIR="\$\{APPS_DIR\}\/\$\{APP_NAME\}\.app"/);
  assert.match(unix, /HIDDEN_APP_DIR="\$\{HOME_DIR\}\/\$\{APP_NAME\}\.app"/);
  assert.match(unix, /ln -sfn "\$\{APP_DIR\}\/Contents\/MacOS\/usejunction"/);
  assert.match(unix, /remove_hidden_macos_app/);
});
