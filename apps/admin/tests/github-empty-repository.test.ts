import assert from "node:assert/strict";
import { test } from "vitest";
import { isGitHubEmptyRepositoryError, sanitizeGitHubSyncError } from "@/lib/integrations/github-empty-repo";

const empty409 = 'provider request failed (409): {"message":"Git Repository is empty.","documentation_url":"https://docs.github.com/rest/commits/commits#list-commits","status":"409"}';

test("recognizes GitHub empty-repository 409 responses", () => {
  assert.equal(isGitHubEmptyRepositoryError(new Error(empty409)), true);
  assert.equal(isGitHubEmptyRepositoryError(`Dinuda/gist: ${empty409}`), true);
  assert.equal(
    isGitHubEmptyRepositoryError(`Dinuda/gist: ${empty409}; Dinuda/hive-core: ${empty409}`),
    true,
  );
  assert.equal(isGitHubEmptyRepositoryError(new Error("provider request failed (409): conflict")), false);
  assert.equal(
    isGitHubEmptyRepositoryError(`Dinuda/gist: ${empty409}; Dinuda/app: provider request failed (500): boom`),
    false,
  );
  assert.equal(sanitizeGitHubSyncError(`Dinuda/gist: ${empty409}`), null);
  assert.equal(sanitizeGitHubSyncError("GitHub timed out"), "GitHub timed out");
});
