import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { Prisma } from "@prisma/client";

// Opt-in PostgreSQL verification. All fixture tables are connection-local TEMP tables;
// every test rolls back. No persistent tables or customer data are changed.
const run = process.env.RUN_WORK_SPEND_DB_TESTS === "1";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@usejunction/db", async () => ({ Prisma: (await import("@prisma/client")).Prisma, prisma: { $queryRaw: mock.query } }));
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DATABASE_URL });
const { loadWorkSpendFeed: feed, loadWorkSpendDetails: details, loadWorkSpendDistribution: distribution, loadProjectInspection: inspect } = await import("@/lib/app-pages/work-spend-feed");
const orgId = "test-org";
const now = new Date();
const recent = new Date(now.getTime() - 86400000).toISOString();
const older = new Date(now.getTime() - 45 * 86400000).toISOString();
const day = recent.slice(0, 10);

async function commit(id: string, repo = "r1", pr: string | null = null, title = `feat: ${id}`, at = recent) {
  await db.query("INSERT INTO git_commits VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,'alice')", [id, orgId, repo, pr, `sha-${id}`, JSON.stringify([]), at, title]);
}
async function cost(id: string, repo: string, commitId: string | null, amount: number, kind = "verified_usage", pullRequestId: string | null = null) {
  await db.query("INSERT INTO feature_cost_allocations VALUES ($1,$2,$3,'dev',$4,null,$5,$6,$7,'commit_split',null,2,$8)", [id, orgId, repo, commitId ? `sha-${commitId}` : null, day, kind, amount, pullRequestId]);
}
async function pr(id: string, repo = "r1", number = 12, closing = "[]", title = "Invitation flow") {
  await db.query("INSERT INTO git_pull_requests VALUES ($1,$2,'conn',$3,$4,$5,'MERGED',$6,'alice',$7,null,null,$8,$9)", [id, orgId, repo, number, title, `https://github.com/acme/${repo}/pull/${number}`, recent, JSON.stringify([]), closing]);
}

