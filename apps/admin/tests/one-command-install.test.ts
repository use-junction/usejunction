import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";
import { GET as getInstallPs1 } from "../app/install.ps1/route";
import { GET as getInstallSh } from "../app/install.sh/route";
import { buildSignInInstallCommand, buildWindowsSignInInstallCommand } from "../lib/connect-command";
import { stampControlPlaneUrl } from "../lib/install-script";

/**
 * `curl -fsSL https://usejunction.dev/install.sh | bash` with nothing else:
 * the script has to know where it came from, must not demand a token, and has
 * to hand the agent the sign-in path.
 */

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installSh = readFileSync(path.join(repoRoot, "install.sh"), "utf8");
const installPs1 = readFileSync(path.join(repoRoot, "install.ps1"), "utf8");

const ORIGINAL = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  USEJUNCTION_USE_CONFIGURED_APP_URL: process.env.USEJUNCTION_USE_CONFIGURED_APP_URL,
};

const scratchHomes: string[] = [];

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const home of scratchHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("the one-line install needs no token and is what the README tells people to run", () => {
  const unix = buildSignInInstallCommand("https://usejunction.dev/");
  const windows = buildWindowsSignInInstallCommand("https://usejunction.dev/");
  // install.sh is a bash script; piping it to sh breaks where sh is not bash.
  assert.equal(unix, "curl -fsSL https://usejunction.dev/install.sh | bash");
  assert.match(windows, /^powershell\.exe .*'https:\/\/usejunction\.dev\/install\.ps1'/);
  assert.doesNotMatch(unix + windows, /token/i);

  const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert.ok(readme.includes(unix), "README install command drifted from the builder");
  assert.ok(readme.includes(windows), "README Windows command drifted from the builder");
  assert.doesNotMatch(readme, /YOUR_TOKEN|copy your enroll token/);
});

test("the served install.sh defaults to the deployment it was downloaded from", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://usejunction.dev";
  delete process.env.USEJUNCTION_USE_CONFIGURED_APP_URL;

  const body = await (await getInstallSh(new Request("https://usejunction.dev/install.sh"))).text();
  assert.match(body, /^CONTROL_PLANE_URL="\$\{USEJUNCTION_URL:-https:\/\/usejunction\.dev\}"$/m);
  assert.doesNotMatch(body, /USEJUNCTION_URL:-http:\/\/localhost:3001/);
  // Still a plain customer-facing script.
  assert.match(body, /^#!/);
});

test("the served install.ps1 defaults to the deployment it was downloaded from", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://usejunction.dev";
  delete process.env.USEJUNCTION_USE_CONFIGURED_APP_URL;

  const body = await (await getInstallPs1(new Request("https://usejunction.dev/install.ps1"))).text();
  assert.match(body, /\$env:USEJUNCTION_URL \} else \{ "https:\/\/usejunction\.dev" \}/);
  assert.doesNotMatch(body, /else \{ "http:\/\/localhost:3001" \}/);
});

test("a local admin keeps serving a script that targets itself", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://usejunction.dev";
  delete process.env.USEJUNCTION_USE_CONFIGURED_APP_URL;

  const body = await (await getInstallSh(new Request("http://localhost:3001/install.sh"))).text();
  assert.match(body, /^CONTROL_PLANE_URL="\$\{USEJUNCTION_URL:-http:\/\/localhost:3001\}"$/m);
});

test("an address that is not safe to paste into a shell is never stamped in", () => {
  for (const url of ['https://evil.example/$(rm -rf ~)', 'https://x.example/"; rm -rf ~; "', "https://x.example/path", "javascript:alert(1)"]) {
    assert.equal(stampControlPlaneUrl(installSh, "sh", url), installSh);
    assert.equal(stampControlPlaneUrl(installPs1, "ps1", url), installPs1);
  }
  assert.notEqual(stampControlPlaneUrl(installSh, "sh", "https://junction.example.com:8443/"), installSh);
});

test("both installers still contain the default the server rewrites", () => {
  // If either line is reworded, the one-line install silently targets localhost.
  assert.ok(installSh.includes('CONTROL_PLANE_URL="${USEJUNCTION_URL:-http://localhost:3001}"'));
  assert.ok(installPs1.includes('else { "http://localhost:3001" }'));
});

test("install.ps1 signs in through the browser when no token is given", () => {
  assert.doesNotMatch(installPs1, /Show-Usage/);
  assert.match(installPs1, /\$SignIn = \$true/);
  assert.match(installPs1, /@\("onboard", "--url", \$Url\)/);
  assert.match(installPs1, /@\("login", "--help"\)/);
  // The token path is unchanged.
  assert.match(installPs1, /@\("onboard", "--token", \$Token, "--url", \$Url, "--accept-collection-notice"\)/);
});

/**
 * Run the real install.sh against a stand-in agent. `--resume` territory is
 * avoided: HOME is a scratch directory and the fake agent is what "installs".
 */
