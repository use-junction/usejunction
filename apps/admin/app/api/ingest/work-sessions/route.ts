import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@usejunction/db";
import {
  recordDeviceActivityEvent,
  uniqueStrings,
} from "@/lib/activity/record-device-activity-event";
import { isAgentCompatibleForWorkExtraction } from "@/lib/agent-updates/contracts";
import { requireActiveDeviceForIngest } from "@/lib/ingest/device-context";
import { limitedJson } from "@/lib/security/http";
import {
  containsForbiddenWorkExtractionField,
  workSessionsIngestSchema,
  type WorkSessionInput,
} from "@/lib/signals/contracts";
import {
  deviceWorkExtractionStartedAt,
  isObservedAtEligible,
} from "@/lib/signals/collection-window";
import { enforceSignalsRetention, getEffectiveSignalsPolicy } from "@/lib/signals/service";
import { logServerError } from "@/lib/errors/public";
import { deviceActiveAccountAllowed } from "@/lib/privacy/account-collection";

export const maxDuration = 60;

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const clean = value?.trim();
  return clean ? clean.slice(0, max) : null;
}

function cleanRepository(repo: WorkSessionInput["repository"]): Prisma.InputJsonValue | null {
  if (!repo) return null;
  const host = cleanText(repo.host, 253);
  const owner = cleanText(repo.owner, 128);
  const name = cleanText(repo.name, 128);
  if (!host && !owner && !name) return null;
  return { host, owner, name };
}

