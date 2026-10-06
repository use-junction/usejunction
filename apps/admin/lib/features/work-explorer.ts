import type { FeaturesPagePayload } from "@/lib/app-pages/features";

export type WorkCommit = FeaturesPagePayload["unlinkedCommits"][number];

const CHANGE_LABELS: Record<string, string> = {
  feat: "Features", fix: "Fixes", refactor: "Refactoring", perf: "Performance",
  docs: "Documentation", test: "Tests", build: "Build & dependencies",
  ci: "CI", chore: "Maintenance", style: "Formatting", revert: "Reverts",
};

/** Only classify an explicit conventional-commit prefix; do not infer product features. */
export function commitChangeType(headline: string) {
  const prefix = /^([a-z]+)(?:\([^)]*\))?!?:\s/i.exec(headline)?.[1]?.toLowerCase();
  return (prefix && CHANGE_LABELS[prefix]) || "Other changes";
}

export function repositoryLabel(commit: WorkCommit) {
  return commit.repository ? `${commit.repository.owner}/${commit.repository.name}` : "Unknown repository";
}

export function groupWorkByRepository(commits: WorkCommit[], search = "", changeType = "all") {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, {
    repository: string;
    commits: WorkCommit[];
    verifiedMicros: bigint;
    estimatedMicros: bigint;
    contributors: Set<string>;
    changes: Map<string, number>;
    latestAt: string;
  }>();
  for (const commit of commits) {
    const repository = repositoryLabel(commit);
    const type = commitChangeType(commit.headline);
    if (changeType !== "all" && type !== changeType) continue;
    if (query && ![repository, commit.headline, commit.sha, commit.authorLogin ?? "", ...commit.developers]
      .join(" ").toLowerCase().includes(query)) continue;
    const group = groups.get(repository) ?? {
      repository, commits: [], verifiedMicros: BigInt(0), estimatedMicros: BigInt(0),
      contributors: new Set<string>(), changes: new Map<string, number>(), latestAt: "",
    };
    group.commits.push(commit);
    group.verifiedMicros += BigInt(commit.verifiedMicros);
    group.estimatedMicros += BigInt(commit.estimatedMicros);
    if (commit.authorLogin) group.contributors.add(commit.authorLogin);
    else for (const developer of commit.developers) group.contributors.add(developer);
    group.changes.set(type, (group.changes.get(type) ?? 0) + 1);
    if (commit.authoredAt > group.latestAt) group.latestAt = commit.authoredAt;
    groups.set(repository, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    commits: group.commits.sort((left, right) => right.authoredAt.localeCompare(left.authoredAt)),
  }));
}

export function compareCost(left: { verifiedMicros: string | bigint; estimatedMicros: string | bigint }, right: { verifiedMicros: string | bigint; estimatedMicros: string | bigint }) {
  const a = BigInt(left.verifiedMicros) + BigInt(left.estimatedMicros);
  const b = BigInt(right.verifiedMicros) + BigInt(right.estimatedMicros);
  return a === b ? 0 : a > b ? -1 : 1;
}
