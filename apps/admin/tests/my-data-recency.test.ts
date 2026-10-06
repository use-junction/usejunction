import assert from "node:assert/strict";
import { test } from "vitest";
import type { PublicCollectionAccount } from "@/lib/privacy/account-collection-types";
import {
  attachUsageStorage,
  formatStoredUsageDay,
  preferenceEventCopy,
  usageRetentionCutoff,
  usageStorageCopy,
} from "@/lib/privacy/my-data-recency";

function account(partial: Partial<PublicCollectionAccount> & Pick<PublicCollectionAccount, "id" | "deviceId" | "accountKey">): PublicCollectionAccount {
  return {
    hostname: "laptop",
    toolName: "cursor",
    displayName: "Cursor",
    email: "me@work.com",
    plan: "pro",
    authPresent: true,
    usageEnabled: true,
    loggingEnabled: false,
    usageAdminLocked: false,
    loggingAdminLocked: false,
    usageAllowed: true,
    loggingAllowed: false,
    updatedAt: "2026-09-23T00:00:00.000Z",
    ...partial,
  };
}

test("device-scoped matching keeps the same login distinct across machines", () => {
  const stored = attachUsageStorage(
    [
      account({ id: "1", deviceId: "laptop", accountKey: "work", email: "me@work.com" }),
      account({ id: "2", deviceId: "desktop", accountKey: "work", email: "me@work.com", hostname: "desktop" }),
    ],
    [
      { deviceId: "laptop", toolName: "cursor", accountKey: "work", lastUsageDay: "2026-09-20" },
      { deviceId: "desktop", toolName: "cursor", accountKey: "work", lastUsageDay: "2026-09-22" },
    ],
  );
  assert.equal(stored.accounts[0]?.usageStorage.lastUsageDay, "2026-09-20");
  assert.equal(stored.accounts[1]?.usageStorage.lastUsageDay, "2026-09-22");
  assert.equal(stored.latestStoredUsageDay, "2026-09-22");
  assert.equal(stored.hasUnattributedUsage, false);
});

test("legacy empty account keys never attach to a named login", () => {
  const stored = attachUsageStorage(
    [account({ id: "1", deviceId: "laptop", accountKey: "work", usageAllowed: true })],
    [
      { deviceId: "laptop", toolName: "cursor", accountKey: "", lastUsageDay: "2026-09-21" },
      { deviceId: null, toolName: "cursor", accountKey: "work", lastUsageDay: "2026-09-22" },
    ],
  );
  assert.equal(stored.accounts[0]?.usageStorage.state, "none");
  assert.equal(stored.accounts[0]?.usageStorage.lastUsageDay, null);
  assert.equal(stored.hasUnattributedUsage, true);
  assert.equal(stored.latestStoredUsageDay, "2026-09-22");
});

test("empty-key inventory can own empty-key usage, unmatched named rows stay unattributed", () => {
  const stored = attachUsageStorage(
    [
      account({ id: "1", deviceId: "laptop", accountKey: "", email: null, usageAllowed: false }),
      account({ id: "2", deviceId: "laptop", accountKey: "work", toolName: "opencode", displayName: "OpenCode" }),
    ],
    [
      { deviceId: "laptop", toolName: "cursor", accountKey: "", lastUsageDay: "2026-09-10" },
      { deviceId: "laptop", toolName: "claude", accountKey: "ghost", lastUsageDay: "2026-09-11" },
    ],
  );
  assert.equal(stored.accounts[0]?.usageStorage.state, "historical_day");
  assert.equal(stored.accounts[0]?.usageStorage.lastUsageDay, "2026-09-10");
  assert.equal(stored.accounts[1]?.usageStorage.state, "none");
  assert.equal(stored.hasUnattributedUsage, true);
});

