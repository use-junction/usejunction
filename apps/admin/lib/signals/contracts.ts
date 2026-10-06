import { z } from "zod";

export const SIGNALS_COLLECTION_MODE = "app_domain" as const;
export const SIGNALS_DEFAULT_RETENTION_DAYS = 90;
export const SIGNALS_MAX_BATCH = 500;
export const WORK_SESSIONS_MAX_BATCH = 200;

export const defaultExcludedApps = [
  "1Password",
  "Bitwarden",
  "Dashlane",
  "Keeper",
  "Keychain Access",
  "LastPass",
  "System Settings",
];

export const defaultExcludedDomains = [
  "1password.com",
  "bitwarden.com",
  "dashlane.com",
  "lastpass.com",
  "myaccount.google.com",
  "paypal.com",
];

/** Forbidden on Signals app/domain sessions (includes window title). */
export const forbiddenSignalsFields = [
  "clipboardText",
  "content",
  "keystrokes",
  "prompt",
  "screenshot",
  "title",
  "url",
] as const;

/**
 * Forbidden on work-extraction payloads. Conversation title/tldr/overview and
 * allowlisted prose under userTurns[].text / changeNarrative.text are allowed;
 * raw prompts, full chat bodies, and file contents are not.
 */
export const forbiddenWorkExtractionFields = [
  "arguments",
  "clipboardText",
  "content",
  "fileContent",
  "keystrokes",
  "message",
  "output",
  "prompt",
  "screenshot",
  "url",
] as const;

export const signalsPolicyInputSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(366).optional(),
  collectionMode: z.literal(SIGNALS_COLLECTION_MODE).optional(),
  excludedApps: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  excludedDomains: z.array(z.string().trim().min(1).max(253)).max(500).optional(),
  storeEvents: z.boolean().optional(),
  workExtractionEnabled: z.boolean().optional(),
  rawWorkTextEnabled: z.boolean().optional(),
}).strict();

export const signalsStepSchema = z.object({
  app: z.string().trim().min(1).max(128).nullable().optional(),
  domain: z.string().trim().min(1).max(253).nullable().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
}).strict();

export const signalsSessionSchema = z.object({
  localId: z.string().trim().min(1).max(128),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().min(1).max(24 * 60 * 60),
  aiTool: z.string().trim().min(1).max(128),
  appBefore: z.string().trim().min(1).max(128).nullable().optional(),
  domainBefore: z.string().trim().min(1).max(253).nullable().optional(),
  appAfter: z.string().trim().min(1).max(128).nullable().optional(),
  domainAfter: z.string().trim().min(1).max(253).nullable().optional(),
  flowSignature: z.string().trim().min(1).max(255),
  confidence: z.number().min(0).max(1),
  collectionMode: z.literal(SIGNALS_COLLECTION_MODE),
  steps: z.array(signalsStepSchema).min(1).max(20),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const signalsIngestSchema = z.object({
  sessions: z.array(signalsSessionSchema).min(1).max(SIGNALS_MAX_BATCH),
}).strict();

export const workRepositorySchema = z.object({
  host: z.string().trim().min(1).max(253).optional(),
  owner: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(128).optional(),
}).strict();

export const workTraceLocationSchema = z.object({
  kind: z.string().trim().min(1).max(32).optional(),
  project: z.string().trim().min(1).max(128).optional(),
  repository: workRepositorySchema.optional(),
}).strict();

export const workTraceStepSchema = z.object({
  kind: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(128).optional(),
}).strict();

export const workTraceStatsSchema = z.object({
  linesAdded: z.number().int().min(0).max(10_000_000).optional(),
  linesRemoved: z.number().int().min(0).max(10_000_000).optional(),
  filesChanged: z.number().int().min(0).max(1_000_000).optional(),
}).strict();

export const workTraceChurnSchema = z.object({
  filesRewritten: z.number().int().min(0).max(1_000_000).optional(),
  rewriteEvents: z.number().int().min(0).max(10_000_000).optional(),
}).strict();

export const workTraceVerifySchema = z.object({
  afterEdit: z.boolean().optional(),
  kinds: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
}).strict();

export const workTraceGitCommitSchema = z.object({
  sha: z.string().trim().min(7).max(12),
  subject: z.string().trim().min(1).max(120),
  filesChanged: z.number().int().min(0).max(1_000_000).optional(),
  linesAdded: z.number().int().min(0).max(10_000_000).optional(),
  linesRemoved: z.number().int().min(0).max(10_000_000).optional(),
}).strict();

export const workTraceGitSchema = z.object({
  branch: z.string().trim().min(1).max(200).optional(),
  committed: z.boolean().optional(),
  prNumber: z.number().int().min(1).max(10_000_000).optional(),
  commits: z.array(workTraceGitCommitSchema).max(20).optional(),
}).strict();

export const workTraceUnderstandingSchema = z.object({
  version: z.literal(1),
  intent: z.string().trim().min(1).max(160).optional(),
  intentSource: z.enum(["summary", "title", "plan", "user_turn_derived"]).optional(),
  context: z.object({
    kinds: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
    primaryFiles: z.array(z.string().trim().min(1).max(180)).max(8).optional(),
    skills: z.array(z.string().trim().min(1).max(128)).max(8).optional(),
  }).strict().optional(),
  actors: z.object({
    tool: z.string().trim().min(1).max(64),
    model: z.string().trim().min(1).max(128).optional(),
    mode: z.string().trim().min(1).max(64).optional(),
  }).strict().optional(),
  sequence: z.object({
    fingerprint: z.string().trim().min(1).max(120).optional(),
    userTurns: z.number().int().min(0).max(100_000).optional(),
    assistantTurns: z.number().int().min(0).max(100_000).optional(),
    toolCalls: z.number().int().min(0).max(1_000_000).optional(),
  }).strict().optional(),
  attempts: z.object({
    score: z.number().int().min(1).max(1000),
    signals: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
  }).strict().optional(),
  authorship: z.object({
    aiEditEvents: z.number().int().min(0).max(10_000_000).optional(),
    humanEditEvents: z.number().int().min(0).max(10_000_000).optional(),
    tabEditEvents: z.number().int().min(0).max(10_000_000).optional(),
    aiShare: z.number().min(0).max(1).optional(),
    requestCount: z.number().int().min(0).max(1_000_000).optional(),
  }).strict().optional(),
  acceptance: z.object({
    status: z.enum(["unknown", "likely_kept", "mixed", "abandoned"]),
    signals: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
  }).strict().optional(),
  outcome: z.object({
    status: z.enum(["unknown", "in_progress", "verified", "committed", "abandoned"]),
    evidence: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
  }).strict().optional(),
  confidence: z.object({
    intent: z.number().min(0).max(1).optional(),
    authorship: z.number().min(0).max(1).optional(),
    acceptance: z.number().min(0).max(1).optional(),
    outcome: z.number().min(0).max(1).optional(),
  }).strict().optional(),
}).strict();

export const workTraceFileChangeSchema = z.object({
  file: z.string().trim().min(1).max(180),
  op: z.enum(["read", "write", "create", "delete", "edit", "unknown"]),
  source: z.enum(["composer", "human", "tab", "tool", "unknown"]).optional(),
  events: z.number().int().min(1).max(10_000_000).optional(),
}).strict();

export const workTraceUserTurnSchema = z.object({
  at: z.string().datetime().optional(),
  text: z.string().trim().min(1).max(2000),
  files: z.array(workTraceFileChangeSchema).max(20).optional(),
}).strict();

export const workTraceChangeNarrativeSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  at: z.string().datetime().optional(),
  source: z.enum(["assistant_final", "conversation_summary", "composer_subtitle"]),
  bullets: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
}).strict();

