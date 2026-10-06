# Work & spend usability review

Status: **not performed with real users**. Agent role reviews informed the design hypotheses below; they are not interviews, participant feedback, or evidence of usability success.

## Participants and setup

Recruit three actual participants: an engineering lead, a budget owner or founder, and a developer who recognizes PRs/issues. One person per role is a formative review, not statistically representative research. Get their consent before recording; collect observations without repository contents or personal identifiers in this document.

Use an isolated test environment with synthetic, clearly labeled test data. `apps/admin/tests/fixtures/work-spend.ts` contains component/API-response fixtures only; do not load these into production or seed a customer database. Cover one repository, multiple repositories including an inactive repository, ticketless work, an issue in multiple Projects, and partial sync/unmatched authors. Repeat essential tasks at desktop width and 390 px mobile width.

Tell participants: “This page connects work activity to allocated AI usage. Explore it as you normally would. Please say what you expect and what you think the numbers mean.” Avoid explaining controls or coaching until the task ends. Record completion, time, wrong turns, unexpected interpretations, and direct quotes only when actually observed.

## Tasks and acceptance

| Role | Prompt | Success criterion |
| --- | --- | --- |
| Manager | “Which work item has the most allocated AI cost? Open it and find the work behind it.” | Finds a real PR/issue/commit title in the ranked chart and opens its details without first opening a repository. |
| Budget owner | “Which repository has the most allocated AI cost, and what makes up that amount?” | Uses repository comparison; identifies the largest repository and distinguishes verified and estimated portions without treating them as extra spend on top of the total. |
| Budget owner | “How much usage is linked to work, and how much is not yet linked?” | Correctly explains total, linked amount/percentage, and unlinked amount; does not add overlapping summary numbers together or infer productivity/ROI. |
| Budget owner | “Which connected Projects contain the costliest work? Can I add those Project amounts?” | Switches to Projects, drills into one Project's work, and notices when the same work makes Project amounts overlap. |
| All | “Find the highest-cost work, then explain why a cost is attached to it.” | Uses Highest allocated cost and inspects the verified/estimated breakdown and evidence without interpreting allocated cost as a direct bill. |
| Developer | “Find the invitations work and explain why a cost is attached to it.” | Finds the work by title/search, inspects underlying commits and allocation evidence, and understands that allocated cost is a model of usage rather than direct proof of productivity or delivery. |
| Developer | “Show only Product roadmap work. What changed in the cost overview?” | Applies a Project filter, sees the matching issue once even when it belongs to two Projects, and recognizes that the scope of the cost overview is still workspace and selected period. |
| Developer | “This work has no ticket key. Can you still inspect it?” | Opens PR/commit details without interpreting ticketless work as broken or requiring a ticket to view it. |
| Budget owner | “Some data needs attention. Find the problem and the next useful action.” | Distinguishes failed sync from unmatched authors and missing access; reaches the relevant action without opening unrelated dialogs. |
| Budget owner | “Review GitHub and Project connections, then cancel.” | Opens connection management, understands permissions and disconnect consequences, and leaves all connections and selections unchanged. |
| All | “Find the same work on this narrow screen.” | At 390 px, can read the title/status/cost, operate filters, open/close details, and use keyboard focus without horizontal page overflow. |

Success target: each participant completes their role’s tasks without facilitator help; no participant interprets activity as a productivity score, treats Project-filtered work as Project spend, or double-counts verified/estimated/attributed totals. A single repeated comprehension failure or blocked essential task requires a design revision and another review. Record failures as failures; do not replace missing observations with agent guesses.

## Observation record

| Session | Role | Viewport | Tasks completed unaided | Observed misunderstanding or blockage | Changes and retest |
| --- | --- | --- | --- | --- | --- |
| Not run | Engineering manager | Pending | Not assessed | No participant feedback collected | Pending |
| Not run | Individual developer | Pending | Not assessed | No participant feedback collected | Pending |
| Not run | Budget owner / founder | Pending | Not assessed | No participant feedback collected | Pending |

Before recording any conclusion, replace the corresponding pending row with an actual session date, anonymized participant identifier, observations, and task outcomes. Component tests and synthetic walkthroughs validate UI behavior; they do not substitute for this user review.

## Engineering validation — 2026-09-25

- The full Vitest suite passed before this chart revision (879 passed; 65 optional tests skipped). Focused component, route, and page tests passed after the revision. The 9 opt-in Work & spend PostgreSQL tests also passed using connection-local temporary tables, with every transaction rolled back.
- PostgreSQL checks cover workspace isolation, removed grants, repository-aware ticket groups, PR-title keys, mixed ticketed/unticketed PRs, exact issue keys, closing references, multiple Project memberships, combined filters, both sort cursors, and independent commit/evidence pagination.
- Four Playwright checks passed against test-only API responses: a ranked cost chart at 1440×900 and 390×844 with its first item fully visible; no horizontal overflow; keyboard sheet entry, Escape and focus return; Project and repository drill-down with stable workspace figures; access to detailed search; and cancelling GitHub disconnect without a mutation.
- Client/server import boundaries and snapshot read checks passed. TypeScript checking remains blocked by three existing errors outside this work: `app/api/ingest/work-sessions/route.ts:544` and `lib/privacy/account-collection.ts:489,532`.
- Screenshots are generated by `e2e/work-spend.spec.ts` in `apps/admin/test-results/work-spend-{1440,390}.png`. They depict synthetic test data, not a customer workspace's actual work.

Re-run the SQL checks explicitly with `RUN_WORK_SPEND_DB_TESTS=1` and the local database environment. Browser tests use the existing test-account session and API-response fixtures; no repository or Project fixtures are inserted into persistent storage. These engineering checks do not complete the participant study above. Conduct that study before rollout.