function cleanTrace(trace: WorkSessionInput["trace"], allowRawWorkText: boolean): Prisma.InputJsonValue | null {
  if (!trace) return null;
  const out: Record<string, unknown> = {};
  const approach = cleanText(trace.approach, 240);
  if (approach) out.approach = approach;
  if (trace.location) {
    const location: Record<string, unknown> = {};
    const kind = cleanText(trace.location.kind, 32);
    const project = cleanText(trace.location.project, 128);
    if (kind) location.kind = kind;
    if (project) location.project = project;
    const repo = cleanRepository(trace.location.repository ?? null);
    if (repo) location.repository = repo;
    if (Object.keys(location).length) out.location = location;
  }
  if (trace.skills?.length) {
    out.skills = trace.skills.map((s) => s.trim().slice(0, 128)).filter(Boolean).slice(0, 40);
  }
  if (trace.tools?.length) {
    out.tools = trace.tools.map((s) => s.trim().slice(0, 64)).filter(Boolean).slice(0, 80);
  }
  if (trace.files?.length) {
    out.files = trace.files.map((s) => s.trim().slice(0, 180)).filter(Boolean).slice(0, 40);
  }
  if (trace.steps?.length) {
    out.steps = trace.steps
      .map((step) => ({
        kind: step.kind.trim().slice(0, 32),
        ...(step.name ? { name: step.name.trim().slice(0, 128) } : {}),
      }))
      .filter((step) => step.kind)
      .slice(0, 40);
  }
  if (trace.stats) {
    const stats: Record<string, number> = {};
    if (typeof trace.stats.linesAdded === "number") stats.linesAdded = Math.min(Math.max(0, trace.stats.linesAdded), 10_000_000);
    if (typeof trace.stats.linesRemoved === "number") stats.linesRemoved = Math.min(Math.max(0, trace.stats.linesRemoved), 10_000_000);
    if (typeof trace.stats.filesChanged === "number") stats.filesChanged = Math.min(Math.max(0, trace.stats.filesChanged), 1_000_000);
    if (Object.keys(stats).length) out.stats = stats;
  }
  if (typeof trace.durationSeconds === "number") {
    out.durationSeconds = Math.min(Math.max(0, Math.floor(trace.durationSeconds)), 7 * 24 * 60 * 60);
  }
  if (trace.phases?.length) {
    out.phases = trace.phases.map((s) => s.trim().slice(0, 32)).filter(Boolean).slice(0, 8);
  }
  const fingerprint = cleanText(trace.phaseFingerprint, 120);
  if (fingerprint) out.phaseFingerprint = fingerprint;
  if (trace.churn) {
    const churn: Record<string, number> = {};
    if (typeof trace.churn.filesRewritten === "number") {
      churn.filesRewritten = Math.min(Math.max(0, Math.floor(trace.churn.filesRewritten)), 1_000_000);
    }
    if (typeof trace.churn.rewriteEvents === "number") {
      churn.rewriteEvents = Math.min(Math.max(0, Math.floor(trace.churn.rewriteEvents)), 10_000_000);
    }
    if (Object.keys(churn).length) out.churn = churn;
  }
  if (trace.verify) {
    const verify: Record<string, unknown> = {};
    if (typeof trace.verify.afterEdit === "boolean") verify.afterEdit = trace.verify.afterEdit;
    if (trace.verify.kinds?.length) {
      verify.kinds = trace.verify.kinds.map((s) => s.trim().slice(0, 32)).filter(Boolean).slice(0, 12);
    }
    if (Object.keys(verify).length) out.verify = verify;
  }
  if (trace.languages?.length) {
    out.languages = trace.languages.map((s) => s.trim().slice(0, 32)).filter(Boolean).slice(0, 12);
  }
  if (typeof trace.testInvolved === "boolean") out.testInvolved = trace.testInvolved;
  if (trace.skillCounts) {
    const skillCounts = Object.fromEntries(
      Object.entries(trace.skillCounts)
        .filter(([key, count]) => key.trim() && Number.isFinite(count) && count > 0)
        .slice(0, 40)
        .map(([key, count]) => [key.trim().slice(0, 128), Math.min(Math.floor(count), 1_000_000)]),
    );
    if (Object.keys(skillCounts).length) out.skillCounts = skillCounts;
  }
  if (trace.git) {
    const git: Record<string, unknown> = {};
    const branch = cleanText(trace.git.branch, 200);
    if (branch) git.branch = branch;
    if (typeof trace.git.committed === "boolean") git.committed = trace.git.committed;
    if (typeof trace.git.prNumber === "number" && trace.git.prNumber >= 1) {
      git.prNumber = Math.min(Math.floor(trace.git.prNumber), 10_000_000);
    }
    if (trace.git.commits?.length) {
      git.commits = trace.git.commits
        .map((c) => {
          const sha = c.sha.trim().slice(0, 12);
          const subject = c.subject.trim().slice(0, 120);
          if (sha.length < 7 || !subject) return null;
          const row: Record<string, unknown> = { sha, subject };
          if (typeof c.filesChanged === "number") row.filesChanged = Math.min(Math.max(0, Math.floor(c.filesChanged)), 1_000_000);
          if (typeof c.linesAdded === "number") row.linesAdded = Math.min(Math.max(0, Math.floor(c.linesAdded)), 10_000_000);
          if (typeof c.linesRemoved === "number") row.linesRemoved = Math.min(Math.max(0, Math.floor(c.linesRemoved)), 10_000_000);
          return row;
        })
        .filter(Boolean)
        .slice(0, 20);
    }
    if (Object.keys(git).length) out.git = git;
  }
  if (trace.understanding) {
    const u = cleanUnderstanding(trace.understanding);
    if (u) out.understanding = u;
  }
  if (allowRawWorkText && trace.userTurns?.length) {
    const allowedOps = new Set(["read", "write", "create", "delete", "edit", "unknown"]);
    const allowedSources = new Set(["composer", "human", "tab", "tool", "unknown"]);
    const cleanChange = (row: { file: string; op: string; source?: string; events?: number }) => {
      const file = cleanText(row.file, 180);
      if (!file || !allowedOps.has(row.op)) return null;
      const change: Record<string, unknown> = { file, op: row.op };
      if (row.source && allowedSources.has(row.source)) change.source = row.source;
      if (typeof row.events === "number" && row.events >= 1) {
        change.events = Math.min(Math.floor(row.events), 10_000_000);
      }
      return change;
    };
    const turns = trace.userTurns
      .map((turn) => {
        const text = cleanText(turn.text, 2000);
        if (!text) return null;
        const row: Record<string, unknown> = { text };
        if (turn.at) {
          const at = asDate(turn.at);
          if (at) row.at = at.toISOString();
        }
        if (turn.files?.length) {
          const files = turn.files.map(cleanChange).filter(Boolean).slice(0, 20);
          if (files.length) row.files = files;
        }
        return row;
      })
      .filter(Boolean)
      .slice(0, 40);
    if (turns.length) out.userTurns = turns;
  }
  if (trace.fileChangelog?.length) {
    const allowedOps = new Set(["read", "write", "create", "delete", "edit", "unknown"]);
    const allowedSources = new Set(["composer", "human", "tab", "tool", "unknown"]);
    const changes = trace.fileChangelog
      .map((row) => {
        const file = cleanText(row.file, 180);
        if (!file || !allowedOps.has(row.op)) return null;
        const change: Record<string, unknown> = { file, op: row.op };
        if (row.source && allowedSources.has(row.source)) change.source = row.source;
        if (typeof row.events === "number" && row.events >= 1) {
          change.events = Math.min(Math.floor(row.events), 10_000_000);
        }
        return change;
      })
      .filter(Boolean)
      .slice(0, 80);
    if (changes.length) out.fileChangelog = changes;
  }
  if (trace.changeNarrative) {
    const narrative = cleanChangeNarrative(trace.changeNarrative);
    if (narrative) out.changeNarrative = narrative;
  }
  return Object.keys(out).length ? (out as Prisma.InputJsonValue) : null;
}