/** Structured activity — user turn / changeNarrative text allowlisted; no full chat or file contents. */
export const workTraceSchema = z.object({
  approach: z.string().trim().min(1).max(240).optional(),
  location: workTraceLocationSchema.optional(),
  skills: z.array(z.string().trim().min(1).max(128)).max(40).optional(),
  tools: z.array(z.string().trim().min(1).max(64)).max(80).optional(),
  files: z.array(z.string().trim().min(1).max(180)).max(40).optional(),
  steps: z.array(workTraceStepSchema).max(40).optional(),
  stats: workTraceStatsSchema.optional(),
  durationSeconds: z.number().int().min(0).max(7 * 24 * 60 * 60).optional(),
  phases: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
  phaseFingerprint: z.string().trim().min(1).max(120).optional(),
  churn: workTraceChurnSchema.optional(),
  verify: workTraceVerifySchema.optional(),
  languages: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  testInvolved: z.boolean().optional(),
  skillCounts: z.record(z.string(), z.number().int().min(0).max(1_000_000)).optional(),
  git: workTraceGitSchema.optional(),
  understanding: workTraceUnderstandingSchema.optional(),
  userTurns: z.array(workTraceUserTurnSchema).max(40).optional(),
  fileChangelog: z.array(workTraceFileChangeSchema).max(80).optional(),
  changeNarrative: workTraceChangeNarrativeSchema.optional(),
}).strict();

export const workSessionSchema = z.object({
  localId: z.string().trim().min(1).max(160),
  toolName: z.string().trim().min(1).max(64),
  accountKey: z.string().trim().min(1).max(256).optional(),
  model: z.string().trim().min(1).max(128).nullable().optional(),
  mode: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(240).nullable().optional(),
  tldr: z.string().trim().min(1).max(500).nullable().optional(),
  overview: z.string().trim().min(1).max(2000).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  observedAt: z.string().datetime(),
  toolCallCounts: z.record(z.string(), z.number().int().min(0).max(1_000_000)).optional(),
  trace: workTraceSchema.nullable().optional(),
  repository: workRepositorySchema.nullable().optional(),
  source: z.string().trim().min(1).max(64),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const workSessionsIngestSchema = z.object({
  sessions: z.array(workSessionSchema).min(1).max(WORK_SESSIONS_MAX_BATCH),
}).strict();

export type SignalsPolicyInput = z.infer<typeof signalsPolicyInputSchema>;
export type SignalsSessionInput = z.infer<typeof signalsSessionSchema>;
export type WorkSessionInput = z.infer<typeof workSessionSchema>;

export function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const clean = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!clean || clean.length > 253) return null;
  if (clean.includes("/") || clean.includes("?") || clean.includes("#")) return null;
  return clean;
}

export function normalizeList(values: string[] | undefined, defaults: string[] = []): string[] {
  return Array.from(new Set([...(values ?? []), ...defaults].map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function containsForbiddenField(value: unknown, forbidden: readonly string[]): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsForbiddenField(item, forbidden);
      if (found) return found;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (forbidden.includes(key)) return key;
    const found = containsForbiddenField(nested, forbidden);
    if (found) return found;
  }
  return null;
}

export function containsForbiddenSignalsField(value: unknown): string | null {
  return containsForbiddenField(value, forbiddenSignalsFields);
}

export function containsForbiddenWorkExtractionField(value: unknown): string | null {
  return containsForbiddenField(value, forbiddenWorkExtractionFields);
}
