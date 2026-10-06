import assert from "node:assert/strict";
import { test } from "vitest";
import { isBotLogin, parseGitHubIssueNumbers, parseNoreply, parseTicketKeys } from "@/lib/features/ticket-keys";

test("parses Jira keys from titles, branches, and commits", () => {
  assert.deepEqual(parseTicketKeys({ title: "PAY-219 checkout" }), ["PAY-219"]);
  assert.deepEqual(parseTicketKeys({ title: "[JRA-1] fix" }), ["JRA-1"]);
  assert.deepEqual(parseTicketKeys({ branch: "feature/pay-219-x" }), ["PAY-219"]);
  assert.deepEqual(parseTicketKeys({ messages: ["Closes PAY-219 and PAY-220"] }), ["PAY-219", "PAY-220"]);
});

test("rejects encodings, models, and dependabot false positives", () => {
  assert.deepEqual(parseTicketKeys({ title: "Support UTF-8 and GPT-4" }), []);
  assert.deepEqual(parseTicketKeys({ title: "SHA-256 checksum" }), []);
  assert.deepEqual(parseTicketKeys({ branch: "dependabot/npm_and_yarn/lodash-4.17.21" }), []);
});

test("parseNoreply extracts login and bot flag", () => {
  assert.deepEqual(parseNoreply("12345+ada@users.noreply.github.com"), {
    githubId: 12345,
    login: "ada",
    isBot: false,
  });
  assert.deepEqual(parseNoreply("ada@users.noreply.github.com"), {
    githubId: null,
    login: "ada",
    isBot: false,
  });
  assert.equal(parseNoreply("418+dependabot[bot]@users.noreply.github.com")?.isBot, true);
  assert.equal(parseNoreply("ada@acme.com"), null);
});

test("isBotLogin covers GitHub bots", () => {
  assert.equal(isBotLogin("web-flow"), true);
  assert.equal(isBotLogin("renovate[bot]"), true);
  assert.equal(isBotLogin("ada"), false);
});

test("parses GitHub issue numbers from titles and commit messages", () => {
  assert.deepEqual(parseGitHubIssueNumbers({ title: "Fixes #12 and #13" }), [12, 13]);
  assert.deepEqual(parseGitHubIssueNumbers({ messages: ["Merge pull request #5 from acme/app"] }), [5]);
  assert.deepEqual(parseGitHubIssueNumbers({ title: "feat: add docker support" }), []);
});
