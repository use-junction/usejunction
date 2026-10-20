import assert from "node:assert/strict";
import { test } from "vitest";
import { prisma } from "@usejunction/db";
import { applyDeviceAccountInventory } from "@/lib/sync/accounts-inventory";
import { reconcileDetectedSeatsForOrg, syncDetectedPlansForDevice } from "@/lib/tools/sync-detected";

const runDb = Boolean(process.env.DATABASE_URL);

async function seed() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({ data: { name: `Seats ${suffix}`, slug: `seats-${suffix}` } });
  const user = await prisma.developer.create({
    data: { orgId: org.id, email: `seats-${suffix}@example.com`, name: "Seat Dev", role: "owner" },
  });
  const device = async (hostname: string) =>
    prisma.device.create({
      data: {
        orgId: org.id,
        userId: user.id,
        hostname,
        os: "darwin",
        architecture: "arm64",
        agentVersion: "test",
        deviceToken: `tok-${hostname}-${suffix}`,
      },
    });
  return { org, user, device };
}

async function activeSeats(orgId: string, developerId: string) {
  const rows = await prisma.developerPlanAssignment.findMany({
    where: { orgId, developerId, active: true, seatStatus: "active" },
    include: { template: { select: { catalogPlanKey: true } } },
  });
  return rows
    .map((row) => `${row.vendorAccountEmail ?? "-"}=${row.template.catalogPlanKey}:${row.source}`)
    .sort();
}

