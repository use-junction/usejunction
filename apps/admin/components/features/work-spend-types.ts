import type { GitHubConnectionView, GitHubConnectionsSummary } from "@/lib/integrations/github-connections";

export type WorkSpendRepository = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  pullRequestCount: number;
  commitCount: number;
  contributorCount: number;
  latestActivityAt: string | null;
  verifiedMicros: string;
  estimatedMicros: string;
  changeMix: Array<{ type: string; count: number }>;
  projectIds: string[];
};

export type WorkLifecycle = "shipped" | "in_flight" | "stalled";

export type WorkStateItem = {
  id: string;
  workId: string;
  kind: "ticket" | "pull_request" | "commit";
  title: string;
  originalTitle: string | null;
  state: string | null;
  workState: WorkLifecycle;
  url: string | null;
  sha?: string;
  activityAt: string;
  commitCount: number;
  verifiedMicros: string;
  estimatedMicros: string;
  repository: { id: string; owner: string; name: string; fullName: string };
};

export type WorkStateBucket = {
  micros: string;
  count: number;
  top: WorkStateItem[];
};

export type WorkSpendPayload = {
  days: number;
  window: { from: string; to: string };
  canMapIdentities: boolean;
  canViewPeople: boolean;
  workCount: number;
  states: { shipped: WorkStateBucket; inFlight: WorkStateBucket; stalled: WorkStateBucket };
  connection: GitHubConnectionsSummary;
  connections: GitHubConnectionView[];
  coverage: {
    eligibleMicros: string;
    attributedMicros: string;
    unattributedMicros: string;
    verifiedMicros: string;
    estimatedMicros: string;
    attributedPct: number;
  };
  allocationCurrent: boolean;
  selectedRepositoryId: string | null;
  repositoryOptions: Array<{ id: string; fullName: string }>;
  hasTicketKeys: boolean;
  repositories: WorkSpendRepository[];
  changeMix: Array<{ type: string; count: number }>;
  attention: {
    unmappedAuthors: Array<{ identityId: string | null; login: string; commitCount: number; suggestedDeveloperId: string | null }>;
    developers: Array<{ id: string; name: string }>;
  };
  projects: {
    state: string;
    selected: Array<{ id: string; title: string; url: string; syncStatus: string; lastSyncedAt: string | null; lastError: string | null }>;
    canManage: boolean;
  };
  limits: string[];
};

export type WorkItem = {
  kind: "ticket" | "pull_request" | "commit";
  id: string;
  title: string;
  originalTitle?: string | null;
  state: string | null;
  workState?: WorkLifecycle;
  url: string | null;
  ticketKey: string | null;
  ticketSource: string | null;
  authorLogin: string | null;
  activityAt: string;
  commitCount: number;
  verifiedMicros: string;
  estimatedMicros: string;
  issue: { title: string; status: string; url: string | null } | null;
  projectLinks: Array<{
    projectId: string; projectTitle: string; projectUrl: string; title: string; status: string | null; url: string;
    matchedBy: string; position?: number | null; total?: number | null; reference?: string | null;
  }>;
  pullRequests?: Array<{ id: string; title: string; state: string | null; url: string | null }>;
  sha?: string;
  reason?: { matchedBy: string; position?: number; total?: number; reference?: string };
};

export type WorkPage = {
  items: WorkItem[];
  nextCursor: string | null;
  allocationContext?: Array<{ ticketKey: string; verifiedMicros: string; estimatedMicros: string }>;
};

export type WorkFeedItem = WorkItem & {
  workId: string;
  repository: { id: string; owner: string; name: string; fullName: string };
};

export type WorkFeedPage = { items: WorkFeedItem[]; totalCount: number; nextCursor: string | null };

export type WorkDetailsPage = {
  commits: Array<{ id: string; sha: string; title: string; url: string | null; authorLogin: string | null; activityAt: string }>;
  nextCursor: string | null;
  evidence: Array<{ date: string; developerName: string; costKind: "verified_usage" | "estimated_api"; costMicros: string; weight: number; method: string; ticketSource: string | null }>;
  evidenceNextCursor: string | null;
};

export type WorkSpendDistributionProject = {
  id: string;
  title: string;
  url: string;
  workCount: number;
  verifiedMicros: string;
  estimatedMicros: string;
  shippedMicros: string;
  inFlightMicros: string;
  stalledMicros: string;
};

export type WorkSpendDistribution = {
  projects: WorkSpendDistributionProject[];
  withoutProjectMicros: string;
  withoutShippedMicros: string;
  withoutInFlightMicros: string;
  withoutStalledMicros: string;
  overlappingMicros: string;
};

export type WorkSpendPerson = {
  id: string;
  name: string;
  verifiedMicros: string;
  estimatedMicros: string;
  workCount: number;
};

export type WorkSpendPeople = {
  people: WorkSpendPerson[];
};

export type AttributionMode = "wi_order" | "named_only";
export type AttributionMethod = "named" | "wi_order" | "mixed";

export type WorkSpendProjectTask = {
  id: string;
  title: string;
  status: string | null;
  url: string;
  number: number;
  repository: { id: string; owner: string; name: string; fullName: string };
  verifiedMicros: string;
  estimatedMicros: string;
  method: AttributionMethod;
  matches: WorkFeedItem[];
};

export type WorkSpendProjectInspection = {
  id: string;
  title: string;
  url: string;
  days: number;
  workCount: number;
  verifiedMicros: string;
  estimatedMicros: string;
  shippedMicros: string;
  inFlightMicros: string;
  stalledMicros: string;
  attributionMode: AttributionMode;
  canManage: boolean;
  wiTaskCount: number;
  methodMicros: { named: string; wiOrder: string; untasked: string };
  outcomeMicros: { mergedPr: string; openPr: string; idlePr: string; closedPr: string; directCommit: string };
  tasks: WorkSpendProjectTask[];
  pullRequests: WorkFeedItem[];
  pullRequestCount: number;
  commits: WorkFeedItem[];
  commitCount: number;
};

export type WorkSpendTrendSeries = {
  id: string;
  title: string;
  inferred?: boolean;
  points: number[];
  totalMicros: string;
};

export type WorkSpendTrend = {
  by: "repository" | "project" | "person";
  weeks: string[];
  series: WorkSpendTrendSeries[];
  overlappingMicros?: string;
};
