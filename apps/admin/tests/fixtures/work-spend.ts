/** Synthetic test-only scenarios. Never import into production UI or seed a database. */
import type {
  WorkDetailsPage,
  WorkFeedItem,
  WorkFeedPage,
  WorkSpendDistribution,
  WorkSpendPayload,
  WorkSpendRepository,
  WorkSpendTrend,
  WorkStateItem,
} from "@/components/features/work-spend-types";

const at = "2026-09-24T10:00:00Z";
const repository = (id: string, name: string, overrides: Partial<WorkSpendRepository> = {}): WorkSpendRepository => ({
  id, owner: "fixture-org", name, fullName: `fixture-org/${name}`,
  syncStatus: "synced", lastSyncedAt: at, lastError: null,
  pullRequestCount: 1, commitCount: 3, contributorCount: 2, latestActivityAt: at,
  verifiedMicros: "3000000", estimatedMicros: "1000000",
  changeMix: [{ type: "Features", count: 2 }, { type: "No recognized prefix", count: 1 }], projectIds: [],
  ...overrides,
});

export const webRepository = repository("repo-web", "web");
export const apiRepository = repository("repo-api", "api", {
  verifiedMicros: "2000000", estimatedMicros: "1000000", commitCount: 2,
  changeMix: [{ type: "Fixes", count: 2 }], latestActivityAt: "2026-09-23T10:00:00Z",
});
export const emptyRepository = repository("repo-docs", "docs", {
  verifiedMicros: "0", estimatedMicros: "0", commitCount: 0, pullRequestCount: 0,
  contributorCount: 0, latestActivityAt: null, changeMix: [],
});

const emptyBucket = { micros: "0", count: 0, top: [] as WorkStateItem[] };
const emptyStates = { shipped: emptyBucket, inFlight: emptyBucket, stalled: emptyBucket };

const githubConnection = {
  id: "github-fixture",
  state: "ready" as const,
  githubOrg: "fixture-org",
  accountType: "Organization" as const,
  installationId: "123",
  needsMembers: false,
  approveUrl: null,
  appPermissionsUrl: null,
  lastSyncedAt: at,
  lastError: null,
};

export const oneRepositoryPayload: WorkSpendPayload = {
  days: 90, window: { from: "2026-06-27", to: "2026-09-24" }, canMapIdentities: true, canViewPeople: true,
  workCount: 1, states: emptyStates,
  connection: { ...githubConnection, connections: [githubConnection] },
  connections: [githubConnection],
  coverage: {
    eligibleMicros: "10000000", attributedMicros: "4000000", unattributedMicros: "6000000",
    verifiedMicros: "7000000", estimatedMicros: "3000000", attributedPct: 40,
  },
  allocationCurrent: true, selectedRepositoryId: null, hasTicketKeys: true,
  repositories: [webRepository], repositoryOptions: [{ id: webRepository.id, fullName: webRepository.fullName }],
  changeMix: webRepository.changeMix,
  attention: { unmappedAuthors: [], developers: [{ id: "dev-a", name: "Ada Fixture" }, { id: "dev-b", name: "Ben Fixture" }] },
  projects: { state: "none", selected: [], canManage: true },
  limits: ["Costs are allocated by UTC day and repository.", "Commit activity does not indicate deployment or productivity."],
};

export const multipleRepositoriesPayload: WorkSpendPayload = {
  ...oneRepositoryPayload,
  workCount: 3,
  coverage: { ...oneRepositoryPayload.coverage, attributedMicros: "7000000", unattributedMicros: "3000000", attributedPct: 70 },
  repositories: [webRepository, apiRepository, emptyRepository],
  repositoryOptions: [webRepository, apiRepository, emptyRepository].map(({ id, fullName }) => ({ id, fullName })),
  changeMix: [{ type: "Features", count: 2 }, { type: "Fixes", count: 2 }, { type: "No recognized prefix", count: 1 }],
};