describe.skipIf(!run)("work feed with PostgreSQL", () => {
  beforeAll(async () => { await db.connect(); mock.query.mockImplementation(async (sql: Prisma.Sql) => (await db.query(sql.text, sql.values)).rows); });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => {
    await db.query(`BEGIN;
      CREATE TEMP TABLE repositories(id text,org_id text,owner text,name text) ON COMMIT DROP;
      CREATE TEMP TABLE github_repository_accesses(org_id text,repository_id text,connection_id text,granted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE provider_connections(id text,org_id text,provider text,status text) ON COMMIT DROP;
      CREATE TEMP TABLE git_commits(id text,org_id text,repository_id text,pull_request_id text,sha text,ticket_keys jsonb,is_bot boolean,authored_at timestamptz,message_headline text,author_login text) ON COMMIT DROP;
      CREATE TEMP TABLE git_pull_requests(id text,org_id text,connection_id text,repository_id text,number int,title text,state text,url text,author_login text,github_created_at timestamptz,merged_at timestamptz,closed_at timestamptz,ticket_keys jsonb,closing_issues jsonb) ON COMMIT DROP;
      CREATE TEMP TABLE feature_cost_allocations(id text,org_id text,repository_id text,developer_id text,commit_sha text,ticket_key text,date date,cost_kind text,cost_micros bigint,method text,ticket_key_source text,weight double precision,pull_request_id text) ON COMMIT DROP;
      CREATE TEMP TABLE github_projects(id text,org_id text,connection_id text,title text,url text,attribution_mode text default 'wi_order') ON COMMIT DROP;
      CREATE TEMP TABLE github_project_items(org_id text,repository_id text,project_id text,content_type text,number int,title text,status text,url text,content_created_at timestamptz,content_closed_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE users(id text,org_id text,name text) ON COMMIT DROP;
      INSERT INTO provider_connections VALUES ('conn','test-org','github','active');
      INSERT INTO users VALUES ('dev','test-org','Alice');
      INSERT INTO repositories VALUES ('r1','test-org','acme','web'),('r2','test-org','acme','api'),('r3','test-org','acme','inactive');
      INSERT INTO github_repository_accesses SELECT 'test-org',id,'conn',now() FROM repositories;`);
  });
  afterEach(async () => { await db.query("ROLLBACK"); });

  test("empty and inaccessible work stay empty", async () => {
    expect(await feed({ orgId })).toEqual({ items: [], totalCount: 0, nextCursor: null });
    await commit("one");
    expect((await feed({ orgId: "other-org" })).totalCount).toBe(0);
    await db.query("DELETE FROM github_repository_accesses WHERE repository_id='r1'");
    expect((await feed({ orgId })).items).toHaveLength(0);
    expect(await details({ orgId, repositoryId: "r1", kind: "commit", workId: "one" })).toBeNull();
  });

  test("repository-aware ownership conserves costs for mixed PR and standalone commits", async () => {
    await pr("pr1");
    await commit("feature", "r1", "pr1");
    await commit("plain", "r1", "pr1", "fix: retry invitations");
    await commit("other", "r2");
    await cost("a1", "r1", null, 300, "verified_usage", "pr1");
    await cost("a2", "r1", "plain", 200, "estimated_api");
    await cost("a3", "r2", "other", 500);
    const result = await feed({ orgId });
    expect(result.totalCount).toBe(2);
    expect(new Set(result.items.map(i => i.id)).size).toBe(2);
    expect(result.items.reduce((sum, i) => sum + BigInt(i.verifiedMicros), 0n)).toBe(800n);
    expect(result.items.reduce((sum, i) => sum + BigInt(i.estimatedMicros), 0n)).toBe(200n);
    expect(result.items.find(i => i.kind === "pull_request")?.commitCount).toBe(2);
    expect((await feed({ orgId, repositoryId: "r2" })).items[0].verifiedMicros).toBe("500");
    const evidence = await details({ orgId, repositoryId: "r1", kind: "pull_request", workId: "pr1" });
    expect(evidence?.commits.map(c => c.id).sort()).toEqual(["feature", "plain"]);
    expect(evidence?.evidence[0]).toMatchObject({ costMicros: "300", weight: 2, developerName: "Alice" });
  });

  test("Project coverage, closing references and GitHub numbers retain complete costs", async () => {
    await pr("pr1", "r1", 12, JSON.stringify([{ url: "https://github.com/acme/r1/issues/55" }]), "Invitation flow");
    await commit("feature", "r1", "pr1");
    await commit("fix", "r1", "pr1", "fix: retry delivery");
    await cost("a1", "r1", null, 800, "verified_usage", "pr1");
    await cost("a2", "r1", null, 200, "estimated_api", "pr1");
    await db.query(`INSERT INTO github_projects (id, org_id, connection_id, title, url) VALUES ('p1','test-org','conn','Roadmap','https://github.com/orgs/acme/projects/1'),('p2','test-org','conn','Launch','https://github.com/orgs/acme/projects/2');
      INSERT INTO github_project_items VALUES
       ('test-org','r1','p1','Issue',55,'Team invitations','Todo','https://github.com/acme/r1/issues/55',null,null),
       ('test-org','r1','p2','Issue',55,'Team invitations','In progress','https://github.com/acme/r1/issues/55',null,null),
       ('test-org','r1','p1','PullRequest',12,'Invitation PR','MERGED','https://github.com/acme/r1/pull/12',null,null),
       ('test-org','r2','p1','Issue',99,'Other repo','OPEN','https://github.com/acme/r2/issues/99',null,null);`);
    const result = await feed({ orgId, q: "alice", type: "Fixes", projectId: "p1", repositoryId: "r1" });
    expect(result.totalCount).toBe(1);
    expect(result.items[0]).toMatchObject({ title: "Invitation flow", verifiedMicros: "800", estimatedMicros: "200", commitCount: 2 });
    expect(result.items[0].projectLinks.some(p => p.matchedBy === "closing_reference")).toBe(true);
    expect(result.items[0].projectLinks.some(p => p.matchedBy === "project_pr")).toBe(true);
    expect(result.items[0].projectLinks.some(p => p.title === "Other repo")).toBe(false);
    expect((await feed({ orgId, projectId: "p2" })).items[0].verifiedMicros).toBe("800");
    await db.query("UPDATE git_pull_requests SET closing_issues='[]'");
    expect((await feed({ orgId, projectId: "p2" })).items[0].projectLinks.some(p => p.matchedBy === "repository")).toBe(true);
  });

  test.each(["activity", "cost"])("%s sorting is stable across cursor boundaries", async (sort) => {
    for (let n = 0; n < 29; n++) {
      const id = `c${String(n).padStart(2, "0")}`;
      await commit(id);
      await cost(`a${n}`, "r1", id, n);
    }
    const first = await feed({ orgId, sort });
    expect(first.items).toHaveLength(25);
    expect(first.totalCount).toBe(29);
    const second = await feed({ orgId, sort, cursor: first.nextCursor });
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map(i => i.id)).size).toBe(29);
    if (sort === "cost") expect(all.map(i => Number(i.verifiedMicros))).toEqual(Array.from({ length: 29 }, (_, n) => 28-n));
    await expect(feed({ orgId, sort, q: "different", cursor: first.nextCursor })).rejects.toThrow(/cursor/);
  });

  test("commit and allocation evidence cursors paginate independently", async () => {
    await pr("batch");
    for (let n = 0; n < 27; n++) {
      await commit(`member-${n}`, "r1", "batch");
      await cost(`evidence-${String(n).padStart(2, "0")}`, "r1", `member-${n}`, 10);
    }
    const input = { orgId, repositoryId: "r1", kind: "pull_request", workId: "batch" };
    const first = (await details(input))!;
    expect(first.commits).toHaveLength(25);
    expect(first.evidence).toHaveLength(25);
    const next = (await details({ ...input, cursor: first.nextCursor, evidenceCursor: first.evidenceNextCursor }))!;
    expect(next.commits).toHaveLength(2);
    expect(next.evidence).toHaveLength(2);
    expect(next.nextCursor).toBeNull();
    expect(next.evidenceNextCursor).toBeNull();
    expect(new Set([...first.commits, ...next.commits].map(c => c.id)).size).toBe(27);
    expect([...first.evidence, ...next.evidence].reduce((total, row) => total + BigInt(row.costMicros), 0n)).toBe(270n);
    await expect(details({ ...input, repositoryId: "r2", cursor: first.nextCursor })).rejects.toThrow(/cursor/);
  });

  test("Project coverage includes every commit in a board repository", async () => {
    await commit("one", "r1", null, "Fixes #123");
    await commit("two", "r2");
    await commit("prefix", "r1");
    await db.query(`INSERT INTO github_projects (id, org_id, connection_id, title, url) VALUES ('p1','test-org','conn','Roadmap','https://github.com/orgs/acme/projects/1');
      INSERT INTO github_project_items VALUES ('test-org','r1','p1','Issue',123,'Invitation flow',null,'https://github.com/acme/r1/issues/123',null,null);`);
    const result = await feed({ orgId, projectId: "p1" });
    expect(result.totalCount).toBe(2);
    expect(new Set(result.items.map((item) => item.repository.id))).toEqual(new Set(["r1"]));
    expect(result.items.find((item) => item.workId === "one")?.projectLinks.some((link) => link.matchedBy === "issue_number")).toBe(true);
    expect(result.items.find((item) => item.workId === "prefix")?.projectLinks.some((link) => link.matchedBy === "repository")).toBe(true);
  });

  test("Project destinations count a work group once per Project and disclose overlap", async () => {
    await commit("one", "r1");
    await commit("without", "r2");
    await cost("matched", "r1", "one", 800);
    await cost("other", "r2", "without", 200, "estimated_api");
    await db.query(`INSERT INTO github_projects (id, org_id, connection_id, title, url) VALUES
      ('p1','test-org','conn','Roadmap','https://github.com/orgs/acme/projects/1'),
      ('p2','test-org','conn','Launch','https://github.com/orgs/acme/projects/2');
      INSERT INTO github_project_items VALUES
      ('test-org','r1','p1','Issue',12,'Invitations','Todo','https://github.com/acme/r1/issues/12',null,null),
      ('test-org','r1','p1','Issue',13,'Follow-up','Todo','https://github.com/acme/r1/issues/13',null,null),
      ('test-org','r1','p2','Issue',12,'Invitations','Doing','https://github.com/acme/r1/issues/12',null,null);`);
    const result = await distribution({ orgId });
    expect(result.projects).toEqual([
      { id: "p2", title: "Launch", url: "https://github.com/orgs/acme/projects/2", workCount: 1, verifiedMicros: "800", estimatedMicros: "0", shippedMicros: "0", inFlightMicros: "800", stalledMicros: "0" },
      { id: "p1", title: "Roadmap", url: "https://github.com/orgs/acme/projects/1", workCount: 1, verifiedMicros: "800", estimatedMicros: "0", shippedMicros: "0", inFlightMicros: "800", stalledMicros: "0" },
    ]);
    expect(result.withoutProjectMicros).toBe("200");
    expect(result.withoutInFlightMicros).toBe("200");
    expect(result.overlappingMicros).toBe("800");
    const unprojected = await feed({ orgId, projectId: "__none__" });
    expect(unprojected.items.map((item) => item.id)).toEqual(["r2:commit:without"]);
    await db.query("DELETE FROM github_repository_accesses WHERE repository_id='r1'");
    expect((await distribution({ orgId })).projects.map((project) => project.verifiedMicros)).toEqual(["0", "0"]);
  });

  test("project inspection lists tasks, pull requests, and commits for a known board", async () => {
    await pr("pr1", "r1", 12, JSON.stringify([{ url: "https://github.com/acme/r1/issues/55" }]), "Invitation flow");
    await commit("feature", "r1", "pr1");
    await commit("solo", "r1", null, "feat: standalone");
    await cost("a1", "r1", null, 800, "verified_usage", "pr1");
    await cost("a2", "r1", "solo", 200, "estimated_api");
    await db.query(`INSERT INTO github_projects (id, org_id, connection_id, title, url) VALUES ('p1','test-org','conn','Roadmap','https://github.com/orgs/acme/projects/1');
      INSERT INTO github_project_items VALUES
       ('test-org','r1','p1','Issue',55,'Team invitations','Todo','https://github.com/acme/r1/issues/55',null,null),
       ('test-org','r1','p1','Issue',99,'Unmatched','OPEN','https://github.com/acme/r1/issues/99',null,null),
       ('test-org','r1','p1','PullRequest',12,'Invitation PR','MERGED','https://github.com/acme/r1/pull/12',null,null);`);
    expect(await inspect({ orgId, projectId: "missing" })).toBeNull();
    const page = await inspect({ orgId, projectId: "p1", days: "90" });
    expect(page).toMatchObject({ id: "p1", title: "Roadmap", workCount: 2, verifiedMicros: "800", estimatedMicros: "200" });
    expect(page?.tasks.map((task) => task.title)).toEqual(["Team invitations", "Unmatched"]);
    expect(page?.tasks[0]).toMatchObject({ verifiedMicros: "800", estimatedMicros: "0", method: "named" });
    expect(page?.tasks[1]).toMatchObject({ verifiedMicros: "0", estimatedMicros: "0", matches: [], method: "named" });
    expect(page?.methodMicros).toMatchObject({ named: "800", wiOrder: "0", untasked: "200" });
    expect(page?.outcomeMicros).toMatchObject({ mergedPr: "800", openPr: "0", idlePr: "0", closedPr: "0", directCommit: "200" });
    expect(page?.attributionMode).toBe("wi_order");
    expect(page?.pullRequests).toHaveLength(1);
    expect(page?.pullRequests[0]).toMatchObject({ kind: "pull_request", title: "Invitation flow", verifiedMicros: "800" });
    expect(page?.commits[0]).toMatchObject({ kind: "commit", verifiedMicros: "0", estimatedMicros: "200" });
  });

  test("WI titles split otherwise unreferenced commits across each item's open window", async () => {
    const earlier = new Date(now.getTime() - 10 * 86400000).toISOString();
    const midpoint = new Date(now.getTime() - 5 * 86400000).toISOString();
    const handoff = new Date(now.getTime() - 2 * 86400000).toISOString();
    await commit("first", "r1", null, "feat: scaffold", midpoint);
    await commit("second", "r1", null, "feat: agent", recent);
    await cost("c1", "r1", "first", 400);
    await cost("c2", "r1", "second", 600);
    await db.query(`INSERT INTO github_projects (id, org_id, connection_id, title, url) VALUES ('p1','test-org','conn','usejunction','https://github.com/orgs/acme/projects/1');`);
    await db.query(`INSERT INTO github_project_items VALUES
       ('test-org','r1','p1','Issue',6,'WI-01: Initial project structure','Done','https://github.com/acme/r1/issues/6',$1,null),
       ('test-org','r1','p1','Issue',7,'WI-02: Docker support','Done','https://github.com/acme/r1/issues/7',$2,null)`, [earlier, handoff]);
    const page = await inspect({ orgId, projectId: "p1", days: "90" });
    const byTitle = new Map(page?.tasks.map((task) => [task.title, task]));
    expect(byTitle.get("WI-01: Initial project structure")).toMatchObject({ verifiedMicros: "400", method: "wi_order" });
    expect(byTitle.get("WI-02: Docker support")).toMatchObject({ verifiedMicros: "600", method: "wi_order" });
    expect(page?.workCount).toBe(2);
    expect(page?.methodMicros).toMatchObject({ named: "0", wiOrder: "1000", untasked: "0" });
    expect(page?.outcomeMicros).toMatchObject({ directCommit: "1000", mergedPr: "0" });
    expect(byTitle.get("WI-01: Initial project structure")?.matches[0]?.reason).toMatchObject({ matchedBy: "timeline" });
  });

  test("named_only leaves WI tasks at zero and counts unnamed commits as untasked", async () => {
    const earlier = new Date(now.getTime() - 10 * 86400000).toISOString();
    const midpoint = new Date(now.getTime() - 5 * 86400000).toISOString();
    const handoff = new Date(now.getTime() - 2 * 86400000).toISOString();
    await commit("first", "r1", null, "feat: scaffold", midpoint);
    await commit("second", "r1", null, "feat: agent", recent);
    await cost("c1", "r1", "first", 400);
    await cost("c2", "r1", "second", 600);
    await db.query(`INSERT INTO github_projects (id, org_id, connection_id, title, url, attribution_mode) VALUES ('p1','test-org','conn','usejunction','https://github.com/orgs/acme/projects/1','named_only');`);
    await db.query(`INSERT INTO github_project_items VALUES
       ('test-org','r1','p1','Issue',6,'WI-01: Initial project structure','Done','https://github.com/acme/r1/issues/6',$1,null),
       ('test-org','r1','p1','Issue',7,'WI-02: Docker support','Done','https://github.com/acme/r1/issues/7',$2,null)`, [earlier, handoff]);
    const page = await inspect({ orgId, projectId: "p1", days: "90" });
    const byTitle = new Map(page?.tasks.map((task) => [task.title, task]));
    expect(byTitle.get("WI-01: Initial project structure")).toMatchObject({ verifiedMicros: "0" });
    expect(byTitle.get("WI-02: Docker support")).toMatchObject({ verifiedMicros: "0" });
    expect(page?.workCount).toBe(2);
    expect(page?.attributionMode).toBe("named_only");
    expect(page?.methodMicros).toMatchObject({ named: "0", wiOrder: "0", untasked: "1000" });
    expect(page?.outcomeMicros.directCommit).toBe("1000");
  });

  test("date and type filters include unmatched authors without inventing allocations", async () => {
    await commit("recent", "r1", null, "Unclassified work");
    await commit("old", "r1", null, "feat: old feature", older);
    expect((await feed({ orgId, days: "30" })).totalCount).toBe(1);
    expect((await feed({ orgId, days: "90" })).totalCount).toBe(2);
    const filtered = await feed({ orgId, type: "Unclassified" });
    expect(filtered.items[0]).toMatchObject({ title: "Unclassified work", verifiedMicros: "0", estimatedMicros: "0" });
  });
});
