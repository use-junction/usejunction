/**
 * OpenCode ingest integration: local usage + work sessions + filter options.
 * Run with DATABASE_URL set (apps/admin/.env → localhost:5432).
 */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { prisma } from "@usejunction/db";
import { ingestLocalUsageBatch } from "@/lib/ingest/local-usage-batch";
import { readSignalsFilterOptions } from "@/lib/signals/readers/filter-options";
import { getWorkActivity } from "@/lib/signals/queries/get-work-activity";

const runDb = Boolean(process.env.DATABASE_URL);

async function seedOrg(suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `OpenCode Ingest ${suffix}`, slug: `opencode-ingest-${suffix}` },
  });
  const developer = await prisma.developer.create({
    data: {
      orgId: org.id,
      email: `opencode-ingest-${suffix}@example.com`,
      name: "OpenCode Ingest",
      role: "owner",
    },
  });
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: developer.id,
      hostname: "opencode-host",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "0.3.1",
      deviceToken: `opencode-ingest-tok-${suffix}`,
    },
  });
  await prisma.signalsPolicy.create({
    data: {
      orgId: org.id,
      enabled: true,
      retentionDays: 90,
      collectionMode: "app_domain",
      excludedApps: [],
      excludedDomains: [],
      storeEvents: false,
      workExtractionEnabled: true,
      workExtractionStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
  return { org, developer, device };
}

test("opencode usage ingest stores actual spend and productivity rows", { skip: !runDb }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, developer, device } = await seedOrg(suffix);

  try {
    const result = await ingestLocalUsageBatch({
      orgId: org.id,
      userId: developer.id,
      deviceId: device.id,
      rows: [
        {
          date: "2026-07-21",
          toolName: "opencode",
          model: "opencode-go/kimi-k2.7-code",
          source: "opencode_usage",
          inputTokens: 121_126,
          outputTokens: 8_927,
          cacheReadTokens: 1_186_170,
          estimatedCost: 0.37615,
          costKind: "actual_spend",
          requests: 28,
        },
        {
          date: "2026-07-21",
          toolName: "opencode",
          model: "opencode",
          source: "opencode_local",
          metricKind: "productivity",
          addedLines: 120,
          deletedLines: 30,
          requests: 3,
        },
      ],
    });

    assert.equal(result.upserted, 2);

    const rows = await prisma.usageDaily.findMany({
      where: { orgId: org.id, toolName: "opencode" },
      orderBy: { model: "asc" },
    });
    assert.equal(rows.length, 2);

    const usage = rows.find((row) => row.model === "opencode-go/kimi-k2.7-code");
    assert.ok(usage);
    assert.equal(usage.source, "device_observed");
    assert.equal(usage.costKind, "actual_spend");
    assert.equal(usage.metricKind, "usage");
    assert.equal(Number(usage.costMicros), 376_150);

    const productivity = rows.find((row) => row.model === "opencode");
    assert.ok(productivity);
    assert.equal(productivity.metricKind, "productivity");
    assert.equal(Number(productivity.addedLines), 120);
    assert.equal(Number(productivity.deletedLines), 30);
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
  }
});

test("opencode work sessions surface in activity filters and work feed", { skip: !runDb }, async () => {
  vi.stubEnv("NEXT_PUBLIC_SIGNALS_PRODUCT_ENABLED", "true");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { org, developer, device } = await seedOrg(suffix);

  try {
    await prisma.localWorkSession.create({
      data: {
        orgId: org.id,
        developerId: developer.id,
        deviceId: device.id,
        localId: `opencode:ses-${suffix}`,
        toolName: "opencode",
        model: "opencode/big-pickle",
        title: "Ship onboarding polish",
        observedAt: new Date("2026-07-21T12:00:00.000Z"),
        source: "opencode_sessions",
      },
    });

    const options = await readSignalsFilterOptions(org.id);
    assert.ok(options.tools.includes("opencode"));

    const activity = await getWorkActivity(
      {
        orgId: org.id,
        actorId: developer.id,
        roles: ["owner"],
        now: new Date("2026-07-21T12:00:00.000Z"),
        timezone: "UTC",
      },
      { days: 30, tool: "opencode" },
    );
    assert.ok(activity.data.sessions.some((session) => session.toolName === "opencode"));
    assert.ok(activity.data.sessions.some((session) => session.title === "Ship onboarding polish"));
  } finally {
    vi.unstubAllEnvs();
    await prisma.organization.delete({ where: { id: org.id } });
  }
});
