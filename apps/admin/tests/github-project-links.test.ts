import { expect, test } from "vitest";
import { projectLinksForWork } from "@/lib/features/github-project-links";

const project = (id: string) => ({ id, title: `Project ${id}`, url: `https://github.com/orgs/acme/projects/${id}` });

test("keeps a shared issue in both Projects and links a Project PR without duplicating work cost", () => {
  const items = [
    { externalItemId: "a", contentType: "Issue", number: 12, title: "Ship billing", status: "Doing", url: "https://github.com/acme/app/issues/12", project: project("one") },
    { externalItemId: "b", contentType: "Issue", number: 12, title: "Ship billing", status: "Review", url: "https://github.com/acme/app/issues/12", project: project("two") },
    { externalItemId: "c", contentType: "PullRequest", number: 7, title: "Ship billing", status: "Done", url: "https://github.com/acme/app/pull/7", project: project("one") },
  ];
  const links = projectLinksForWork(items, [{ number: 7, closingIssues: [{ url: "https://github.com/acme/app/issues/12" }] }]);
  expect(links.map((link) => [link.projectId, link.matchedBy])).toEqual([["one", "closing_reference"], ["two", "closing_reference"], ["one", "project_pr"]]);
});

test("matches a GitHub issue number from a commit or PR and covers remaining Projects by repository", () => {
  const items = [
    { externalItemId: "a", contentType: "Issue", number: 12, title: "Ship billing", status: null, url: "https://github.com/acme/app/issues/12", project: project("one") },
    { externalItemId: "b", contentType: "Issue", number: 13, title: "Other work", status: null, url: "https://github.com/acme/app/issues/13", project: project("two") },
  ];
  const links = projectLinksForWork(items, [], [12]);
  expect(links.map((link) => [link.projectId, link.matchedBy, link.title])).toEqual([
    ["one", "issue_number", "Ship billing"],
    ["two", "repository", "Project two"],
  ]);
});