const item = (repo: WorkSpendRepository, workId: string, overrides: Partial<WorkFeedItem> = {}): WorkFeedItem => ({
  kind: "pull_request", id: `${repo.id}:pull_request:${workId}`, workId,
  repository: { id: repo.id, owner: repo.owner, name: repo.name, fullName: repo.fullName },
  title: "Add team invitations", state: "MERGED", workState: "shipped", originalTitle: null,
  url: "https://github.com/fixture-org/web/pull/12",
  ticketKey: null, ticketSource: null, authorLogin: "fixture-developer", activityAt: at,
  commitCount: 3, verifiedMicros: repo.verifiedMicros, estimatedMicros: repo.estimatedMicros,
  issue: null, projectLinks: [], pullRequests: [], ...overrides,
});

const asState = (row: WorkFeedItem): WorkStateItem => ({
  id: row.id, workId: row.workId, kind: row.kind, title: row.title, originalTitle: row.originalTitle ?? null,
  state: row.state, workState: row.workState ?? "in_flight", url: row.url, sha: row.sha, activityAt: row.activityAt,
  commitCount: row.commitCount, verifiedMicros: row.verifiedMicros, estimatedMicros: row.estimatedMicros, repository: row.repository,
});

export const invitationsWork = item(webRepository, "pr-invitations");
export const retryWork = item(apiRepository, "pr-retries", {
  title: "Fix repeated webhook deliveries", state: "OPEN", workState: "in_flight", activityAt: "2026-09-23T10:00:00Z",
  url: "https://github.com/fixture-org/api/pull/8", commitCount: 2,
});
export const stalledWork = item(webRepository, "pr-stalled", {
  title: "Rewrite billing jobs", state: "OPEN", workState: "stalled", activityAt: "2026-08-01T10:00:00Z",
  url: "https://github.com/fixture-org/web/pull/44", commitCount: 1, verifiedMicros: "800000", estimatedMicros: "200000",
});
export const weakTitleWork = item(webRepository, "commit-sdf", {
  kind: "commit", id: "repo-web:commit:commit-sdf", workId: "commit-sdf", title: "Commit a1b2c3d",
  originalTitle: "sdf", state: null, workState: "in_flight", sha: "a1b2c3d4e5f6",
  url: "https://github.com/fixture-org/web/commit/a1b2c3d4e5f6", commitCount: 1,
  verifiedMicros: "500000", estimatedMicros: "0",
});
export const oneRepositoryFeed: WorkFeedPage = { items: [invitationsWork], totalCount: 1, nextCursor: null };
export const multipleRepositoriesFeed: WorkFeedPage = { items: [invitationsWork, retryWork, stalledWork], totalCount: 3, nextCursor: null };

oneRepositoryPayload.states = {
  shipped: { micros: "4000000", count: 1, top: [asState(invitationsWork)] },
  inFlight: emptyBucket,
  stalled: emptyBucket,
};
multipleRepositoriesPayload.states = {
  shipped: { micros: "4000000", count: 1, top: [asState(invitationsWork)] },
  inFlight: { micros: "3000000", count: 1, top: [asState(retryWork)] },
  stalled: { micros: "1000000", count: 1, top: [asState(stalledWork)] },
};

export const ticketlessPayload: WorkSpendPayload = { ...oneRepositoryPayload, hasTicketKeys: false };
export const ticketlessFeed: WorkFeedPage = {
  items: [{ ...invitationsWork, verifiedMicros: "2500000", estimatedMicros: "1000000", commitCount: 2 }, item(webRepository, "commit-readme", {
    kind: "commit", id: "repo-web:commit:commit-readme", title: "Clarify local setup instructions", state: null, workState: "in_flight",
    url: "https://github.com/fixture-org/web/commit/abcdef1234567", sha: "abcdef1234567",
    commitCount: 1, verifiedMicros: "500000", estimatedMicros: "0",
  })], totalCount: 2, nextCursor: null,
};

export const projectLinkedPayload: WorkSpendPayload = {
  ...multipleRepositoriesPayload,
  repositories: [{ ...webRepository, projectIds: ["project-roadmap", "project-launch"] }, apiRepository, emptyRepository],
  projects: {
    state: "connected", canManage: true,
    selected: [
      { id: "project-roadmap", title: "Product roadmap", url: "https://github.com/orgs/fixture-org/projects/1", syncStatus: "synced", lastSyncedAt: at, lastError: null },
      { id: "project-launch", title: "Launch readiness", url: "https://github.com/orgs/fixture-org/projects/2", syncStatus: "synced", lastSyncedAt: at, lastError: null },
    ],
  },
};

