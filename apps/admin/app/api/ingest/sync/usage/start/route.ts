import { NextRequest, NextResponse, after } from "next/server";
import { resolveUsageIngestContext } from "@/lib/ingest/device-context";
import { limitedJson } from "@/lib/security/http";
import { logServerError } from "@/lib/errors/public";
import { runDeferredUsageStartWork, startUsageSync, type ManifestPartition } from "@/lib/sync/usage-sync";

export const maxDuration = 300;

function parseSidecar(raw: unknown): { contentHash?: string; items?: Array<Record<string, unknown>> } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const t = raw as Record<string, unknown>;
  return {
    contentHash: typeof t.contentHash === "string" ? t.contentHash : undefined,
    items: Array.isArray(t.items) ? (t.items as Array<Record<string, unknown>>) : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const parsedBody = await limitedJson(req, 2 * 1024 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data as Record<string, unknown>;

    const context = await resolveUsageIngestContext(req, body);
    if (context instanceof NextResponse) return context;
    const { orgId, userId, deviceId } = context;

    const partitions = Array.isArray(body.partitions) ? (body.partitions as ManifestPartition[]) : [];
    const tools = parseSidecar(body.tools);
    const accounts = parseSidecar(body.accounts);
    const quotas = parseSidecar(body.quotas);

    const result = await startUsageSync({
      orgId,
      userId,
      deviceId,
      partitions,
      tools: tools
        ? {
            contentHash: tools.contentHash,
            items: (tools.items ?? []).map((item) => ({
              toolName: String(item.toolName ?? ""),
              detected: item.detected !== false,
              configured: Boolean(item.configured),
              configPath: typeof item.configPath === "string" ? item.configPath : null,
              version: typeof item.version === "string" ? item.version : null,
            })),
          }
        : undefined,
      accounts: accounts
        ? {
            contentHash: accounts.contentHash,
            items: (accounts.items ?? []).map((item) => ({
              toolName: String(item.toolName ?? ""),
              accountKey: typeof item.accountKey === "string" ? item.accountKey : null,
              email: typeof item.email === "string" ? item.email : null,
              plan: typeof item.plan === "string" ? item.plan : null,
              orgKey: typeof item.orgKey === "string" ? item.orgKey : null,
              loginMethod: typeof item.loginMethod === "string" ? item.loginMethod : "unknown",
              authPresent: Boolean(item.authPresent),
            })),
          }
        : undefined,
      quotas: quotas
        ? {
            contentHash: quotas.contentHash,
            items: (quotas.items ?? []).map((item) => ({
              toolName: String(item.toolName ?? ""),
              accountKey: typeof item.accountKey === "string" ? item.accountKey : "",
              windowType: String(item.windowType ?? ""),
              usedPercent: typeof item.usedPercent === "number" ? item.usedPercent : null,
              resetAt: typeof item.resetAt === "string" ? item.resetAt : null,
              creditsRemaining: typeof item.creditsRemaining === "number" ? item.creditsRemaining : null,
              source: typeof item.source === "string" ? item.source : null,
            })),
          }
        : undefined,
    }, { deferHeavyWork: true });

    const { deferredWork, timings, ...payload } = result;
    if (deferredWork) {
      after(async () => {
        try {
          await runDeferredUsageStartWork(deferredWork);
        } catch (error) {
          logServerError("sync/usage/start-deferred", error, { orgId, deviceId });
        }
      });
    }

    console.info("[sync/usage/start-timing]", {
      orgId,
      deviceId,
      inventoryMs: timings.inventoryMs,
      fingerprintMs: timings.fingerprintMs,
      deferred: Boolean(deferredWork),
      deferredPlanSync: Boolean(deferredWork?.planSync),
      deferredEmptySettle: Boolean(deferredWork?.emptyDeltaSettle),
      deltaPartitions: payload.deltaPartitions.length,
      status: payload.status,
    });

    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    logServerError("sync/usage/start", error);
    return NextResponse.json({ error: "sync start failed" }, { status: 500 });
  }
}
