import { describe, expect, it } from "vitest";
import {
  attachRepositoryIds,
  buildUsageDedupeKey,
  collapseLocalUsageRows,
  inferCostKind,
  inferMetricKind,
  normalizeCanonicalSource,
  normalizeLocalUsageRows,
  providerForTool,
  repositoryKey,
} from "@/lib/ingest/local-usage-batch";
import { resolveModelUsageCostKind } from "@/lib/usage/classify";

describe("local-usage-batch normalize", () => {
  it("maps providers and canonical sources", () => {
    expect(providerForTool("claude")).toBe("anthropic");
    expect(providerForTool("codex")).toBe("openai");
    expect(providerForTool("cursor")).toBe("cursor");
    expect(providerForTool("opencode")).toBe("opencode");
    expect(normalizeCanonicalSource("local_scan")).toBe("device_observed");
    expect(normalizeCanonicalSource("cursor_usage_events")).toBe("vendor_verified");
    expect(normalizeCanonicalSource("otel_observed")).toBe("otel_observed");
    expect(normalizeCanonicalSource("opencode_usage")).toBe("device_observed");
    expect(normalizeCanonicalSource("opencode_local")).toBe("device_observed");
  });

  it("infers productivity metric kind for cursor_local and line-only rows", () => {
    expect(inferMetricKind({ date: "2026-07-21", toolName: "cursor" }, "cursor_local")).toBe("productivity");
    expect(inferMetricKind({ date: "2026-07-21", toolName: "opencode" }, "opencode_local")).toBe("productivity");
    expect(
      inferMetricKind(
        { date: "2026-07-21", toolName: "cursor", suggestedLines: 10, acceptedLines: 4 },
        "local_scan",
      ),
    ).toBe("productivity");
    expect(
      inferMetricKind(
        { date: "2026-07-21", toolName: "codex", inputTokens: 10, outputTokens: 2, requests: 1 },
        "local_scan",
      ),
    ).toBe("usage");
    expect(
      inferMetricKind(
        { date: "2026-07-21", toolName: "opencode", inputTokens: 10, outputTokens: 2, requests: 1 },
        "opencode_usage",
      ),
    ).toBe("usage");
  });

  it("infers cost kinds from verified / estimated signals", () => {
    expect(inferCostKind({ date: "d", toolName: "t" }, "local_scan", 0)).toBeNull();
    expect(inferCostKind({ date: "d", toolName: "t", verified: true }, "local_scan", 1.2)).toBe("verified_usage");
    expect(inferCostKind({ date: "d", toolName: "t" }, "cursor_usage_events", 1.2)).toBe("verified_usage");
    expect(inferCostKind({ date: "d", toolName: "t" }, "local_scan", 1.2)).toBe("estimated_api");
  });

  it("resolves stored model usage cost kinds for device-observed spend", () => {
    expect(resolveModelUsageCostKind({ source: "device_observed", cost: 0.42, storedCostKind: "actual_spend" })).toBe("actual_spend");
    expect(resolveModelUsageCostKind({ source: "device_observed", cost: 0.42, storedCostKind: null })).toBe("estimated_api");
    expect(resolveModelUsageCostKind({ source: "vendor_verified", cost: 1.2, storedCostKind: null })).toBe("verified_usage");
  });

  it("drops invalid rows and builds dedupe keys", () => {
    const rows = normalizeLocalUsageRows(
      [
        { date: "2026-07-21", toolName: "codex", model: "gpt", inputTokens: 100, outputTokens: 20, requests: 3, estimatedCost: 0.5 },
        { date: "not-a-date", toolName: "codex" },
        { date: "2026-07-21", toolName: "" },
        { date: "2026-07-21", toolName: "cursor", source: "cursor_local", suggestedLines: 5, acceptedLines: 2 },
        { date: "2026-07-20", toolName: "codex", estimatedCost: -1 },
      ],
      { deviceId: "device-1" },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].dedupeKey).toBe(
      buildUsageDedupeKey({
        deviceId: "device-1",
        dateKey: "2026-07-21",
        toolName: "codex",
        accountKey: "",
        model: "gpt",
        source: "local_scan",
        repositoryId: null,
      }),
    );
    expect(rows[0].canonicalSource).toBe("device_observed");
    expect(rows[0].costMicros).toBe(BigInt(500_000));
    expect(rows[1].metricKind).toBe("productivity");
    expect(rows[1].requests).toBe(0);
  });

  it("preserves productivity requests for tool:/flow: models", () => {
    const [row] = normalizeLocalUsageRows(
      [
        {
          date: "2026-07-21",
          toolName: "codex",
          model: "tool:shell",
          source: "local_scan",
          metricKind: "productivity",
          requests: 9,
          suggestedLines: 1,
        },
      ],
      { deviceId: "device-1" },
    );
    expect(row.requests).toBe(9);
  });

  it("attaches repository ids into dedupe keys", () => {
    const normalized = normalizeLocalUsageRows(
      [
        {
          date: "2026-07-21",
          toolName: "codex",
          model: "gpt",
          repository: { host: "GitHub.com", owner: "acme", name: "demo" },
          inputTokens: 1,
        },
      ],
      { deviceId: "device-1" },
    );
    const key = repositoryKey({ host: "github.com", owner: "acme", name: "demo" });
    const attached = attachRepositoryIds(normalized, "device-1", new Map([[key, "repo-123"]]));
    expect(attached[0].repositoryId).toBe("repo-123");
    expect(attached[0].dedupeKey).toContain(":repo-123");
  });

  it("collapses duplicate local unique keys with last-write-wins", () => {
    const normalized = normalizeLocalUsageRows(
      [
        { date: "2026-07-21", toolName: "codex", model: "gpt", inputTokens: 10, outputTokens: 1, requests: 1 },
        { date: "2026-07-21", toolName: "codex", model: "gpt", inputTokens: 99, outputTokens: 9, requests: 4 },
        { date: "2026-07-21", toolName: "codex", model: "other", inputTokens: 5, requests: 1 },
      ],
      { deviceId: "device-1" },
    );
    const collapsed = collapseLocalUsageRows(normalized);
    expect(collapsed).toHaveLength(2);
    const gpt = collapsed.find((row) => row.model === "gpt");
    expect(gpt?.inputTokens).toBe(99);
    expect(gpt?.outputTokens).toBe(9);
    expect(gpt?.requests).toBe(4);
  });

  it("keeps every login's usage on the same day as its own row", () => {
    const collapsed = collapseLocalUsageRows(
      normalizeLocalUsageRows(
        [
          { date: "2026-07-21", toolName: "codex", accountKey: "personal", model: "gpt", inputTokens: 10, requests: 1 },
          { date: "2026-07-21", toolName: "codex", accountKey: "work", model: "gpt", inputTokens: 20, requests: 2 },
          { date: "2026-07-21", toolName: "codex", accountKey: "contractor", model: "gpt", inputTokens: 5, requests: 1 },
        ],
        { deviceId: "device-1" },
      ),
    );
    expect(collapsed).toHaveLength(3);
    expect(collapsed.map((row) => row.accountKey).sort()).toEqual(["contractor", "personal", "work"]);
    expect(new Set(collapsed.map((row) => row.dedupeKey)).size).toBe(3);
  });

  it("keeps distinct sources for the same device/date/tool/model", () => {
    const normalized = normalizeLocalUsageRows(
      [
        { date: "2026-07-21", toolName: "cursor", model: "composer-2.5", inputTokens: 10, source: "local_scan" },
        { date: "2026-07-21", toolName: "cursor", model: "composer-2.5", inputTokens: 20, source: "cursor_local" },
      ],
      { deviceId: "device-1" },
    );
    const collapsed = collapseLocalUsageRows(normalized);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.map((row) => row.source).sort()).toEqual(["cursor_local", "local_scan"]);
  });

  it("normalizes opencode usage and productivity sources", () => {
    const normalized = normalizeLocalUsageRows(
      [
        {
          date: "2026-07-21",
          toolName: "opencode",
          model: "opencode-go/kimi-k2.7-code",
          source: "opencode_usage",
          inputTokens: 5000,
          outputTokens: 200,
          estimatedCost: 0.42,
          costKind: "actual_spend",
          requests: 4,
        },
        {
          date: "2026-07-21",
          toolName: "opencode",
          model: "opencode",
          source: "opencode_local",
          addedLines: 42,
          deletedLines: 7,
          requests: 1,
        },
      ],
      { deviceId: "device-1" },
    );
    expect(normalized).toHaveLength(2);
    const usage = normalized.find((row) => row.source === "opencode_usage");
    const productivity = normalized.find((row) => row.source === "opencode_local");
    expect(usage?.canonicalSource).toBe("device_observed");
    expect(usage?.costKind).toBe("actual_spend");
    expect(usage?.metricKind).toBe("usage");
    expect(productivity?.metricKind).toBe("productivity");
    expect(productivity?.requests).toBe(0);
  });
});