export const projectLinkedWork: WorkFeedItem = {
  ...invitationsWork, kind: "ticket", id: "repo-web:ticket:ENG-123", workId: "ENG-123",
  ticketKey: "ENG-123", ticketSource: "pull_request_title", state: "In progress", workState: "in_flight",
  issue: { title: "Add team invitations", status: "In progress", url: "https://github.com/fixture-org/web/issues/123" },
  projectLinks: projectLinkedPayload.projects.selected.map((project) => ({
    projectId: project.id, projectTitle: project.title, projectUrl: project.url,
    title: "Add team invitations", status: "In progress", url: "https://github.com/fixture-org/web/issues/123", matchedBy: "issue_key",
  })),
  pullRequests: [{ id: "pr-invitations", title: "Add team invitations", state: "MERGED", url: invitationsWork.url }],
};
export const projectLinkedFeed: WorkFeedPage = { items: [projectLinkedWork], totalCount: 1, nextCursor: null };

export const partialCoveragePayload: WorkSpendPayload = {
  ...multipleRepositoriesPayload,
  connection: {
    ...multipleRepositoriesPayload.connection,
    state: "partial",
    connections: [{ ...githubConnection, state: "partial" }],
  },
  connections: [{ ...githubConnection, state: "partial" }],
  repositories: [webRepository, { ...apiRepository, syncStatus: "failed", lastError: "GitHub request timed out. Last successful data is shown." }, emptyRepository],
  attention: {
    unmappedAuthors: [{ identityId: "identity-unmatched", login: "fixture-new-member", commitCount: 2, suggestedDeveloperId: null }],
    developers: [{ id: "developer-fixture", name: "Fixture Member" }],
  },
};

export const workDetails: WorkDetailsPage = {
  commits: [
    { id: "commit-1", sha: "a1234567890", title: "feat: create invitation flow", url: "https://github.com/fixture-org/web/commit/a1234567890", authorLogin: "fixture-developer", activityAt: "2026-09-23T10:00:00Z" },
    { id: "commit-2", sha: "b1234567890", title: "test: cover invitation expiry", url: "https://github.com/fixture-org/web/commit/b1234567890", authorLogin: "fixture-reviewer", activityAt: at },
    { id: "commit-3", sha: "c1234567890", title: "Polish invitation copy", url: "https://github.com/fixture-org/web/commit/c1234567890", authorLogin: "fixture-developer", activityAt: at },
  ], nextCursor: null,
  evidence: [
    { date: "2026-09-23", developerName: "Fixture Developer", costKind: "verified_usage", costMicros: "3000000", weight: 1, method: "commit_weight", ticketSource: null },
    { date: "2026-09-24", developerName: "Fixture Developer", costKind: "estimated_api", costMicros: "1000000", weight: 1, method: "commit_weight", ticketSource: null },
  ], evidenceNextCursor: null,
};

export const trendWeeks = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"];
const points = (values: number[]) => values.concat(Array(Math.max(0, trendWeeks.length - values.length)).fill(0)).slice(0, trendWeeks.length);

export const repositoryTrend: WorkSpendTrend = {
  by: "repository", weeks: trendWeeks, series: [
    { id: "repo-web", title: "fixture-org/web", points: points([1_000_000, 800_000, 900_000, 700_000, 600_000, 500_000, 400_000, 100_000]), totalMicros: "5000000" },
    { id: "repo-api", title: "fixture-org/api", points: points([400_000, 300_000, 200_000, 500_000, 200_000, 100_000, 200_000, 100_000]), totalMicros: "2000000" },
  ],
};
export const projectTrend: WorkSpendTrend = {
  by: "project", weeks: trendWeeks, overlappingMicros: "4000000", series: [
    { id: "project-roadmap", title: "Product roadmap", points: points([800_000, 700_000, 600_000, 500_000, 400_000, 300_000, 200_000, 100_000]), totalMicros: "3600000" },
    { id: "project-launch", title: "Launch readiness", inferred: true, points: points([200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000]), totalMicros: "1600000" },
  ],
};
export const personTrend: WorkSpendTrend = {
  by: "person", weeks: trendWeeks, series: [
    { id: "dev-a", title: "Ada Fixture", points: points([500_000, 400_000, 300_000, 200_000, 100_000, 100_000, 100_000, 100_000]), totalMicros: "1800000" },
    { id: "dev-b", title: "Ben Fixture", points: points([200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000]), totalMicros: "1600000" },
  ],
};
export const shortTrend: WorkSpendTrend = {
  by: "repository", weeks: trendWeeks.slice(0, 3), series: [
    { id: "repo-web", title: "fixture-org/web", points: [1_000_000, 800_000, 400_000], totalMicros: "2200000" },
    { id: "repo-api", title: "fixture-org/api", points: [400_000, 300_000, 100_000], totalMicros: "800000" },
  ],
};

