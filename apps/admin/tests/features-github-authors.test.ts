import assert from "node:assert/strict";
import { test } from "vitest";
import {
  githubAuthorScopeFromConnection,
  githubMemberLoginsFromConfig,
  githubUserIdFromMetadata,
  isInAnyGitHubAuthorScope,
  isInScopeGitHubLogin,
  matchDeveloperForGitHubAuthor,
  nextGitHubAuthorResolution,
  uniqueDeveloperLoginMap,
  reposOwnedByInstallation,
  soleDeveloperMatch,
} from "@/lib/features/github-authors";

test("org member list drops outside contributors and unfetched orgs", () => {
  const members = githubAuthorScopeFromConnection({
    accountType: "Organization",
    memberLogins: ["dinuda", "Ada"],
    developers: [{ email: "ada@acme.com" }],
  });
  assert.equal(isInScopeGitHubLogin("dinuda", members), true);
  assert.equal(isInScopeGitHubLogin("ghost", members), false);

  const unfetched = githubAuthorScopeFromConnection({
    accountType: "Organization",
    memberLogins: null,
    developers: [{ email: "ada@acme.com" }],
  });
  assert.equal(isInScopeGitHubLogin("dinuda", unfetched), false);
});

test("union of org and personal scopes keeps either match", () => {
  const org = githubAuthorScopeFromConnection({
    accountType: "Organization",
    memberLogins: ["ada"],
    developers: [{ email: "ada@acme.com" }, { email: "dinuda@usejunction.dev" }],
  });
  const personal = githubAuthorScopeFromConnection({
    accountType: "User",
    memberLogins: null,
    developers: [{ email: "ada@acme.com" }, { email: "dinuda@usejunction.dev" }],
  });
  assert.equal(isInAnyGitHubAuthorScope("ada", [org, personal]), true);
  assert.equal(isInAnyGitHubAuthorScope("dinuda", [org, personal]), true);
  assert.equal(isInAnyGitHubAuthorScope("ghost", [org, personal]), false);
});

test("personal installs only keep workspace developer logins", () => {
  const scope = githubAuthorScopeFromConnection({
    accountType: "User",
    memberLogins: null,
    developers: [{ email: "dinuda@usejunction.dev" }, { email: "ada@acme.com" }],
  });
  assert.equal(isInScopeGitHubLogin("dinuda", scope), true);
  assert.equal(isInScopeGitHubLogin("ghost", scope), false);
});

test("auto-maps unique GitHub login to developer email local-part", () => {
  const developers = [
    { id: "dev-1", email: "dinuda@usejunction.dev" },
    { id: "dev-2", email: "ada@acme.com" },
  ];
  const byUniqueLogin = uniqueDeveloperLoginMap(developers);
  assert.equal(byUniqueLogin.get("dinuda"), "dev-1");
  const matched = matchDeveloperForGitHubAuthor({
    login: "dinuda",
    email: "418+dinuda@users.noreply.github.com",
    byEmail: new Map(developers.map((developer) => [developer.email, developer.id])),
    byUniqueLogin,
  });
  assert.equal(matched.developerId, "dev-1");
  assert.equal(matched.matchedBy, "login");
});

test("email match beats login local-part", () => {
  const developers = [
    { id: "dev-1", email: "dinuda@usejunction.dev" },
    { id: "dev-2", email: "ada@acme.com" },
  ];
  const matched = matchDeveloperForGitHubAuthor({
    login: "dinuda",
    email: "ada@acme.com",
    byEmail: new Map(developers.map((developer) => [developer.email, developer.id])),
    byUniqueLogin: uniqueDeveloperLoginMap(developers),
  });
  assert.equal(matched.developerId, "dev-2");
  assert.equal(matched.matchedBy, "email");
});

