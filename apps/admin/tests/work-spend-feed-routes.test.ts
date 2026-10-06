import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => {
  class WorkFeedInputError extends Error {}
  return { principal: vi.fn(), feed: vi.fn(), details: vi.fn(), distribution: vi.fn(), trend: vi.fn(), people: vi.fn(), exportCsv: vi.fn(), inspect: vi.fn(), updateMode: vi.fn(), legacy: vi.fn(), access: vi.fn(), WorkFeedInputError };
});
vi.mock("@/lib/api/app-auth", () => ({ requireAppPrincipal: mocks.principal }));
vi.mock("@usejunction/db", () => ({ prisma: { gitHubRepositoryAccess: { findFirst: mocks.access } } }));
vi.mock("@/lib/app-pages/work-spend-feed", () => ({
  loadWorkSpendFeed: mocks.feed, loadWorkSpendDetails: mocks.details, loadWorkSpendDistribution: mocks.distribution,
  loadWorkSpendTrend: mocks.trend, loadWorkSpendExport: mocks.exportCsv, loadWorkSpendPeople: mocks.people,
  loadProjectInspection: mocks.inspect, updateProjectAttributionMode: mocks.updateMode,
  parseProjectAttributionMode: (value: unknown) => {
    if (value === "named_only" || value === "wi_order") return value;
    throw new mocks.WorkFeedInputError("Attribution must be named_only or wi_order.");
  },
  WorkFeedInputError: mocks.WorkFeedInputError,
}));
vi.mock("@/lib/app-pages/work-spend-detail", () => ({ loadRepositoryWork: mocks.legacy }));
vi.mock("@/lib/errors/public", () => ({ logServerError: vi.fn() }));
import { GET as feedRoute } from "@/app/api/app/work-spend/work/route";
import { GET as detailsRoute } from "@/app/api/app/work-spend/work/details/route";
import { GET as distributionRoute } from "@/app/api/app/work-spend/distribution/route";
import { GET as repositoryRoute } from "@/app/api/app/work-spend/repositories/[id]/work/route";
import { GET as trendRoute } from "@/app/api/app/work-spend/trend/route";
import { GET as peopleRoute } from "@/app/api/app/work-spend/people/route";
import { GET as exportRoute } from "@/app/api/app/work-spend/export/route";
import { GET as projectRoute, PATCH as projectPatch } from "@/app/api/app/work-spend/projects/[id]/route";
import { WorkFeedInputError } from "@/lib/app-pages/work-spend-feed";
const request = (query = "") => new NextRequest(`http://localhost/api/app/work-spend/work${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({ orgId: "trusted-workspace", role: "owner" });
  mocks.access.mockResolvedValue({ id: "grant" });
  mocks.feed.mockResolvedValue({ items: [], totalCount: 0, nextCursor: null });
  mocks.distribution.mockResolvedValue({ projects: [], withoutProjectMicros: "0", overlappingMicros: "0" });
  mocks.trend.mockResolvedValue({ by: "repository", weeks: [], series: [] });
  mocks.people.mockResolvedValue({ people: [] });
  mocks.inspect.mockResolvedValue({ id: "project-roadmap", title: "Product roadmap", tasks: [], pullRequests: [], commits: [] });
  mocks.updateMode.mockResolvedValue(true);
  mocks.exportCsv.mockResolvedValue("title,repository\n");
});
test("unauthenticated reads return before querying data", async () => {
  mocks.principal.mockResolvedValue(NextResponse.json({ error: "Sign in" }, { status: 401 }));
  expect((await feedRoute(request())).status).toBe(401);
  expect((await detailsRoute(request())).status).toBe(401);
  expect((await distributionRoute(request())).status).toBe(401);
  expect(mocks.feed).not.toHaveBeenCalled(); expect(mocks.details).not.toHaveBeenCalled(); expect(mocks.distribution).not.toHaveBeenCalled();
});
test("Project distribution is scoped to the authenticated workspace and selected period", async () => {
  const response = await distributionRoute(request("?orgId=attacker&days=30"));
  expect(response.status).toBe(200);
  expect(mocks.distribution).toHaveBeenCalledWith({ orgId: "trusted-workspace", days: "30" });
});
test("workspace scope comes from the principal, with all filters passed to the server query", async () => {
  await feedRoute(request("?orgId=attacker&days=30&repositoryId=repo&projectId=project&developerId=dev-a&q=invitation&type=Features&sort=cost&cursor=page2&workState=shipped"));
  expect(mocks.feed).toHaveBeenCalledWith({ orgId: "trusted-workspace", days: "30", repositoryId: "repo", projectId: "project", developerId: "dev-a", q: "invitation", type: "Features", sort: "cost", cursor: "page2", workState: "shipped" });
});
test("bad cursors return 400 and unexpected failures return a safe retry message", async () => {
  mocks.feed.mockRejectedValueOnce(new WorkFeedInputError("Invalid cursor"));
  expect((await feedRoute(request())).status).toBe(400);
  mocks.feed.mockRejectedValueOnce(new Error("private database error"));
  const response = await feedRoute(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private database error");
});
test("details outside the current grant or date range return 404", async () => {
  mocks.details.mockResolvedValue(null);
  expect((await detailsRoute(request("?repositoryId=removed&kind=ticket&workId=ENG-123"))).status).toBe(404);
  expect(mocks.details.mock.calls[0][0].orgId).toBe("trusted-workspace");
});
test("repository list endpoint wraps the same feed without duplicating query logic", async () => {
  const response = await repositoryRoute(request("?sort=cost&type=Fixes"), { params: Promise.resolve({ id: "repo" }) });
  expect(response.status).toBe(200);
  expect(mocks.feed.mock.calls[0][0]).toMatchObject({ orgId: "trusted-workspace", repositoryId: "repo", sort: "cost", type: "Fixes" });
  expect(mocks.legacy).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue(null);
  expect((await repositoryRoute(request(), { params: Promise.resolve({ id: "removed" }) })).status).toBe(404);
});
test("legacy PR drill-down callers retain their response", async () => {
  mocks.legacy.mockResolvedValue({ items: [], allocationContext: [], nextCursor: null });
  const response = await repositoryRoute(request("?pullRequestId=pr-1"), { params: Promise.resolve({ id: "repo" }) });
  expect(response.status).toBe(200);
  expect(mocks.legacy.mock.calls[0][0]).toMatchObject({ repositoryId: "repo", pullRequestId: "pr-1" });
  expect(mocks.feed).not.toHaveBeenCalled();
});
test("trend grouping is scoped to the workspace and Person is admin-only", async () => {
  const trendRequest = (query = "") => new NextRequest(`http://localhost/api/app/work-spend/trend${query}`);
  expect((await trendRoute(trendRequest("?by=repository&days=30"))).status).toBe(200);
  expect(mocks.trend).toHaveBeenCalledWith({ orgId: "trusted-workspace", days: "30", by: "repository" });
  mocks.principal.mockResolvedValue({ orgId: "trusted-workspace", role: "manager" });
  expect((await trendRoute(trendRequest("?by=person"))).status).toBe(403);
  expect(mocks.trend).toHaveBeenCalledTimes(1);
});
test("people ranking is admin-only and scoped to the signed-in workspace", async () => {
  const peopleRequest = (query = "") => new NextRequest(`http://localhost/api/app/work-spend/people${query}`);
  expect((await peopleRoute(peopleRequest("?days=90"))).status).toBe(200);
  expect(mocks.people).toHaveBeenCalledWith({ orgId: "trusted-workspace", days: "90" });
  mocks.principal.mockResolvedValue({ orgId: "trusted-workspace", role: "manager" });
  expect((await peopleRoute(peopleRequest("?days=90"))).status).toBe(403);
  expect(mocks.people).toHaveBeenCalledTimes(1);
  expect((await feedRoute(request("?developerId=dev-a"))).status).toBe(403);
  expect(mocks.feed).not.toHaveBeenCalled();
});
test("export streams a CSV attachment for the signed-in workspace", async () => {
  const response = await exportRoute(new NextRequest("http://localhost/api/app/work-spend/export?days=90"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/text\/csv/);
  expect(response.headers.get("content-disposition")).toContain("work-spend-90d.csv");
  expect(mocks.exportCsv).toHaveBeenCalledWith({ orgId: "trusted-workspace", days: "90" });
});
test("project inspection is scoped to the signed-in workspace and returns 404 when missing", async () => {
  const projectRequest = (id: string, query = "") => new NextRequest(`http://localhost/api/app/work-spend/projects/${id}${query}`);
  const params = { params: Promise.resolve({ id: "project-roadmap" }) };
  const ok = await projectRoute(projectRequest("project-roadmap", "?days=30"), params);
  expect(ok.status).toBe(200);
  expect(mocks.inspect).toHaveBeenCalledWith({ orgId: "trusted-workspace", projectId: "project-roadmap", days: "30" });
  expect((await ok.json()).data.canManage).toBe(true);
  mocks.principal.mockResolvedValue({ orgId: "trusted-workspace", role: "manager" });
  expect((await (await projectRoute(projectRequest("project-roadmap"), params)).json()).data.canManage).toBe(false);
  mocks.inspect.mockResolvedValueOnce(null);
  expect((await projectRoute(projectRequest("missing"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
});
test("project attribution mode updates are workspace-scoped", async () => {
  const patchRequest = (body: unknown) => new NextRequest("http://localhost/api/app/work-spend/projects/project-roadmap", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const params = { params: Promise.resolve({ id: "project-roadmap" }) };
  expect((await projectPatch(patchRequest({ attributionMode: "named_only" }), params)).status).toBe(200);
  expect(mocks.updateMode).toHaveBeenCalledWith({ orgId: "trusted-workspace", projectId: "project-roadmap", attributionMode: "named_only" });
  expect((await projectPatch(patchRequest({ attributionMode: "nope" }), params)).status).toBe(400);
  mocks.updateMode.mockResolvedValueOnce(false);
  expect((await projectPatch(patchRequest({ attributionMode: "wi_order" }), params)).status).toBe(404);
  mocks.principal.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  expect((await projectPatch(patchRequest({ attributionMode: "wi_order" }), params)).status).toBe(403);
});