function runInstaller(options: { agentScript: string; args?: string[]; existingConfig?: boolean }) {
  const home = mkdtempSync(path.join(tmpdir(), "uj-install-"));
  scratchHomes.push(home);
  const root = path.join(home, "checkout");
  const bin = path.join(home, "fakebin");
  mkdirSync(path.join(root, "agent"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  // The installer builds a local checkout with `go build -o <out> .`; this
  // stand-in writes the fake agent to <out> instead.
  writeFileSync(path.join(root, "agent", "main.go"), "package main\n");
  const agentPath = path.join(home, "fake-agent.sh");
  writeFileSync(agentPath, options.agentScript);
  chmodSync(agentPath, 0o755);
  writeFileSync(
    path.join(bin, "go"),
    `#!/bin/bash\nout=""\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == "-o" ]]; then out="$2"; shift; fi; shift; done\n[[ -n "$out" ]] && cp "${agentPath}" "$out" && chmod +x "$out"\nexit 0\n`,
  );
  // No background service, PATH edits or app bundle in a test.
  for (const name of ["launchctl", "systemctl", "codesign", "xattr", "open"]) {
    writeFileSync(path.join(bin, name), "#!/bin/bash\nexit 0\n");
  }
  for (const name of ["go", "launchctl", "systemctl", "codesign", "xattr", "open"]) chmodSync(path.join(bin, name), 0o755);
  if (options.existingConfig) {
    mkdirSync(path.join(home, ".usejunction-test"), { recursive: true });
    writeFileSync(path.join(home, ".usejunction-test", "config.json"), "{}");
  }

  const result = spawnSync("bash", [path.join(repoRoot, "install.sh"), "--url", "http://127.0.0.1:9", ...(options.args ?? [])], {
    env: {
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: "/bin/bash",
      USEJUNCTION_ROOT: root,
      USEJUNCTION_PROFILE: "test",
      AGENT_CALLS: path.join(home, "agent-calls.log"),
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  const callsPath = path.join(home, "agent-calls.log");
  const calls = existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n") : [];
  return { ...result, calls, home };
}

const hasBash = (() => {
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return process.platform !== "win32";
  } catch {
    return false;
  }
})();

// Records each invocation; "onboard" without --complete writes the config a real sign-in would.
const signInCapableAgent = `#!/bin/bash
echo "$*" >> "$AGENT_CALLS"
args=" $* "
if [[ "$args" == *" onboard "* && "$args" != *" --complete "* ]]; then
  mkdir -p "$HOME/.usejunction-test" && echo '{}' > "$HOME/.usejunction-test/config.json"
fi
exit 0
`;

test("install.sh with no token runs the agent's browser sign-in", { skip: !hasBash }, () => {
  const run = runInstaller({ agentScript: signInCapableAgent });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const onboard = run.calls.find((call) => /(^| )onboard( |$)/.test(call) && !call.includes("--complete"));
  assert.ok(onboard, `agent was never asked to onboard: ${run.calls.join(" | ")}`);
  assert.match(onboard, /onboard --url http:\/\/127\.0\.0\.1:9$/);
  assert.doesNotMatch(onboard, /--token/);
  // Consent happens in the browser, so the installer must not accept it on the person's behalf.
  assert.doesNotMatch(onboard, /--accept-collection-notice/);
  assert.ok(run.calls.some((call) => call.includes("onboard --complete")));
  assert.doesNotMatch(run.stdout + run.stderr, /Usage:/);
});

test("install.sh with a token still enrolls with it", { skip: !hasBash }, () => {
  const run = runInstaller({ agentScript: signInCapableAgent, args: ["--token", "uj_enroll_abc"] });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.ok(
    run.calls.some((call) => call.includes("onboard --token uj_enroll_abc --url http://127.0.0.1:9 --accept-collection-notice")),
    run.calls.join(" | "),
  );
});

test("install.sh tells an agent build without sign-in what to do instead", { skip: !hasBash }, () => {
  // An older agent: no `login` command.
  const oldAgent = `#!/bin/bash
echo "$*" >> "$AGENT_CALLS"
if [[ " $* " == *" login "* ]]; then echo 'unknown command "login"' >&2; exit 1; fi
exit 0
`;
  const run = runInstaller({ agentScript: oldAgent });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cannot sign in from the terminal yet/);
  assert.match(run.stderr, /copy the install command with your token/);
  assert.ok(!run.calls.some((call) => /(^| )onboard( |$)/.test(call)), "must not try to onboard without a token on an old build");
});

test("install.sh stops cleanly when sign-in is not completed", { skip: !hasBash }, () => {
  const abandoned = `#!/bin/bash
echo "$*" >> "$AGENT_CALLS"
if [[ " $* " == *" onboard "* ]]; then exit 1; fi
exit 0
`;
  const run = runInstaller({ agentScript: abandoned });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Sign-in was not completed, so nothing was connected/);
  assert.match(run.stderr, /install\.sh \| bash/);
});

test("install.sh on an already connected machine refreshes it without a second sign-in", { skip: !hasBash }, () => {
  const run = runInstaller({ agentScript: signInCapableAgent, existingConfig: true });
  assert.match(run.stdout, /already connected on this machine/);
  assert.ok(!run.calls.some((call) => /(^| )onboard( |$)/.test(call) && !call.includes("--complete")), run.calls.join(" | "));
  assert.ok(run.calls.some((call) => /(^| )setup$/.test(call)), run.calls.join(" | "));
});
