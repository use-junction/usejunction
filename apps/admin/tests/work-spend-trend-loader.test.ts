import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ raw: vi.fn() }));
vi.mock("@usejunction/db", async () => {
  const { Prisma } = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return { Prisma, prisma: { $queryRaw: mocks.raw } };
});

beforeEach(() => { mocks.raw.mockReset(); });

test("classifies shipped, in-flight, and stalled work and cleans a weak title", async () => {
  mocks.raw.mockResolvedValue([{
    workCount: 3,
    totals: [
      { workState: "shipped", count: 1, micros: "4000000" },
      { workState: "in_flight", count: 1, micros: "2000000" },
      { workState: "stalled", count: 1, micros: "500000" },
    ],
    top: [
      { id: "pr-1", workId: "pr-1", kind: "pull_request", title: "Ship invites", state: "MERGED", workState: "shipped", url: "https://github.com/acme/web/pull/1", sha: null, activityAt: "2026-09-24T10:00:00Z", commitCount: 2, verifiedMicros: "3000000", estimatedMicros: "1000000", repository: { id: "r1", owner: "acme", name: "web", fullName: "acme/web" } },
      { id: "pr-2", workId: "pr-2", kind: "pull_request", title: "Open retries", state: "OPEN", workState: "in_flight", url: "https://github.com/acme/web/pull/2", sha: null, activityAt: "2026-09-23T10:00:00Z", commitCount: 1, verifiedMicros: "2000000", estimatedMicros: "0", repository: { id: "r1", owner: "acme", name: "web", fullName: "acme/web" } },
      { id: "c-1", workId: "c-1", kind: "commit", title: "sdf", state: null, workState: "stalled", url: "https://github.com/acme/web/commit/a1b2c3d4", sha: "a1b2c3d4e5", activityAt: "2026-08-01T10:00:00Z", commitCount: 1, verifiedMicros: "500000", estimatedMicros: "0", repository: { id: "r1", owner: "acme", name: "web", fullName: "acme/web" } },
    ],
  }]);
  const { loadWorkSpendStates } = await import("@/lib/app-pages/work-spend-feed");
  const states = await loadWorkSpendStates({ orgId: "org", days: "90" });
  assert.equal(states.workCount, 3);
  assert.equal(states.shipped.count, 1);
  assert.equal(states.inFlight.micros, "2000000");
  assert.equal(states.stalled.top[0]?.title, "Commit a1b2c3d");
  assert.equal(states.stalled.top[0]?.originalTitle, "sdf");
});

test("weekly repository grouping keeps the top four series and folds the rest into Other", async () => {
  mocks.raw.mockResolvedValue([
    { week: "2026-08-03", id: "r1", title: "acme/web", inferred: false, micros: "5000000" },
    { week: "2026-08-03", id: "r2", title: "acme/api", inferred: false, micros: "4000000" },
    { week: "2026-08-03", id: "r3", title: "acme/mobile", inferred: false, micros: "3000000" },
    { week: "2026-08-03", id: "r4", title: "acme/docs", inferred: false, micros: "2000000" },
    { week: "2026-08-03", id: "r5", title: "acme/ops", inferred: false, micros: "1000000" },
    { week: "2026-08-10", id: "r5", title: "acme/ops", inferred: false, micros: "500000" },
  ]);
  const { loadWorkSpendTrend } = await import("@/lib/app-pages/work-spend-feed");
  const trend = await loadWorkSpendTrend({ orgId: "org", days: "90", by: "repository" });
  assert.equal(trend.by, "repository");
  assert.deepEqual(trend.series.map((series) => series.id), ["r1", "r2", "r3", "r4", "__other__"]);
  assert.equal(trend.series.at(-1)?.totalMicros, "1500000");
  assert.ok(trend.weeks.length >= 4);
});

test("project grouping keeps an inferred flag and overlap total", async () => {
  mocks.raw.mockResolvedValue([{
    overlappingMicros: "4000000",
    rows: [
      { week: "2026-08-03", id: "p1", title: "Roadmap", inferred: false, micros: "3000000" },
      { week: "2026-08-03", id: "p2", title: "Launch", inferred: true, micros: "1000000" },
    ],
  }]);
  const { loadWorkSpendTrend } = await import("@/lib/app-pages/work-spend-feed");
  const trend = await loadWorkSpendTrend({ orgId: "org", days: "90", by: "project" });
  assert.equal(trend.by, "project");
  assert.equal(trend.overlappingMicros, "4000000");
  assert.equal(trend.series.find((series) => series.id === "p2")?.inferred, true);
  assert.equal(trend.series.find((series) => series.id === "p1")?.inferred, undefined);
});

test("person grouping is alphabetical rather than a spend ranking", async () => {
  mocks.raw.mockResolvedValue([
    { week: "2026-08-03", id: "b", title: "Ben", inferred: false, micros: "9000000" },
    { week: "2026-08-03", id: "a", title: "Ada", inferred: false, micros: "1000000" },
  ]);
  const { loadWorkSpendTrend } = await import("@/lib/app-pages/work-spend-feed");
  const trend = await loadWorkSpendTrend({ orgId: "org", days: "90", by: "person" });
  assert.deepEqual(trend.series.map((series) => series.title), ["Ada", "Ben"]);
});

test("people ranking is spend order with billed and estimated totals", async () => {
  mocks.raw.mockResolvedValue([
    { id: "dev-a", name: "Ada", verifiedMicros: "1500000", estimatedMicros: "300000", workCount: 4 },
    { id: "dev-b", name: "Ben", verifiedMicros: "1200000", estimatedMicros: "0", workCount: 2 },
  ]);
  const { loadWorkSpendPeople } = await import("@/lib/app-pages/work-spend-feed");
  const result = await loadWorkSpendPeople({ orgId: "org", days: "90" });
  assert.deepEqual(result.people.map((row) => row.name), ["Ada", "Ben"]);
  assert.equal(result.people[0]?.verifiedMicros, "1500000");
  assert.equal(result.people[1]?.workCount, 2);
});

test("CSV export falls back from a weak commit title", async () => {
  mocks.raw.mockResolvedValue([{
    kind: "commit", title: "sdf", sha: "a1b2c3d4e5f6", issueTitle: null, pullRequestTitle: null,
    repository: "acme/web", state: null, workState: "in_flight", projects: "",
    verifiedMicros: "1500000", estimatedMicros: "500000",
  }]);
  const { loadWorkSpendExport } = await import("@/lib/app-pages/work-spend-feed");
  const csv = await loadWorkSpendExport({ orgId: "org", days: "90" });
  assert.match(csv, /^title,repository,state,work_state,projects,verified_usd,estimated_usd\n/);
  assert.match(csv, /Commit a1b2c3d,acme\/web,,in_flight,,1\.50,0\.50/);
});