test("active versus historical storage state follows the effective usage switch", () => {
  const stored = attachUsageStorage(
    [
      account({ id: "on", deviceId: "laptop", accountKey: "work", usageAllowed: true }),
      account({
        id: "off",
        deviceId: "laptop",
        accountKey: "personal",
        email: "me@home.com",
        usageAllowed: false,
        usageEnabled: false,
      }),
    ],
    [
      { deviceId: "laptop", toolName: "cursor", accountKey: "work", lastUsageDay: "2026-09-23" },
      { deviceId: "laptop", toolName: "cursor", accountKey: "personal", lastUsageDay: "2026-08-01" },
    ],
  );
  assert.equal(stored.accounts[0]?.usageStorage.state, "active_day");
  assert.match(usageStorageCopy(stored.accounts[0]!, "en-GB"), /Last stored usage day: 23 Sep/);
  assert.equal(stored.accounts[1]?.usageStorage.state, "historical_day");
  assert.match(usageStorageCopy(stored.accounts[1]!, "en-GB"), /^Usage off · last stored day /);
});

test("none state copy distinguishes collecting from paused logins", () => {
  const collecting = account({ id: "1", deviceId: "d", accountKey: "a", usageAllowed: true });
  const paused = account({ id: "2", deviceId: "d", accountKey: "b", usageAllowed: false, usageEnabled: false });
  assert.equal(usageStorageCopy({ ...collecting, usageStorage: { state: "none", lastUsageDay: null } }), "Usage on · no days stored yet");
  assert.equal(usageStorageCopy({ ...paused, usageStorage: { state: "none", lastUsageDay: null } }), "Usage off · nothing stored for this login");
});

test("stored range and request totals roll up per login", () => {
  const stored = attachUsageStorage(
    [account({ id: "1", deviceId: "laptop", accountKey: "work" })],
    [
      { deviceId: "laptop", toolName: "cursor", accountKey: "work", lastUsageDay: "2026-09-20", firstUsageDay: "2026-08-01", requests: 40 },
      { deviceId: "laptop", toolName: "cursor", accountKey: "work", lastUsageDay: "2026-09-22", firstUsageDay: "2026-09-01", requests: 2 },
    ],
  );
  assert.deepEqual(stored.accounts[0]?.usageStorage, {
    state: "active_day",
    lastUsageDay: "2026-09-22",
    firstUsageDay: "2026-08-01",
    storedRequests: 42,
  });
  assert.match(usageStorageCopy(stored.accounts[0]!, "en-GB"), /since 1 Aug 2026/);
  assert.match(usageStorageCopy(stored.accounts[0]!, "en-GB"), /42 requests stored/);
});

test("retention cutoff is a rolling window from now", () => {
  const cutoff = usageRetentionCutoff(90, new Date("2026-09-23T00:00:00.000Z"));
  assert.equal(cutoff.toISOString(), "2026-06-25T00:00:00.000Z");
});

test("locale-aware stored usage days stay calendar dates, not ingest clocks", () => {
  assert.match(formatStoredUsageDay("2026-09-23", "en-GB"), /23 Sep/);
  assert.match(
    preferenceEventCopy({
      createdAt: "2026-09-23T09:15:00.000Z",
      actor: "developer",
      stream: "usage",
      enabled: false,
      displayName: "Cursor",
      email: "me@work.com",
      hostname: "laptop",
    }, "en-GB"),
    /You turned Usage off for Cursor · me@work.com on laptop/,
  );
  assert.match(
    preferenceEventCopy({
      createdAt: "2026-09-23T09:15:00.000Z",
      actor: "admin",
      stream: "logging",
      enabled: true,
      displayName: "OpenCode",
      email: null,
      hostname: "desktop",
    }, "en-GB"),
    /Workspace admin turned Activity logging on for OpenCode · this device on desktop/,
  );
});

test("collection notice defines usage, logging, and who can see the data", async () => {
  const { collectionNoticeCopy } = await import("@/lib/privacy/collection-notice");
  const copy = collectionNoticeCopy({ orgName: "Acme", usageRetentionDays: 90 });
  assert.match(copy.usageDefinition, /Turning Usage off stops new uploads/);
  assert.match(copy.loggingDefinition, /not collected or stored in EU workspaces/);
  assert.match(copy.whoSees, /My data/);
  assert.match(copy.retention, /organization decides how long usage is kept/i);
  assert.doesNotMatch(copy.retention, /90 days|365 days|3 years/);
  assert.ok(copy.neverCollects.some((item) => /Keystrokes/.test(item)));
});
