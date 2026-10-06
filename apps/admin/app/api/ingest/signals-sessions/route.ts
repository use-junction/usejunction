import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@usejunction/db";
import {
  recordDeviceActivityEvent,
  uniqueStrings,
} from "@/lib/activity/record-device-activity-event";
import { requireActiveDeviceForIngest } from "@/lib/ingest/device-context";
import { limitedJson } from "@/lib/security/http";
import {
  containsForbiddenSignalsField,
  normalizeDomain,
  signalsIngestSchema,
  type SignalsSessionInput,
} from "@/lib/signals/contracts";
import { enforceSignalsRetention, getEffectiveSignalsPolicy } from "@/lib/signals/service";
import { signalsAllowed } from "@/lib/region";
import { logServerError } from "@/lib/errors/public";

export const maxDuration = 60;

function asDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanText(value: string | null | undefined, max = 128): string | null {
  const clean = value?.trim();
  return clean ? clean.slice(0, max) : null;
}

function cleanSession(row: SignalsSessionInput) {
  const startedAt = asDate(row.startedAt);
  const endedAt = asDate(row.endedAt);
  if (!startedAt || !endedAt || endedAt <= startedAt) return null;

  const steps = row.steps.map((step) => ({
    app: cleanText(step.app),
    domain: normalizeDomain(step.domain),
    startedAt: step.startedAt,
    endedAt: step.endedAt,
  }));

  return {
    localId: row.localId,
    startedAt,
    endedAt,
    durationSeconds: row.durationSeconds,
    aiTool: cleanText(row.aiTool, 128) ?? "unknown",
    appBefore: cleanText(row.appBefore),
    domainBefore: normalizeDomain(row.domainBefore),
    appAfter: cleanText(row.appAfter),
    domainAfter: normalizeDomain(row.domainAfter),
    flowSignature: cleanText(row.flowSignature, 255) ?? "unknown",
    confidence: row.confidence,
    collectionMode: row.collectionMode,
    steps: steps as Prisma.InputJsonValue,
    metadata: (row.metadata ?? {}) as Prisma.InputJsonValue,
  };
}

function sessionTouchesExcluded(
  session: ReturnType<typeof cleanSession> & {},
  excludedApps: string[],
  excludedDomains: string[],
) {
  if (!session) return true;
  const apps = new Set(excludedApps.map((item) => item.toLowerCase()));
  const domains = new Set(excludedDomains.map((item) => item.toLowerCase()));
  const values = [
    session.appBefore,
    session.appAfter,
    ...((session.steps as Array<{ app?: string | null }>) ?? []).map((step) => step.app ?? null),
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  const domainValues = [
    session.domainBefore,
    session.domainAfter,
    ...((session.steps as Array<{ domain?: string | null }>) ?? []).map((step) => step.domain ?? null),
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  return values.some((app) => apps.has(app)) || domainValues.some((domain) => domains.has(domain));
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const device = await requireActiveDeviceForIngest(req);
    if (device instanceof NextResponse) return device;

    const policy = await getEffectiveSignalsPolicy(device.orgId);
    if (!signalsAllowed() || !policy.enabled) {
      return NextResponse.json(
        { error: signalsAllowed() ? "signals disabled" : "Signals collection is not available." },
        { status: 403 },
      );
    }

    const parsedBody = await limitedJson(req, 128 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data;
    const forbidden = containsForbiddenSignalsField(body);
    if (forbidden) {
      return NextResponse.json({ error: "forbidden signals field", field: forbidden }, { status: 400 });
    }
    const parsed = signalsIngestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid signals payload", details: parsed.error.flatten() }, { status: 400 });
    }

    let upserted = 0;
    let skipped = 0;
    const sample: Array<{
      aiTool: string;
      domainBefore: string | null;
      domainAfter: string | null;
    }> = [];
    for (const input of parsed.data.sessions) {
      const session = cleanSession(input);
      if (!session || sessionTouchesExcluded(session, policy.excludedApps, policy.excludedDomains)) {
        skipped += 1;
        continue;
      }

      await prisma.signalsSession.upsert({
        where: { deviceId_localId: { deviceId: device.id, localId: session.localId } },
        update: {
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationSeconds: session.durationSeconds,
          aiTool: session.aiTool,
          appBefore: session.appBefore,
          domainBefore: session.domainBefore,
          appAfter: session.appAfter,
          domainAfter: session.domainAfter,
          flowSignature: session.flowSignature,
          confidence: session.confidence,
          collectionMode: session.collectionMode,
          steps: session.steps,
          metadata: session.metadata,
        },
        create: {
          orgId: device.orgId,
          developerId: device.userId,
          deviceId: device.id,
          ...session,
        },
      });

      if (sample.length < 8) {
        sample.push({
          aiTool: session.aiTool,
          domainBefore: session.domainBefore,
          domainAfter: session.domainAfter,
        });
      }
      upserted += 1;
    }

    if (upserted > 0) {
      await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      await enforceSignalsRetention(device.orgId, policy.retentionDays);
    }

    const tools = uniqueStrings(sample.map((row) => row.aiTool));
    await recordDeviceActivityEvent({
      orgId: device.orgId,
      developerId: device.userId,
      deviceId: device.id,
      kind: "signals_sessions",
      status: "ok",
      summary: `Signals sessions · ${upserted} upserted${tools.length ? ` · ${tools.join(", ")}` : ""}${
        skipped ? ` · ${skipped} skipped` : ""
      }`,
      requestSummary: {
        sessions: parsed.data.sessions.length,
        tools,
        sample,
      },
      responseSummary: { upserted, skipped },
      durationMs: Date.now() - started,
    });

    return NextResponse.json({ upserted, skipped });
  } catch (e) {
    logServerError("ingest/signals-sessions", e);
    return NextResponse.json({ error: "signals ingest failed" }, { status: 500 });
  }
}
