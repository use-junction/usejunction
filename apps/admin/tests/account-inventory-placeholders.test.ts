import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import { applyDeviceAccountInventory } from "@/lib/sync/accounts-inventory";

const runDb = Boolean(process.env.DATABASE_URL);

async function seedDevice() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Placeholder Org ${suffix}`, slug: `placeholder-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: { orgId: org.id, email: `p-${suffix}@example.com`, name: "Placeholder Dev", role: "owner" },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "placeholder-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `tok-${suffix}`,
    },
  });
  return { org, user, device };
}

test(
  "a placeholder login renamed to its email is removed with its quota windows",
  { skip: !runDb },
  async () => {
    const { org, user, device } = await seedDevice();
    try {
      const placeholderKey = "claude:0d9a33e1-8b2e-4885-8296-8f44ac33bb99";
      const stillUnnamedKey = "claude:73efe64a-c2cf-4e4d-9259-ade7b937c7b1";
      await applyDeviceAccountInventory({
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        contentHash: "h1",
        runPlanSync: false,
        items: [
          { toolName: "claude", accountKey: placeholderKey, orgKey: "org-team", authPresent: true, loginMethod: "desktop" },
          { toolName: "claude", accountKey: stillUnnamedKey, orgKey: "org-other", authPresent: true, loginMethod: "desktop" },
        ],
      });
      await prisma.quotaSnapshot.create({
        data: { orgId: org.id, deviceId: device.id, toolName: "claude", accountKey: placeholderKey, windowType: "session_5h", usedPercent: 0 },
      });

      // The agent learned the first login's email, so it now reports the email key.
      await applyDeviceAccountInventory({
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        contentHash: "h2",
        runPlanSync: false,
        items: [
          { toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team-standard", orgKey: "org-team", authPresent: true, loginMethod: "oauth" },
          { toolName: "claude", accountKey: stillUnnamedKey, orgKey: "org-other", authPresent: true, loginMethod: "desktop" },
        ],
      });

      const rows = await prisma.toolAccount.findMany({ where: { deviceId: device.id }, orderBy: { accountKey: "asc" } });
      assert.deepEqual(
        rows.map((row) => row.accountKey),
        [stillUnnamedKey, "work@example.com"],
      );
      const quotas = await prisma.quotaSnapshot.count({ where: { deviceId: device.id, accountKey: placeholderKey } });
      assert.equal(quotas, 0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  },
);

test(
  "a nameless placeholder does not claim the legacy row and its plan",
  { skip: !runDb },
  async () => {
    const { org, user, device } = await seedDevice();
    try {
      await prisma.toolAccount.create({
        data: { orgId: org.id, userId: user.id, deviceId: device.id, toolName: "claude", accountKey: "", plan: "pro", authPresent: true },
      });
      await applyDeviceAccountInventory({
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        contentHash: "h1",
        runPlanSync: false,
        items: [{ toolName: "claude", accountKey: "claude:aaaa", authPresent: true, loginMethod: "desktop" }],
      });
      const placeholder = await prisma.toolAccount.findFirst({ where: { deviceId: device.id, accountKey: "claude:aaaa" } });
      assert.equal(placeholder?.plan ?? null, null);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  },
);
