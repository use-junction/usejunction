import assert from "node:assert/strict";
import { test } from "vitest";
import {
  defaultCollectionFlags,
  developerSwitchBlocked,
  isGatedCollectionTool,
  keepUsageRow,
  loggingEffectivelyEnabled,
  normalizeAccountKey,
  pickExistingAccount,
  usageEffectivelyEnabled,
} from "@/lib/privacy/account-collection-policy";

test("usage collection is on by default and activity logging stays off", () => {
  assert.equal(isGatedCollectionTool("cursor"), true);
  assert.equal(isGatedCollectionTool("codex"), true);
  assert.equal(isGatedCollectionTool("claude"), true);
  assert.equal(isGatedCollectionTool("  "), false);
  assert.equal(defaultCollectionFlags("cursor").usageEnabled, true);
  assert.equal(defaultCollectionFlags("claude").loggingEnabled, false);
});

test("normalizeAccountKey prefers a stable id then email", () => {
  assert.equal(normalizeAccountKey("user-1", "a@x.com"), "user-1");
  assert.equal(normalizeAccountKey("", "A@X.com"), "a@x.com");
  assert.equal(normalizeAccountKey(null, "  "), "");
});

test("effective switches require person opt-in without an admin lock", () => {
  assert.equal(usageEffectivelyEnabled({ usageEnabled: true, loggingEnabled: true, usageAdminLocked: false, loggingAdminLocked: false }), true);
  assert.equal(usageEffectivelyEnabled({ usageEnabled: true, loggingEnabled: true, usageAdminLocked: true, loggingAdminLocked: false }), false);
  assert.equal(loggingEffectivelyEnabled({ usageEnabled: false, loggingEnabled: true, usageAdminLocked: false, loggingAdminLocked: true }), false);
});

test("inventory match keeps two Cursor accounts distinct and upgrades a legacy email row", () => {
  const first = { id: "1", accountKey: "user-a", email: "a@x.com" };
  const second = { id: "2", accountKey: "user-b", email: "b@x.com" };
  assert.equal(pickExistingAccount([first, second], { accountKey: "user-b", email: "b@x.com" })?.id, "2");
  assert.equal(pickExistingAccount([first, second], { accountKey: "user-c", email: "c@x.com" }), null);
  assert.equal(
    pickExistingAccount([{ id: "legacy", accountKey: "a@x.com", email: "a@x.com" }], { accountKey: "user-a", email: "a@x.com" })?.id,
    "legacy",
  );
});

test("person cannot clear an admin lock", () => {
  const locked = {
    usageEnabled: false,
    loggingEnabled: false,
    usageAdminLocked: true,
    loggingAdminLocked: false,
  };
  assert.equal(developerSwitchBlocked(locked, "usage"), "An admin has locked usage collection for this account.");
  assert.equal(developerSwitchBlocked(locked, "logging"), null);
});

test("admin lock is a separate switch from person opt-in", () => {
  assert.equal(
    usageEffectivelyEnabled({
      usageEnabled: true,
      loggingEnabled: true,
      usageAdminLocked: true,
      loggingAdminLocked: false,
    }),
    false,
  );
});

test("ingest drops a provider account that is not opted in", () => {
  const allowed = new Set(["cursor\0user-1"]);
  assert.equal(keepUsageRow("claude", "user-1", allowed), false);
  assert.equal(keepUsageRow("cursor", "user-1", allowed), true);
  assert.equal(keepUsageRow("cursor", "user-2", allowed), false);
  assert.equal(keepUsageRow("cursor", "", allowed), false);
  assert.equal(keepUsageRow("", "user-1", allowed), false);
});

test("any number of logins can be opted in independently", () => {
  const allowed = new Set(["cursor\0personal", "cursor\0contractor"]);
  assert.equal(keepUsageRow("cursor", "personal", allowed), true);
  assert.equal(keepUsageRow("cursor", "work", allowed), false);
  assert.equal(keepUsageRow("cursor", "contractor", allowed), true);
});