function cleanChangeNarrative(raw: {
  text?: string;
  at?: string;
  source?: string;
  bullets?: string[];
}): Record<string, unknown> | null {
  const text = cleanText(raw.text, 2000);
  if (!text) return null;
  const allowedSources = new Set(["assistant_final", "conversation_summary", "composer_subtitle"]);
  if (!raw.source || !allowedSources.has(raw.source)) return null;
  const out: Record<string, unknown> = { text, source: raw.source };
  if (raw.at) {
    const at = asDate(raw.at);
    if (at) out.at = at.toISOString();
  }
  if (raw.bullets?.length) {
    const bullets = raw.bullets
      .map((b) => cleanText(b, 400))
      .filter(Boolean)
      .slice(0, 12);
    if (bullets.length) out.bullets = bullets;
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function cleanUnderstanding(raw: NonNullable<WorkSessionInput["trace"]> extends infer T
  ? T extends { understanding?: infer U }
    ? U
    : never
  : never): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as {
    version?: number;
    intent?: string;
    intentSource?: string;
    context?: { kinds?: string[]; primaryFiles?: string[]; skills?: string[] };
    actors?: { tool?: string; model?: string; mode?: string };
    sequence?: { fingerprint?: string; userTurns?: number; assistantTurns?: number; toolCalls?: number };
    attempts?: { score?: number; signals?: string[] };
    authorship?: {
      aiEditEvents?: number;
      humanEditEvents?: number;
      tabEditEvents?: number;
      aiShare?: number;
      requestCount?: number;
    };
    acceptance?: { status?: string; signals?: string[] };
    outcome?: { status?: string; evidence?: string[] };
    confidence?: { intent?: number; authorship?: number; acceptance?: number; outcome?: number };
  };
  const out: Record<string, unknown> = { version: 1 };
  const intent = cleanText(u.intent, 160);
  if (intent) out.intent = intent;
  if (
    u.intentSource === "summary" ||
    u.intentSource === "title" ||
    u.intentSource === "plan" ||
    u.intentSource === "user_turn_derived"
  ) {
    out.intentSource = u.intentSource;
  }
  if (u.context) {
    const context: Record<string, unknown> = {};
    if (u.context.kinds?.length) {
      context.kinds = u.context.kinds.map((s) => s.trim().slice(0, 32)).filter(Boolean).slice(0, 8);
    }
    if (u.context.primaryFiles?.length) {
      context.primaryFiles = u.context.primaryFiles.map((s) => s.trim().slice(0, 180)).filter(Boolean).slice(0, 8);
    }
    if (u.context.skills?.length) {
      context.skills = u.context.skills.map((s) => s.trim().slice(0, 128)).filter(Boolean).slice(0, 8);
    }
    if (Object.keys(context).length) out.context = context;
  }
  if (u.actors?.tool) {
    const actors: Record<string, unknown> = { tool: u.actors.tool.trim().slice(0, 64) };
    const model = cleanText(u.actors.model, 128);
    const mode = cleanText(u.actors.mode, 64);
    if (model) actors.model = model;
    if (mode) actors.mode = mode;
    out.actors = actors;
  }
  if (u.sequence) {
    const sequence: Record<string, unknown> = {};
    const fp = cleanText(u.sequence.fingerprint, 120);
    if (fp) sequence.fingerprint = fp;
    if (typeof u.sequence.userTurns === "number") sequence.userTurns = Math.min(Math.max(0, Math.floor(u.sequence.userTurns)), 100_000);
    if (typeof u.sequence.assistantTurns === "number") {
      sequence.assistantTurns = Math.min(Math.max(0, Math.floor(u.sequence.assistantTurns)), 100_000);
    }
    if (typeof u.sequence.toolCalls === "number") sequence.toolCalls = Math.min(Math.max(0, Math.floor(u.sequence.toolCalls)), 1_000_000);
    if (Object.keys(sequence).length) out.sequence = sequence;
  }
  if (u.attempts && typeof u.attempts.score === "number") {
    const attempts: Record<string, unknown> = {
      score: Math.min(Math.max(1, Math.floor(u.attempts.score)), 1000),
    };
    if (u.attempts.signals?.length) {
      attempts.signals = u.attempts.signals.map((s) => s.trim().slice(0, 64)).filter(Boolean).slice(0, 8);
    }
    out.attempts = attempts;
  }
  if (u.authorship) {
    const authorship: Record<string, unknown> = {};
    if (typeof u.authorship.aiEditEvents === "number") {
      authorship.aiEditEvents = Math.min(Math.max(0, Math.floor(u.authorship.aiEditEvents)), 10_000_000);
    }
    if (typeof u.authorship.humanEditEvents === "number") {
      authorship.humanEditEvents = Math.min(Math.max(0, Math.floor(u.authorship.humanEditEvents)), 10_000_000);
    }
    if (typeof u.authorship.tabEditEvents === "number") {
      authorship.tabEditEvents = Math.min(Math.max(0, Math.floor(u.authorship.tabEditEvents)), 10_000_000);
    }
    if (typeof u.authorship.aiShare === "number") authorship.aiShare = clamp01(u.authorship.aiShare);
    if (typeof u.authorship.requestCount === "number") {
      authorship.requestCount = Math.min(Math.max(0, Math.floor(u.authorship.requestCount)), 1_000_000);
    }
    if (Object.keys(authorship).length) out.authorship = authorship;
  }
  if (u.acceptance?.status === "unknown" || u.acceptance?.status === "likely_kept" || u.acceptance?.status === "mixed" || u.acceptance?.status === "abandoned") {
    const acceptance: Record<string, unknown> = { status: u.acceptance.status };
    if (u.acceptance.signals?.length) {
      acceptance.signals = u.acceptance.signals.map((s) => s.trim().slice(0, 64)).filter(Boolean).slice(0, 8);
    }
    out.acceptance = acceptance;
  }
  if (
    u.outcome?.status === "unknown" ||
    u.outcome?.status === "in_progress" ||
    u.outcome?.status === "verified" ||
    u.outcome?.status === "committed" ||
    u.outcome?.status === "abandoned"
  ) {
    const outcome: Record<string, unknown> = { status: u.outcome.status };
    if (u.outcome.evidence?.length) {
      outcome.evidence = u.outcome.evidence.map((s) => s.trim().slice(0, 64)).filter(Boolean).slice(0, 8);
    }
    out.outcome = outcome;
  }
  if (u.confidence) {
    const confidence: Record<string, number> = {};
    if (typeof u.confidence.intent === "number") confidence.intent = clamp01(u.confidence.intent);
    if (typeof u.confidence.authorship === "number") confidence.authorship = clamp01(u.confidence.authorship);
    if (typeof u.confidence.acceptance === "number") confidence.acceptance = clamp01(u.confidence.acceptance);
    if (typeof u.confidence.outcome === "number") confidence.outcome = clamp01(u.confidence.outcome);
    if (Object.keys(confidence).length) out.confidence = confidence;
  }
  return out;
}

function cleanSession(row: WorkSessionInput, allowRawWorkText: boolean) {
  const observedAt = asDate(row.observedAt);
  if (!observedAt) return null;
  const startedAt = asDate(row.startedAt);
  const endedAt = asDate(row.endedAt);
  if (startedAt && endedAt && endedAt < startedAt) return null;

  const toolCallCounts = row.toolCallCounts
    ? Object.fromEntries(
        Object.entries(row.toolCallCounts)
          .filter(([key, count]) => key.trim() && Number.isFinite(count) && count >= 0)
          .slice(0, 64)
          .map(([key, count]) => [key.trim().slice(0, 64), Math.min(Math.floor(count), 1_000_000)]),
      )
    : null;

  return {
    localId: row.localId.slice(0, 160),
    toolName: cleanText(row.toolName, 64) ?? "unknown",
    model: cleanText(row.model, 128),
    mode: cleanText(row.mode, 64),
    title: cleanText(row.title, 240),
    tldr: cleanText(row.tldr, 500),
    overview: cleanText(row.overview, 2000),
    startedAt,
    endedAt,
    observedAt,
    toolCallCounts: (toolCallCounts && Object.keys(toolCallCounts).length > 0
      ? toolCallCounts
      : null) as Prisma.InputJsonValue | null,
    trace: cleanTrace(row.trace, allowRawWorkText),
    repository: cleanRepository(row.repository),
    source: cleanText(row.source, 64) ?? "unknown",
    metadata: (row.metadata ?? {}) as Prisma.InputJsonValue,
  };
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const device = await requireActiveDeviceForIngest(req);
    if (device instanceof NextResponse) return device;

    const policy = await getEffectiveSignalsPolicy(device.orgId);
    if (!policy.workExtractionEnabled) {
      return NextResponse.json({ error: "work extraction disabled" }, { status: 403 });
    }
    if (!isAgentCompatibleForWorkExtraction(device.agentVersion)) {
      return NextResponse.json({ error: "agent update required" }, { status: 409 });
    }
    const collectionStartedAt = deviceWorkExtractionStartedAt(
      policy.workExtractionStartedAt,
      device.createdAt,
    );
    if (!collectionStartedAt) {
      return NextResponse.json({ error: "work extraction collection start unavailable" }, { status: 403 });
    }

    const parsedBody = await limitedJson(req, 1024 * 1024);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data;
    const forbidden = containsForbiddenWorkExtractionField(body);
    if (forbidden) {
      return NextResponse.json({ error: "forbidden work extraction field", field: forbidden }, { status: 400 });
    }
    const parsed = workSessionsIngestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid work sessions payload", details: parsed.error.flatten() }, { status: 400 });
    }

    let upserted = 0;
    let skipped = 0;
    let beforeCollectionStartSkipped = 0;
    const sample: Array<{ toolName: string; model: string | null; title: string | null }> = [];
    for (const input of parsed.data.sessions) {
      const session = cleanSession(input, Boolean(policy.rawWorkTextEnabled));
      if (!session) {
        skipped += 1;
        continue;
      }
      if (!isObservedAtEligible(session.observedAt, collectionStartedAt)) {
        skipped += 1;
        beforeCollectionStartSkipped += 1;
        continue;
      }
      if (!(await deviceActiveAccountAllowed({
        deviceId: device.id,
        toolName: session.toolName,
        stream: "logging",
      }))) {
        skipped += 1;
        continue;
      }

      await prisma.localWorkSession.upsert({
        where: { deviceId_localId: { deviceId: device.id, localId: session.localId } },
        update: {
          toolName: session.toolName,
          model: session.model,
          mode: session.mode,
          title: session.title,
          tldr: session.tldr,
          overview: session.overview,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          observedAt: session.observedAt,
          toolCallCounts: session.toolCallCounts ?? undefined,
          trace: session.trace ?? undefined,
          repository: session.repository ?? undefined,
          source: session.source,
          metadata: session.metadata,
        },
        create: {
          orgId: device.orgId,
          developerId: device.userId,
          deviceId: device.id,
          localId: session.localId,
          toolName: session.toolName,
          model: session.model,
          mode: session.mode,
          title: session.title,
          tldr: session.tldr,
          overview: session.overview,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          observedAt: session.observedAt,
          toolCallCounts: session.toolCallCounts ?? undefined,
          trace: session.trace ?? undefined,
          repository: session.repository ?? undefined,
          source: session.source,
          metadata: session.metadata,
        },
      });
      if (sample.length < 8) {
        sample.push({
          toolName: session.toolName,
          model: session.model,
          title: session.title,
        });
      }
      upserted += 1;
    }

    if (upserted > 0) {
      await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      await enforceSignalsRetention(device.orgId, policy.retentionDays);
    }

    const tools = uniqueStrings(sample.map((row) => row.toolName));
    await recordDeviceActivityEvent({
      orgId: device.orgId,
      developerId: device.userId,
      deviceId: device.id,
      kind: "work_sessions",
      status: "ok",
      summary: `Work sessions · ${upserted} upserted${tools.length ? ` · ${tools.join(", ")}` : ""}${
        skipped ? ` · ${skipped} skipped` : ""
      }${
        beforeCollectionStartSkipped
          ? ` · ${beforeCollectionStartSkipped} before collection start`
          : ""
      }`,
      requestSummary: {
        sessions: parsed.data.sessions.length,
        tools,
        sample,
      },
      responseSummary: { upserted, skipped, beforeCollectionStartSkipped },
      durationMs: Date.now() - started,
    });

    return NextResponse.json({ upserted, skipped, beforeCollectionStartSkipped });
  } catch (e) {
    logServerError("ingest/work-sessions", e);
    return NextResponse.json({ error: "work sessions ingest failed" }, { status: 500 });
  }
}
