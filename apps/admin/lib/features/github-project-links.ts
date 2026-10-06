import { parseGitHubIssueNumbers } from "@/lib/features/ticket-keys";

export type ProjectLinkItem = {
  externalItemId: string;
  contentType: string;
  number: number;
  title: string;
  status: string | null;
  url: string;
  project: { id: string; title: string; url: string };
};

export type ProjectLinkedPr = {
  number: number;
  title?: string | null;
  closingIssues: unknown;
};

function closingUrls(prs: ProjectLinkedPr[]) {
  return new Set(prs.flatMap((pr) => Array.isArray(pr.closingIssues)
    ? pr.closingIssues.flatMap((issue) => issue && typeof issue === "object" && "url" in issue && typeof issue.url === "string" ? [issue.url.toLowerCase()] : [])
    : []));
}

function referencedNumbers(prs: ProjectLinkedPr[], extra: number[]) {
  const fromPrs = prs.flatMap((pr) => [
    pr.number,
    ...parseGitHubIssueNumbers({ title: pr.title }),
    ...(Array.isArray(pr.closingIssues)
      ? pr.closingIssues.flatMap((issue) => issue && typeof issue === "object" && "number" in issue && typeof issue.number === "number" ? [issue.number] : [])
      : []),
  ]);
  return new Set([...extra, ...fromPrs]);
}

export function projectLinksForWork(items: ProjectLinkItem[], prs: ProjectLinkedPr[], referencedNumbersInput: number[] = []) {
  const urls = closingUrls(prs);
  const prNumbers = new Set(prs.map((pr) => pr.number));
  const numbers = referencedNumbers(prs, referencedNumbersInput);
  const itemLinks = items.flatMap((item) => {
    const matchedBy = item.contentType === "PullRequest" && prNumbers.has(item.number) ? "project_pr"
      : item.contentType === "Issue" && urls.has(item.url.toLowerCase()) ? "closing_reference"
      : numbers.has(item.number) ? "issue_number"
      : null;
    return matchedBy ? [{
      projectId: item.project.id, projectTitle: item.project.title, projectUrl: item.project.url,
      title: item.title, status: item.status, url: item.url, matchedBy,
    }] : [];
  });
  const pinned = new Set(itemLinks.map((link) => link.projectId));
  const repoLinks = [...new Map(items.map((item) => [item.project.id, item.project])).values()]
    .filter((project) => !pinned.has(project.id))
    .map((project) => ({
      projectId: project.id, projectTitle: project.title, projectUrl: project.url,
      title: project.title, status: null, url: project.url, matchedBy: "repository",
    }));
  return [...itemLinks, ...repoLinks];
}
