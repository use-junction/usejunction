import { expect, test } from "vitest";
import { cleanWorkTitle, isWeakWorkTitle } from "@/lib/features/work-title";

test("keeps a real title and replaces a weak commit title with the sha", () => {
  expect(isWeakWorkTitle("Add team invitations")).toBe(false);
  expect(cleanWorkTitle({ title: "Add team invitations" })).toEqual({ title: "Add team invitations", originalTitle: null });
  expect(cleanWorkTitle({ title: "sdf", kind: "commit", sha: "a1b2c3d4e5f6" })).toEqual({
    title: "Commit a1b2c3d", originalTitle: "sdf",
  });
});

test("prefers an issue or pull-request title over a weak commit subject", () => {
  expect(cleanWorkTitle({
    title: "wip", kind: "commit", sha: "deadbeef", issueTitle: "Invite teammates from settings",
  })).toEqual({ title: "Invite teammates from settings", originalTitle: "wip" });
  expect(cleanWorkTitle({
    title: "ok", kind: "pull_request", pullRequestTitle: "Fix repeated webhook deliveries",
  })).toEqual({ title: "Fix repeated webhook deliveries", originalTitle: "ok" });
});