test("auth GitHub user id beats login local-part", () => {
  const developers = [
    { id: "dev-1", email: "dinuda@usejunction.dev" },
    { id: "dev-auth", email: "owner@company.com" },
  ];
  const matched = matchDeveloperForGitHubAuthor({
    login: "dinuda",
    email: "418+dinuda@users.noreply.github.com",
    githubUserId: 4242,
    byGithubUserId: new Map([["4242", "dev-auth"]]),
    byEmail: new Map(developers.map((developer) => [developer.email, developer.id])),
    byUniqueLogin: uniqueDeveloperLoginMap(developers),
  });
  assert.equal(matched.developerId, "dev-auth");
  assert.equal(matched.matchedBy, "auth");
});

test("githubUserIdFromMetadata reads numeric ids", () => {
  assert.equal(githubUserIdFromMetadata({ githubUserId: 4242 }), "4242");
  assert.equal(githubUserIdFromMetadata({ githubUserId: "4242" }), "4242");
  assert.equal(githubUserIdFromMetadata({}), null);
});

test("manual identity matches stay sticky even when auth would remap", () => {
  const ranked = nextGitHubAuthorResolution({
    existingMatchedBy: "manual",
    existingDeveloperId: "dev-manual",
    inScope: true,
    matched: { developerId: "dev-auth", matchedBy: "auth" },
  });
  assert.equal(ranked.developerId, "dev-manual");
  assert.equal(ranked.matchedBy, "manual");
  assert.equal(ranked.persist, false);
});

test("non-members never resolve unless the mapping is manual", () => {
  const auto = nextGitHubAuthorResolution({
    existingMatchedBy: "login",
    existingDeveloperId: "dev-1",
    inScope: false,
    matched: { developerId: "dev-1", matchedBy: "login" },
  });
  assert.equal(auto.developerId, null);
  assert.equal(auto.matchedBy, null);
  assert.equal(auto.persist, false);

  const manual = nextGitHubAuthorResolution({
    existingMatchedBy: "manual",
    existingDeveloperId: "dev-contractor",
    inScope: false,
    matched: { developerId: "dev-1", matchedBy: "login" },
  });
  assert.equal(manual.developerId, "dev-contractor");
  assert.equal(manual.matchedBy, "manual");
});

test("ambiguous local-parts are not auto-mapped", () => {
  const byUniqueLogin = uniqueDeveloperLoginMap([
    { id: "dev-1", email: "ada@acme.com" },
    { id: "dev-2", email: "ada@other.com" },
  ]);
  assert.equal(byUniqueLogin.has("ada"), false);
});

test("githubMemberLoginsFromConfig distinguishes missing from empty", () => {
  assert.equal(githubMemberLoginsFromConfig({}), null);
  assert.deepEqual(githubMemberLoginsFromConfig({ githubMemberLogins: "" }), []);
  assert.deepEqual(githubMemberLoginsFromConfig({ githubMemberLogins: "Ada, ghost" }), ["ada", "ghost"]);
  assert.deepEqual(githubMemberLoginsFromConfig({ githubMemberLogins: ["Dinuda"] }), ["dinuda"]);
});

test("organization installs keep only that org's repositories", () => {
  const repos = [
    { owner: { login: "Dinuda" }, name: "moreperstay" },
    { owner: { login: "use-junction" }, name: "usejunction" },
    { owner: { login: "8090-inc" }, name: "mib-doc-challenge" },
  ];
  assert.deepEqual(
    reposOwnedByInstallation(repos, "use-junction", "Organization").map((repo) => repo.name),
    ["usejunction"],
  );
  assert.equal(reposOwnedByInstallation(repos, "dinuda", "User").length, 3);
});

test("sole org member maps to the sole workspace developer", () => {
  const scope = githubAuthorScopeFromConnection({
    accountType: "Organization",
    memberLogins: ["dinuda"],
    developers: [{ email: "y.dinuda@gmail.com" }],
  });
  const matched = soleDeveloperMatch([{ id: "dev-1" }], scope, "dinuda");
  assert.equal(matched.developerId, "dev-1");
  assert.equal(matched.matchedBy, "login");
  assert.equal(soleDeveloperMatch([{ id: "dev-1" }, { id: "dev-2" }], scope, "dinuda").developerId, null);
});