test("every paid login gets its own detected seat, across devices", { skip: !runDb }, async () => {
  const { org, user, device } = await seed();
  try {
    const laptop = await device("laptop");
    const desktop = await device("desktop");
    await applyDeviceAccountInventory({
      orgId: org.id,
      userId: user.id,
      deviceId: laptop.id,
      contentHash: "l1",
      items: [
        { toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team_tier_1", authPresent: true, loginMethod: "oauth" },
        { toolName: "claude", accountKey: "personal@example.com", email: "personal@example.com", plan: "max-5x", authPresent: true, loginMethod: "desktop" },
        // A nameless placeholder never gets a seat while named logins exist.
        { toolName: "claude", accountKey: "claude:abc", plan: "pro", authPresent: true, loginMethod: "desktop" },
      ],
    });
    await applyDeviceAccountInventory({
      orgId: org.id,
      userId: user.id,
      deviceId: desktop.id,
      contentHash: "d1",
      items: [{ toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team-standard", authPresent: true, loginMethod: "oauth" }],
    });
    assert.deepEqual(await activeSeats(org.id, user.id), [
      "personal@example.com=max-5x:detected",
      "work@example.com=team-standard:detected",
    ]);

    // The personal login is signed out on the laptop: its seat ends, the work seat stays.
    await applyDeviceAccountInventory({
      orgId: org.id,
      userId: user.id,
      deviceId: laptop.id,
      contentHash: "l2",
      items: [{ toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team-standard", authPresent: true, loginMethod: "oauth" }],
    });
    assert.deepEqual(await activeSeats(org.id, user.id), ["work@example.com=team-standard:detected"]);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("reconcile re-maps a stale detected seat and replaces the old email-less seat", { skip: !runDb }, async () => {
  const { org, user, device } = await seed();
  try {
    const laptop = await device("laptop");
    await prisma.toolAccount.create({
      data: { orgId: org.id, userId: user.id, deviceId: laptop.id, toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team_tier_1", authPresent: true },
    });
    // A seat created before the Team mapping existed: Free, and with no login email.
    const freeTemplate = await prisma.billingPlanTemplate.create({
      data: {
        orgId: org.id,
        toolKey: "claude",
        catalogPlanKey: "free",
        name: "Free",
        tier: "Free",
        provider: "anthropic",
        product: "claude",
        toolName: "claude",
        priceSource: "detected",
        createdByUserId: user.id,
      },
    });
    await prisma.developerPlanAssignment.create({
      data: {
        orgId: org.id,
        developerId: user.id,
        planTemplateId: freeTemplate.id,
        provider: "anthropic",
        product: "claude",
        toolName: "claude",
        planName: "Free",
        startDate: new Date(),
        source: "detected",
        createdByUserId: user.id,
      },
    });

    await reconcileDetectedSeatsForOrg(org.id);
    assert.deepEqual(await activeSeats(org.id, user.id), ["work@example.com=team-standard:detected"]);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("an admin-confirmed seat leaves that person's detected seats alone", { skip: !runDb }, async () => {
  const { org, user, device } = await seed();
  try {
    const laptop = await device("laptop");
    await prisma.toolAccount.create({
      data: { orgId: org.id, userId: user.id, deviceId: laptop.id, toolName: "claude", accountKey: "a@example.com", email: "a@example.com", plan: "pro", authPresent: true },
    });
    const template = await prisma.billingPlanTemplate.create({
      data: {
        orgId: org.id,
        toolKey: "claude",
        catalogPlanKey: "max-20x",
        name: "Max 20x",
        tier: "Max",
        provider: "anthropic",
        product: "claude",
        toolName: "claude",
        priceSource: "catalog",
        createdByUserId: user.id,
      },
    });
    await prisma.developerPlanAssignment.create({
      data: {
        orgId: org.id,
        developerId: user.id,
        planTemplateId: template.id,
        provider: "anthropic",
        product: "claude",
        toolName: "claude",
        planName: "Max 20x",
        startDate: new Date(),
        source: "admin_confirmed",
        createdByUserId: user.id,
      },
    });

    await syncDetectedPlansForDevice({ orgId: org.id, developerId: user.id });
    assert.deepEqual(await activeSeats(org.id, user.id), ["-=max-20x:admin_confirmed"]);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("concurrent syncs never duplicate a login's seat, and old duplicates are cleaned up", { skip: !runDb }, async () => {
  const { org, user, device } = await seed();
  try {
    const laptop = await device("laptop");
    await prisma.toolAccount.createMany({
      data: [
        { orgId: org.id, userId: user.id, deviceId: laptop.id, toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team-standard", authPresent: true },
        { orgId: org.id, userId: user.id, deviceId: laptop.id, toolName: "claude", accountKey: "personal@example.com", email: "personal@example.com", plan: "pro", authPresent: true },
      ],
    });

    // The reconcile cron fires for two regions against one database at once.
    await Promise.all([reconcileDetectedSeatsForOrg(org.id), reconcileDetectedSeatsForOrg(org.id), syncDetectedPlansForDevice({ orgId: org.id, developerId: user.id })]);
    assert.deepEqual(await activeSeats(org.id, user.id), [
      "personal@example.com=pro:detected",
      "work@example.com=team-standard:detected",
    ]);

    // A duplicate left by an older, unlocked sync is ended on the next pass, and
    // the auto-detected plan's seat count shrinks back to the seats held.
    const work = await prisma.developerPlanAssignment.findFirstOrThrow({
      where: { orgId: org.id, developerId: user.id, vendorAccountEmail: "work@example.com", active: true },
    });
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = work;
    await prisma.developerPlanAssignment.create({ data: copy });
    await prisma.billingPlanTemplate.update({ where: { id: work.planTemplateId }, data: { seatCapacity: 6 } });

    await reconcileDetectedSeatsForOrg(org.id);
    assert.deepEqual(await activeSeats(org.id, user.id), [
      "personal@example.com=pro:detected",
      "work@example.com=team-standard:detected",
    ]);
    const template = await prisma.billingPlanTemplate.findUniqueOrThrow({ where: { id: work.planTemplateId } });
    assert.equal(template.seatCapacity, 1);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("reconcile ends seats held by removed people or people with no live login", { skip: !runDb }, async () => {
  const { org, user, device } = await seed();
  try {
    const laptop = await device("laptop");
    await prisma.toolAccount.create({
      data: { orgId: org.id, userId: user.id, deviceId: laptop.id, toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team-standard", authPresent: true },
    });
    await reconcileDetectedSeatsForOrg(org.id);
    assert.deepEqual(await activeSeats(org.id, user.id), ["work@example.com=team-standard:detected"]);

    // The device is decommissioned: nobody holds that login any more.
    await prisma.device.update({ where: { id: laptop.id }, data: { decommissionedAt: new Date() } });
    const result = await reconcileDetectedSeatsForOrg(org.id);
    assert.equal(result.ended, 1);
    assert.deepEqual(await activeSeats(org.id, user.id), []);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("a login silent for 30 days loses its seat and drops off the tool page", { skip: !runDb }, async () => {
  const { org, user, device } = await seed();
  try {
    const laptop = await device("laptop");
    const oldMac = await device("old-mac");
    await prisma.toolAccount.createMany({
      data: [
        { orgId: org.id, userId: user.id, deviceId: laptop.id, toolName: "claude", accountKey: "work@example.com", email: "work@example.com", plan: "team-standard", authPresent: true },
        { orgId: org.id, userId: user.id, deviceId: oldMac.id, toolName: "claude", accountKey: "old@example.com", email: "old@example.com", plan: "max-5x", authPresent: true },
      ],
    });
    await reconcileDetectedSeatsForOrg(org.id);
    assert.deepEqual(await activeSeats(org.id, user.id), [
      "old@example.com=max-5x:detected",
      "work@example.com=team-standard:detected",
    ]);

    await prisma.device.update({ where: { id: oldMac.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } });
    await reconcileDetectedSeatsForOrg(org.id);
    assert.deepEqual(await activeSeats(org.id, user.id), ["work@example.com=team-standard:detected"]);

    const { getToolDetail } = await import("@/lib/queries/dashboard/tool-detail");
    const detail = await getToolDetail(org.id, "claude");
    assert.deepEqual(detail?.accounts.map((account) => account.accountKey), ["work@example.com"]);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
