# Work & spend: UX and data plan

## Decision

Rename the sidebar entry and page **Work & spend**. Use `/work-spend` and redirect `/features` so existing links keep working. The name describes both the code activity and the AI cost evidence. A ticket key is one way to group work; it is not a prerequisite for this section to be useful.

The first screen must answer, in order:

1. What work is visible from GitHub, across which repositories?
2. How much eligible AI usage is associated with that work, and how much remains unattributed?
3. Which changes and contributors explain the numbers?
4. What needs attention: missing access, a failed sync, an unmatched author, or a missing ticket link?

## Page structure

Use the app's existing typography, neutral background, fine dividers, and restrained yellow accent. Remove the two oversized spend cards, decorative grids, duplicate metric bars, and empty padded panels. Keep the outer content gutter, but use compact rows and section spacing so the repository breakdown starts in the first viewport.

```text
Work & spend                         [30/90 days] [All repositories] [Sync]
GitHub · last successful sync · 4 accessible repositories     [Manage connection]

Eligible AI usage   Attributed to work   Unattributed   Verified / Estimated
$…                  $… · …%              $…             $… / $…
────────────────────────────────────────────────────────────────────────────
Change mix  [interactive proportional bar + legend]   based on N synced changes

Repositories (4)                         [Search] [Sort: spend / activity]
Repository        Work       People   Latest    Verified   Estimated   Status
api               12 PRs…   4        Sep 24    $…         $…          Current
web               7 PRs…    3        Sep 23    $…         $…          Current
docs              No recent work…                                  Current
mobile            Sync incomplete…                                  Retry

Selecting a repository: PRs or ticketed work with real titles/status and
linked costs → commits and attribution evidence on demand.
```

The summary is a border-separated strip, not a collection of cards. “Eligible AI usage” means developer-level usage that this allocation system can process; org-level API-key usage is excluded and must be explained in the calculation disclosure. “Attributed” means matched to commits, not covered by tickets. Verified and estimated remain separate, and unattributed is a subset of their combined total.

Show **Change mix** as a compact, clickable breakdown across the selected repository/date scope. Categories come only from explicit commit prefixes; label the remainder “No recognized prefix” instead of implying semantic classification. Selecting a segment filters the work below and updates the displayed count. Keep its denominator visible.

Make the repository list the primary surface. Show all *currently granted* repositories, including those with zero recent work, no matched authors, or a failed sync. Never manufacture extra repositories to make the screen look populated. In a one-repository workspace, show that one honest row and open a useful work detail view; show “Manage GitHub access” with the actual connected count. A repository row can expand to grouped PRs and ticket keys, then individual commits. Prefer PR title and state where present; otherwise show a truthful commit headline. Do not invent feature names, project status, or AI-generated summaries.

Keep the date range and repository scope at the top. Search, type, and sort controls belong with the repository list. On mobile, put name/status and one primary number in each compact row, with verified/estimated and activity beneath; filter controls wrap without horizontal scrolling. The drilldown becomes a full-width sheet or in-flow section rather than a wide table.

## Interaction and state design

The connected state has one quiet GitHub metadata line and a manage dialog. Sync reports progress, completion, partial success, and errors in an inline status area plus a toast; it must not announce full success when some repositories fail. Disconnect opens a confirmation explaining which imported records are removed and that it does not uninstall the GitHub App. Preserve role-based access to connection controls.

Design the following distinct states: no GitHub connection; permissions missing; first sync pending; partial repository failure; no repositories granted; repository granted with no work in the window; unmatched authors; work with no eligible usage; work without ticket keys; zero eligible spend; and project tool unavailable. Use a compact contextual action row for author matching only when someone needs attention. Empty ticket coverage should not take over the screen.

The project-tool action must have an honest outcome. Current code has no Linear or Jira OAuth/issue import. Keep the ticket-key workflow visible while the real connection is built. A working connection should ultimately show provider, permission scope, sync status, disconnect, and issue title/status on linked work; it must not show a fake connected state.

## Data work required before repository spend is presented as reliable

1. **Current repository roster.** GitHub sync already reads installation repositories, but `Repository` has no connection membership or current-access marker. Persist/reconcile the installation's granted repository IDs and a per-repository sync result. Do not infer current access from old `Repository` rows.
2. **One page contract.** Return `coverage` with explicit eligible, attributed, unattributed, verified, and estimated micros; `repositories[]` with access/sync state, PR and commit counts, contributors, latest activity, change mix, and separate verified/estimated allocation; plus paginated work details. Scope every total to the selected date and repository filter, or label a number as workspace-wide.
3. **Cross-repository correctness.** Allocation currently groups equal ticket keys across repositories before retaining one repository ID, and the page groups tickets globally. Keep allocation units keyed by repository ID plus ticket key; allow a later cross-repo ticket rollup without assigning all spend to one repo. Key unlinked commit cost by repository ID plus SHA, not SHA alone.
4. **Work identity.** The database already stores PR title, URL, state, dates, author, ticket keys, and commits, but the page does not query PRs. Link repository detail to real PRs first. A ticket in a PR title or branch is stored but does not currently cause commit-message allocation; either implement that linkage with provenance or label it as context only.
5. **Scale and diagnostics.** Avoid loading every commit into the page model. Return aggregates plus cursor-paginated details. Expose partial failures per repository and the last successful sync so omissions are visible.

The existing “111 synced changes across 1 repository” screenshot is a count of matched-author, ticketless commits. It is **not** a count of all synced changes or all repositories granted to the GitHub installation. We need the installation roster before claiming how many repositories this workspace has.

## Delivery sequence and acceptance

1. Rename the navigation/page, replace the hero cards with the compact summary, and ship the all-repository roster with access, sync state, and activity counts. Keep existing connection, sync, and disconnect behavior. The page must be useful with one repository or no ticket keys. Do not show per-repository spend until the allocation fixes are ready.
2. Add PR-first repository detail, interactive change mix, scoped filters, and paginated commits. Resolve repository/ticket allocation and composite commit identity before displaying per-repository spend.
3. Add a real project-tool connector, starting with one chosen provider, then connect issue title/status to ticketed work. Until then, label the current project-tool action as unavailable and keep ticket-key guidance.

Review with fixtures for zero, one, and at least three repositories; zero-work and removed-access repositories; same ticket key in two repositories; unmatched authors; partial sync; PR-title-only ticket; date/repository filters; and verified/estimated conservation. Check desktop and 390 px mobile layouts with no horizontal overflow. Opening a connection or disconnect dialog must never mutate data; only the explicit confirmation can disconnect.
