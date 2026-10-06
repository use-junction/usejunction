import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import {
  applyDeviceQuotaInventory,
  pruneQuotaToolsMissingWindows,
} from "@/lib/sync/quotas-inventory";

const runDb = Boolean(process.env.DATABASE_URL);

test(
  "applyDeviceQuotaInventory prunes quota windows missing from the current tool payload",
  { skip: !runDb },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await prisma.organization.create({
      data: { name: `Quota Prune Org ${suffix}`, slug: `quota-prune-${suffix}` },
    });
    const user = await prisma.developer.create({
      data: {
        orgId: org.id,
        email: `quota-prune-${suffix}@example.com`,
        name: "Quota Prune Dev",
        role: "owner",
      },
    });
    const device = await prisma.device.create({
      data: {
        orgId: org.id,
        userId: user.id,
        hostname: "quota-prune-host",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "test",
        deviceToken: `quota-prune-${suffix}`,
      },
    });

    try {
      await prisma.quotaSnapshot.createMany({
        data: [
          {
            orgId: org.id,
            deviceId: device.id,
            toolName: "codex",
            windowType: "weekly",
            usedPercent: 2,
            resetAt: new Date("2026-08-05T00:00:00.000Z"),
            source: "oauth_api",
          },
          {
            orgId: org.id,
            deviceId: device.id,
            toolName: "codex",
            windowType: "rate_limit_resets",
            creditsRemaining: 2,
            source: "oauth_api",
          },
          {
            orgId: org.id,
            deviceId: device.id,
            toolName: "cursor",
            windowType: "plan",
            usedPercent: 65,
            source: "cli_rpc",
          },
        ],
      });

      const result = await applyDeviceQuotaInventory({
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        contentHash: "prune-test-hash",
        items: [
          {
            toolName: "codex",
            windowType: "weekly",
            usedPercent: 2,
            resetAt: "2026-08-05T00:00:00.000Z",
            source: "oauth_api",
          },
        ],
      });

      assert.equal(result.upserted, 1);
      assert.equal(result.pruned, 1);

      const remaining = await prisma.quotaSnapshot.findMany({
        where: { deviceId: device.id },
        orderBy: [{ toolName: "asc" }, { windowType: "asc" }],
      });
      assert.equal(remaining.length, 2);
      assert.ok(remaining.some((row) => row.toolName === "codex" && row.windowType === "weekly"));
      assert.ok(remaining.some((row) => row.toolName === "cursor" && row.windowType === "plan"));
      assert.equal(
        remaining.some((row) => row.windowType === "rate_limit_resets"),
        false,
      );
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  },
);

test(
  "applyDeviceQuotaInventory empty payload prunes all device snapshots",
  { skip: !runDb },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await prisma.organization.create({
      data: { name: `Quota Empty Org ${suffix}`, slug: `quota-empty-${suffix}` },
    });
    const user = await prisma.developer.create({
      data: {
        orgId: org.id,
        email: `quota-empty-${suffix}@example.com`,
        name: "Quota Empty Dev",
        role: "owner",
      },
    });
    const device = await prisma.device.create({
      data: {
        orgId: org.id,
        userId: user.id,
        hostname: "quota-empty-host",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "test",
        deviceToken: `quota-empty-${suffix}`,
      },
    });

    try {
      await prisma.quotaSnapshot.create({
        data: {
          orgId: org.id,
          deviceId: device.id,
          toolName: "claude",
          windowType: "weekly",
          usedPercent: 10,
          source: "oauth_api",
        },
      });

      const result = await applyDeviceQuotaInventory({
        orgId: org.id,
        userId: user.id,
        deviceId: device.id,
        contentHash: "empty-quota-hash",
        items: [],
      });

      assert.equal(result.upserted, 0);
      assert.equal(result.pruned, 1);
      const remaining = await prisma.quotaSnapshot.count({ where: { deviceId: device.id } });
      assert.equal(remaining, 0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  },
);

test(
  "pruneQuotaToolsMissingWindows targets account tools without windows",
  { skip: !runDb },
  async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: `Quota Missing Org ${suffix}`, slug: `quota-missing-${suffix}` },
  });
  const user = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `quota-missing-${suffix}@example.com`,
      name: "Quota Missing Dev",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: user.id,
      hostname: "quota-missing-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "test",
      deviceToken: `quota-missing-${suffix}`,
    },
  });

  try {
    await prisma.quotaSnapshot.createMany({
      data: [
        {
          orgId: org.id,
          deviceId: device.id,
          toolName: "claude",
          windowType: "weekly",
          usedPercent: 1,
          source: "oauth_api",
        },
        {
          orgId: org.id,
          deviceId: device.id,
          toolName: "codex",
          windowType: "weekly",
          usedPercent: 2,
          source: "oauth_api",
        },
      ],
    });

    const pruned = await pruneQuotaToolsMissingWindows({
      deviceId: device.id,
      accounts: [{ toolName: "claude" }, { toolName: "codex" }],
      quotas: [{ toolName: "codex" }],
    });
    assert.equal(pruned, 1);
    const remaining = await prisma.quotaSnapshot.findMany({ where: { deviceId: device.id } });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.toolName, "codex");
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
