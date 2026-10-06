import { firstTicketKey, parseTicketKeys } from "@/lib/features/ticket-keys";
import { CALCULATION_VERSION } from "@/lib/metrics/source-priority";

export const FEATURE_COST_VERSION = `${CALCULATION_VERSION}:feature-v4`;
export const FEATURE_COST_WINDOW_DAYS = 90;
const ZERO = BigInt(0);
const ONE = BigInt(1);

export function featureCostWindow(now = new Date(), days = FEATURE_COST_WINDOW_DAYS) {
  const span = Math.min(FEATURE_COST_WINDOW_DAYS, Math.max(7, Math.round(days)));
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - (span - 1) * 86_400_000);
  return { from, to, days: span };
}

export type FeatureCostKind = "verified_usage" | "estimated_api";
export type FeatureAllocationMethod = "commit_split" | "unattributed";
export type TicketKeySource = "commit" | "pr_title" | "pr_branch" | "mixed";

export type CostBucket = {
  developerId: string;
  date: string;
  costKind: FeatureCostKind;
  repositoryId: string | null;
  costMicros: bigint;
};

export type CommitCandidate = {
  sha: string;
  pullRequestId: string | null;
  authoredAt: Date;
  repositoryId: string;
};

export type AllocationRow = {
  date: string;
  developerId: string;
  repositoryId: string | null;
  pullRequestId: string | null;
  commitSha: string | null;
  ticketKey: string | null;
  ticketKeySource: TicketKeySource | null;
  costKind: FeatureCostKind;
  costMicros: bigint;
  weight: number;
  method: FeatureAllocationMethod;
  calculationVersion: string;
};

function utcDayStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function utcDayEnd(dateKey: string): Date {
  return new Date(utcDayStart(dateKey).getTime() + 86_400_000);
}

export function splitMicros(total: bigint, weights: number[]): bigint[] {
  if (weights.length === 0) return [];
  if (total <= ZERO) return weights.map(() => ZERO);
  const ints = weights.map((weight) => Math.max(0, Math.round(weight)));
  const sum = ints.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    const each = total / BigInt(weights.length);
    const remainder = total - each * BigInt(weights.length);
    return weights.map((_, index) => each + (index === 0 ? remainder : ZERO));
  }
  const parts = ints.map((weight) => (total * BigInt(weight)) / BigInt(sum));
  let leftover = total - parts.reduce((acc, value) => acc + value, ZERO);
  const remainders = ints
    .map((weight, index) => ({ index, remainder: Number((total * BigInt(weight)) % BigInt(sum)) }))
    .sort((left, right) => right.remainder - left.remainder);
  const out = [...parts];
  let cursor = 0;
  while (leftover > ZERO && remainders.length > 0) {
    out[remainders[cursor % remainders.length]!.index]! += ONE;
    leftover -= ONE;
    cursor += 1;
  }
  return out;
}

function inDay(date: Date, dateKey: string) {
  const start = utcDayStart(dateKey).getTime();
  const end = utcDayEnd(dateKey).getTime();
  const time = date.getTime();
  return time >= start && time < end;
}

type Unit = {
  pullRequestId: string | null;
  commitSha: string | null;
  repositoryId: string | null;
  weight: number;
};

function unitsFromCommits(commits: CommitCandidate[]): Unit[] {
  const grouped = new Map<string, Unit>();
  for (const commit of commits) {
    const key = commit.pullRequestId
      ? `repo:${commit.repositoryId}:pr:${commit.pullRequestId}`
      : `repo:${commit.repositoryId}:sha:${commit.sha}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.weight += 1;
      continue;
    }
    grouped.set(key, {
      pullRequestId: commit.pullRequestId,
      commitSha: commit.pullRequestId ? null : commit.sha,
      repositoryId: commit.repositoryId,
      weight: 1,
    });
  }
  return [...grouped.values()];
}

export function allocateDeveloperDay(input: {
  bucket: CostBucket;
  commits: CommitCandidate[];
}): AllocationRow[] {
  const { bucket } = input;
  const base = {
    date: bucket.date,
    developerId: bucket.developerId,
    costKind: bucket.costKind,
    calculationVersion: FEATURE_COST_VERSION,
  };

  const dayCommits = input.commits.filter((commit) => inDay(commit.authoredAt, bucket.date));
  const repoCommits = bucket.repositoryId
    ? dayCommits.filter((commit) => commit.repositoryId === bucket.repositoryId)
    : dayCommits;

  const commitUnits = unitsFromCommits(repoCommits);
  if (commitUnits.length > 0) {
    const amounts = splitMicros(bucket.costMicros, commitUnits.map((unit) => unit.weight));
    return commitUnits.map((unit, index) => ({
      ...base,
      repositoryId: unit.repositoryId ?? bucket.repositoryId,
      pullRequestId: unit.pullRequestId,
      commitSha: unit.commitSha,
      ticketKey: null,
      ticketKeySource: null,
      costMicros: amounts[index] ?? ZERO,
      weight: unit.weight,
      method: "commit_split" as const,
    }));
  }

  return [{
    ...base,
    repositoryId: bucket.repositoryId,
    pullRequestId: null,
    commitSha: null,
    ticketKey: null,
    ticketKeySource: null,
    costMicros: bucket.costMicros,
    weight: 1,
    method: "unattributed",
  }];
}

export function ticketKeyFromJson(value: unknown): string | null {
  return firstTicketKey(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

export function resolveTicketKey(input: {
  commitTicketKeys: unknown;
  pullRequestTitle?: string | null;
  pullRequestBranch?: string | null;
}): { ticketKey: string | null; source: TicketKeySource | null } {
  const commitKey = ticketKeyFromJson(input.commitTicketKeys);
  if (commitKey) return { ticketKey: commitKey, source: "commit" };
  const titleKey = firstTicketKey(parseTicketKeys({ title: input.pullRequestTitle }));
  if (titleKey) return { ticketKey: titleKey, source: "pr_title" };
  const branchKey = firstTicketKey(parseTicketKeys({ branch: input.pullRequestBranch }));
  if (branchKey) return { ticketKey: branchKey, source: "pr_branch" };
  return { ticketKey: null, source: null };
}
