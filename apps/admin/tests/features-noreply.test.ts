import assert from "node:assert/strict";
import { test } from "vitest";
import { parseNoreply } from "@/lib/features/ticket-keys";

test("noreply parser is the identity fallback for GitHub private emails", () => {
  const parsed = parseNoreply("9911+linus@users.noreply.github.com");
  assert.equal(parsed?.login, "linus");
  assert.equal(parsed?.githubId, 9911);
});