export const projectDistribution: WorkSpendDistribution = {
  projects: [
    {
      id: "project-roadmap", title: "Product roadmap", url: "https://github.com/orgs/fixture-org/projects/1",
      workCount: 2, verifiedMicros: "3000000", estimatedMicros: "1000000",
      shippedMicros: "2500000", inFlightMicros: "1000000", stalledMicros: "500000",
    },
    {
      id: "project-launch", title: "Launch readiness", url: "https://github.com/orgs/fixture-org/projects/2",
      workCount: 1, verifiedMicros: "800000", estimatedMicros: "800000",
      shippedMicros: "0", inFlightMicros: "800000", stalledMicros: "800000",
    },
  ],
  withoutProjectMicros: "1000000",
  withoutShippedMicros: "0",
  withoutInFlightMicros: "0",
  withoutStalledMicros: "1000000",
  overlappingMicros: "4000000",
};

export const peopleSpend = {
  people: [
    { id: "dev-a", name: "Ada Fixture", verifiedMicros: "1500000", estimatedMicros: "300000", workCount: 4 },
    { id: "dev-b", name: "Ben Fixture", verifiedMicros: "1200000", estimatedMicros: "400000", workCount: 3 },
  ],
};

export const projectInspection = {
  id: "project-roadmap",
  title: "Product roadmap",
  url: "https://github.com/orgs/fixture-org/projects/1",
  days: 90,
  workCount: 2,
  verifiedMicros: "3000000",
  estimatedMicros: "1000000",
  shippedMicros: "2500000",
  inFlightMicros: "1000000",
  stalledMicros: "500000",
  attributionMode: "wi_order" as const,
  canManage: true,
  wiTaskCount: 2,
  methodMicros: { named: "4000000", wiOrder: "0", untasked: "0" },
  outcomeMicros: { mergedPr: "2500000", openPr: "1000000", idlePr: "0", closedPr: "0", directCommit: "500000" },
  tasks: [{
    id: "repo-web:123",
    title: "Add team invitations",
    status: "In progress",
    url: "https://github.com/fixture-org/web/issues/123",
    number: 123,
    repository: { id: webRepository.id, owner: webRepository.owner, name: webRepository.name, fullName: webRepository.fullName },
    verifiedMicros: "3000000",
    estimatedMicros: "1000000",
    method: "named" as const,
    matches: [{ ...invitationsWork, reason: { matchedBy: "issue_number", reference: "#123" } }],
  }, {
    id: "repo-web:99",
    title: "Unmatched board issue",
    status: "Todo",
    url: "https://github.com/fixture-org/web/issues/99",
    number: 99,
    repository: { id: webRepository.id, owner: webRepository.owner, name: webRepository.name, fullName: webRepository.fullName },
    verifiedMicros: "0",
    estimatedMicros: "0",
    method: "named" as const,
    matches: [] as WorkFeedItem[],
  }],
  pullRequests: [{ ...invitationsWork, title: "Invitation flow" }],
  pullRequestCount: 1,
  commits: [weakTitleWork],
  commitCount: 1,
};

export const workSpendScenarios = {
  oneRepository: { payload: oneRepositoryPayload, feed: oneRepositoryFeed, details: workDetails },
  multipleRepositories: { payload: multipleRepositoriesPayload, feed: multipleRepositoriesFeed, details: workDetails },
  ticketless: { payload: ticketlessPayload, feed: ticketlessFeed, details: workDetails },
  projectLinked: { payload: projectLinkedPayload, feed: projectLinkedFeed, details: workDetails },
  partialCoverage: { payload: partialCoveragePayload, feed: multipleRepositoriesFeed, details: workDetails },
};