describe("local-usage-batch ingest", () => {
  it("bulk upserts idempotently", { skip: !process.env.DATABASE_URL, timeout: 30_000 }, async () => {
    const { prisma } = await import("@usejunction/db");
    const { ingestLocalUsageBatch } = await import("@/lib/ingest/local-usage-batch");
    const suffix = Date.now();
    const orgId = `bulk_org_${suffix}`;
    const userId = `bulk_dev_${suffix}`;
    const deviceId = `bulk_device_${suffix}`;

    await prisma.organization.create({ data: { id: orgId, name: "Bulk", slug: orgId } });
    await prisma.developer.create({
      data: { id: userId, orgId, name: "Bulk Dev", email: `bulk_${suffix}@example.com`, role: "user" },
    });
    await prisma.device.create({
      data: {
        id: deviceId,
        orgId,
        userId,
        hostname: "test",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "0.0.0",
        deviceToken: `tok_${suffix}`,
      },
    });

    try {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        date: "2026-07-21",
        toolName: "codex",
        model: `model-${i}`,
        inputTokens: 100 + i,
        outputTokens: 10,
        requests: 1,
        estimatedCost: 0.01,
        source: "local_scan" as const,
      }));

      const first = await ingestLocalUsageBatch({ orgId, userId, deviceId, rows });
      const second = await ingestLocalUsageBatch({
        orgId,
        userId,
        deviceId,
        rows: rows.map((row) => ({ ...row, inputTokens: row.inputTokens + 5 })),
      });

      expect(first.upserted).toBe(50);
      expect(second.upserted).toBe(50);
      expect(await prisma.usageDaily.count({ where: { orgId } })).toBe(50);

      const updated = await prisma.usageDaily.findFirst({
        where: { orgId, model: "model-0" },
        select: { inputTokens: true, source: true },
      });
      expect(updated?.source).toBe("device_observed");
      expect(updated?.inputTokens).toBe(BigInt(105));
    } finally {
      await prisma.usageDaily.deleteMany({ where: { orgId } });
      await prisma.device.deleteMany({ where: { orgId } });
      await prisma.developer.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
  });

  it("accepts duplicate keys in one request without throwing", { skip: !process.env.DATABASE_URL, timeout: 30_000 }, async () => {
    const { prisma } = await import("@usejunction/db");
    const { ingestLocalUsageBatch } = await import("@/lib/ingest/local-usage-batch");
    const suffix = Date.now();
    const orgId = `bulk_dup_${suffix}`;
    const userId = `bulk_dup_dev_${suffix}`;
    const deviceId = `bulk_dup_device_${suffix}`;

    await prisma.organization.create({ data: { id: orgId, name: "Bulk Dup", slug: orgId } });
    await prisma.developer.create({
      data: { id: userId, orgId, name: "Bulk Dup", email: `bulk_dup_${suffix}@example.com`, role: "user" },
    });
    await prisma.device.create({
      data: {
        id: deviceId,
        orgId,
        userId,
        hostname: "test",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "0.0.0",
        deviceToken: `tok_dup_${suffix}`,
      },
    });

    try {
      const result = await ingestLocalUsageBatch({
        orgId,
        userId,
        deviceId,
        rows: [
          { date: "2026-07-21", toolName: "codex", model: "gpt", inputTokens: 10, requests: 1, source: "local_scan" },
          { date: "2026-07-21", toolName: "codex", model: "gpt", inputTokens: 55, requests: 3, source: "local_scan" },
          { date: "2026-07-21", toolName: "codex", model: "gpt", inputTokens: 55, requests: 3, source: "local_scan" },
        ],
      });
      expect(result.upserted).toBe(1);
      expect(await prisma.usageDaily.count({ where: { orgId } })).toBe(1);
      const row = await prisma.usageDaily.findFirst({ where: { orgId }, select: { inputTokens: true, requests: true } });
      expect(row?.inputTokens).toBe(BigInt(55));
      expect(row?.requests).toBe(3);
    } finally {
      await prisma.usageDaily.deleteMany({ where: { orgId } });
      await prisma.device.deleteMany({ where: { orgId } });
      await prisma.developer.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
  });

  it("allows same device/date/tool/model under different sources", { skip: !process.env.DATABASE_URL, timeout: 30_000 }, async () => {
    const { prisma } = await import("@usejunction/db");
    const { ingestLocalUsageBatch } = await import("@/lib/ingest/local-usage-batch");
    const suffix = Date.now();
    const orgId = `bulk_src_${suffix}`;
    const userId = `bulk_src_dev_${suffix}`;
    const deviceId = `bulk_src_device_${suffix}`;

    await prisma.organization.create({ data: { id: orgId, name: "Bulk Src", slug: orgId } });
    await prisma.developer.create({
      data: { id: userId, orgId, name: "Bulk Src", email: `bulk_src_${suffix}@example.com`, role: "user" },
    });
    await prisma.device.create({
      data: {
        id: deviceId,
        orgId,
        userId,
        hostname: "test",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "0.0.0",
        deviceToken: `tok_src_${suffix}`,
      },
    });

    try {
      await ingestLocalUsageBatch({
        orgId,
        userId,
        deviceId,
        rows: [
          {
            date: "2026-07-21",
            toolName: "cursor",
            model: "composer-2.5",
            inputTokens: 10,
            requests: 1,
            source: "local_scan",
          },
        ],
      });
      const second = await ingestLocalUsageBatch({
        orgId,
        userId,
        deviceId,
        rows: [
          {
            date: "2026-07-21",
            toolName: "cursor",
            model: "composer-2.5",
            inputTokens: 20,
            requests: 2,
            source: "cursor_local",
          },
          {
            date: "2026-07-21",
            toolName: "cursor",
            model: "composer-2.5",
            inputTokens: 30,
            requests: 3,
            source: "local_scan",
          },
        ],
      });
      expect(second.upserted).toBe(2);
      expect(await prisma.usageDaily.count({ where: { orgId } })).toBe(2);
    } finally {
      await prisma.usageDaily.deleteMany({ where: { orgId } });
      await prisma.device.deleteMany({ where: { orgId } });
      await prisma.developer.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
  });

  it("persists opencode usage and productivity rows", { skip: !process.env.DATABASE_URL, timeout: 30_000 }, async () => {
    const { prisma } = await import("@usejunction/db");
    const { ingestLocalUsageBatch } = await import("@/lib/ingest/local-usage-batch");
    const suffix = Date.now();
    const orgId = `bulk_oc_${suffix}`;
    const userId = `bulk_oc_dev_${suffix}`;
    const deviceId = `bulk_oc_device_${suffix}`;

    await prisma.organization.create({ data: { id: orgId, name: "Bulk OC", slug: orgId } });
    await prisma.developer.create({
      data: { id: userId, orgId, name: "Bulk OC", email: `bulk_oc_${suffix}@example.com`, role: "user" },
    });
    await prisma.device.create({
      data: {
        id: deviceId,
        orgId,
        userId,
        hostname: "test",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "0.3.1",
        deviceToken: `tok_oc_${suffix}`,
      },
    });

    try {
      const result = await ingestLocalUsageBatch({
        orgId,
        userId,
        deviceId,
        rows: [
          {
            date: "2026-07-21",
            toolName: "opencode",
            model: "opencode-go/kimi-k2.7-code",
            source: "opencode_usage",
            inputTokens: 121_126,
            outputTokens: 8_927,
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
      expect(result.upserted).toBe(2);

      const usage = await prisma.usageDaily.findFirst({
        where: { orgId, model: "opencode-go/kimi-k2.7-code" },
        select: { costKind: true, costMicros: true, metricKind: true, source: true },
      });
      expect(usage?.costKind).toBe("actual_spend");
      expect(usage?.metricKind).toBe("usage");
      expect(usage?.source).toBe("device_observed");
      expect(usage?.costMicros).toBe(BigInt(376_150));

      const productivity = await prisma.usageDaily.findFirst({
        where: { orgId, model: "opencode", metricKind: "productivity" },
        select: { addedLines: true, deletedLines: true, requests: true },
      });
      expect(Number(productivity?.addedLines)).toBe(120);
      expect(Number(productivity?.deletedLines)).toBe(30);
      expect(productivity?.requests).toBe(0);
    } finally {
      await prisma.usageDaily.deleteMany({ where: { orgId } });
      await prisma.device.deleteMany({ where: { orgId } });
      await prisma.developer.deleteMany({ where: { orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
  });
});
