import assert from "node:assert/strict";
import { test } from "vitest";
import {
  accountsInventoryCanonicalLine,
  accountsInventoryContentHash,
  resolveStickyAccountPlan,
} from "@/lib/sync/accounts-inventory";
import {
  quotasInventoryCanonicalLine,
  quotasInventoryContentHash,
} from "@/lib/sync/quotas-inventory";

test("accountsInventoryContentHash is stable under reorder", () => {
  const a = accountsInventoryContentHash([
    { toolName: "cursor", email: "a@x.com", plan: "pro", loginMethod: "local_app", authPresent: true },
    { toolName: "codex", email: "", plan: "plus", loginMethod: "chatgpt", authPresent: true },
  ]);
  const b = accountsInventoryContentHash([
    { toolName: "codex", email: "", plan: "plus", loginMethod: "chatgpt", authPresent: true },
    { toolName: "cursor", email: "a@x.com", plan: "pro", loginMethod: "local_app", authPresent: true },
  ]);
  assert.equal(a, b);
  assert.equal(a.length, 32);
});

test("accountsInventoryContentHash changes when plan flips", () => {
  const base = accountsInventoryContentHash([
    { toolName: "cursor", plan: "pro", authPresent: true },
  ]);
  const changed = accountsInventoryContentHash([
    { toolName: "cursor", plan: "pro_plus", authPresent: true },
  ]);
  assert.notEqual(base, changed);
});

test("accountsInventoryCanonicalLine matches agent format", () => {
  assert.equal(
    accountsInventoryCanonicalLine({
      toolName: "cursor",
      email: "a@x.com",
      plan: "pro",
      loginMethod: "local_app",
      authPresent: true,
    }),
    "cursor||a@x.com|pro|local_app|1",
  );
});

test("accountsInventoryContentHash matches agent fixture", () => {
  assert.equal(
    accountsInventoryContentHash([
      { toolName: "cursor", email: "a@x.com", plan: "pro", loginMethod: "local_app", authPresent: true },
      { toolName: "codex", email: "", plan: "plus", loginMethod: "chatgpt", authPresent: true },
    ]),
    "ffd1b111476f51ed1268d111947636e6",
  );
});

test("resolveStickyAccountPlan prefers incoming and clears on auth drop", () => {
  assert.equal(
    resolveStickyAccountPlan({ incomingPlan: "team-standard", existingPlan: "pro", authPresent: true }),
    "team-standard",
  );
  assert.equal(
    resolveStickyAccountPlan({ incomingPlan: "", existingPlan: "pro", authPresent: true }),
    "pro",
  );
  assert.equal(
    resolveStickyAccountPlan({ incomingPlan: "", existingPlan: "pro", authPresent: false }),
    null,
  );
});

test("quotasInventoryContentHash is stable under reorder", () => {
  const a = quotasInventoryContentHash([
    { toolName: "cursor", windowType: "plan", usedPercent: 42.5, source: "api" },
    { toolName: "codex", windowType: "weekly", source: "cli_rpc" },
  ]);
  const b = quotasInventoryContentHash([
    { toolName: "codex", windowType: "weekly", source: "cli_rpc" },
    { toolName: "cursor", windowType: "plan", usedPercent: 42.5, source: "api" },
  ]);
  assert.equal(a, b);
  assert.equal(a.length, 32);
});

test("quotasInventoryContentHash changes when usedPercent flips", () => {
  const base = quotasInventoryContentHash([
    { toolName: "cursor", windowType: "plan", usedPercent: 10, source: "api" },
  ]);
  const changed = quotasInventoryContentHash([
    { toolName: "cursor", windowType: "plan", usedPercent: 20, source: "api" },
  ]);
  assert.notEqual(base, changed);
});

test("quotasInventoryCanonicalLine matches agent format", () => {
  assert.equal(
    quotasInventoryCanonicalLine({
      toolName: "cursor",
      windowType: "plan",
      usedPercent: 42.5,
      source: "api",
    }),
    "cursor|plan|42.5|||api",
  );
});

test("quotasInventoryContentHash matches agent fixture", () => {
  assert.equal(
    quotasInventoryContentHash([
      { toolName: "cursor", windowType: "plan", usedPercent: 42.5, source: "api" },
      { toolName: "codex", windowType: "weekly", source: "cli_rpc" },
    ]),
    "a43d9dbece2f35b691801475721f9c92",
  );
});
