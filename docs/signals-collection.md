# Signals Collection

UseJunction Signals is the activity-collection layer for AI work observability. **Phase 1 (current ship)** centers on **local coding-tool work extraction** (Cursor, Claude, Codex). Classic app/domain journey collection and browser-extension domain enrichment are reserved for a later agent (and extension) update.

**EU hosted region:** work extraction and classic journey ingest are forced off. EU workspaces keep usage, cost, seats, and device health only. See [production-deployment.md](./production-deployment.md#eu-deployment).

Signals is intentionally collection-first. It does not try to be workflow automation, routing, or recommendation logic yet.

## What Is Collected

### Phase 1 — Work extraction (primary)

Structured metadata from local AI coding tools, when `workExtractionEnabled` is on:

- conversation titles / summaries when the tool provides them
- clipped user asks and change summaries (`userTurns`, `changeNarrative`) — allowlisted prose only
- models, agent modes, tool-call kinds
- file touches (basenames, ops) — not file contents

Forbidden on work ingest: raw prompts as free-form fields, full chat bodies, file contents, tool arguments, screenshots, clipboard, full URLs (see `forbiddenWorkExtractionFields`).

Work extraction does **not** require classic app/domain collection to be enabled.

### Phase 2 — App/domain journeys (reserved)

The classic session model remains available and privacy-minimal:

- foreground app
- inferred browser domain when available
- AI tool name
- session start/end time
- session duration
- app/domain before AI
- app/domain after AI
- a derived flow signature
- confidence score
- step list used to reconstruct the session

The implementation explicitly rejects raw content fields such as:

- screenshots
- page content
- prompts
- keystrokes
- clipboard text
- full URLs
- unrestricted window titles

That constraint is enforced at the ingest boundary, not just by convention.

## How It Works

The current implementation uses the existing enrolled desktop agent as the default collector.

Work path (Phase 1):

1. The admin enables **Work extraction** under Settings → Signals (independent of classic journeys).
2. Compatible agents (`>= WORK_EXTRACTION_MIN_AGENT_VERSION`) extract local tool sessions and upload to `/api/ingest/work-sessions`.
3. The admin UI surfaces work on Activity, Overview (when classic is off), and Team member pages.

Classic path (Phase 2 / optional early sampling):

1. The admin enables app/domain journeys (`SignalsPolicy.enabled`).
2. The agent fetches policy from `/api/devices/signals-policy`.
3. The local collector samples foreground app state on a short interval.
4. The sessionizer groups activity into AI-adjacent sessions.
5. The agent uploads batches to `/api/ingest/signals-sessions`.

The ingest path is separate from the existing `UsageDaily` accounting path. That is deliberate: Signals is about activity flow and coding-tool work, not model billing.

## Current Collector Behavior

The collector layer is abstracted in `agent/internal/signals/`.

Platform support today:

- macOS: prototype foreground-window collector with local AppleScript/system-state probing
- Windows: native coding-tool usage and work extraction; the experimental foreground collector is intentionally not started in this release
- other platforms: no-op collector with a clear unsupported signal

The sessionizer currently does the following:

- samples every 2 seconds
- closes a session when the foreground app changes or the user goes idle
- keeps a short amount of surrounding context
- derives an AI tool name from known domains and app/title hints
- assigns a flow signature like `crm_to_chatgpt_to_chat`
- suppresses excluded apps and domains
- de-duplicates uploads with a local idempotency key

The browser-domain part is best-effort in v1. The code is structured so a future browser extension can provide precise active-tab domains through native messaging (`BrowserContextProvider`) without changing the session model. Today the agent uses `NoopBrowserContextProvider`.

## Server Surfaces

The implementation exposes these endpoints:

- `GET /api/devices/signals-policy` - device policy fetch
- `POST /api/ingest/signals-sessions` - classic journey batch ingest
- `POST /api/ingest/work-sessions` - coding-tool work ingest
- `GET /api/signals/policy` - org policy read
- `PATCH /api/signals/policy` - org policy update
- `GET /api/signals/summary` - admin aggregate summary; accepts `days=1..366` or paired UTC `from`/`to` dates and returns the exact inclusive `windowDays` (the former `range` parameter is rejected)
- `GET /api/me/signals-ledger` - personal ledger: classic `sessions` plus `workSessions` (same LocalWorkSession rows managers see on the member work tab)

The database models are:

- `SignalsPolicy` (includes `enabled` for classic journeys and `workExtractionEnabled` for work)
- `SignalsSession`
- `SignalsActivityEvent`
- `LocalWorkSession`

`SignalsActivityEvent` is optional and exists mainly for debugging or future deep inspection; the session table is the canonical object for classic journeys. Work uses `LocalWorkSession`.

## Privacy And Trust

Signals is designed to be transparent:

- the admin can see the collection policy
- the employee can see the uploaded ledger (`/api/me/signals-ledger` and **My data**), including work sessions they own
- work allowlists clipped asks/summaries when work extraction is on; classic journeys stay at app/domain flow level
- richer work detail is optional and can be turned off; it is unavailable on the EU hosted region
- list payloads for managers strip `trace.userTurns`; owners still see their own asks on My data
- the ingest layer rejects forbidden raw-content fields

The intended privacy posture is:

- coding-tool work metadata (including allowlisted clipped prose) is acceptable when work extraction is on
- app/domain-level activity is acceptable for classic journeys
- raw screen capture is not part of v1
- full chat transcript capture is not part of v1
- raw clipboard capture is not part of v1

### Forward-only activation

Turning on work extraction creates a server-timestamped collection epoch. Each
device uses the later of that epoch and its enrollment time, so local work that
was only observed before the boundary is never imported. Devices that are
waiting for a compatible agent or a future heartbeat may upload work observed after the
boundary when they reconnect.

Disabling work extraction closes the epoch. Re-enabling creates a new boundary;
settings edits while extraction remains enabled preserve the existing boundary.
Sessions that began earlier but are updated after the boundary are treated as
current cumulative snapshots. Existing server-side records remain governed by
the configured retention policy.

## Product Intent

Phase 1 answers: “What did the team actually do with local AI coding tools?”

Phase 2 (later OTA) answers: “Where does AI sit in the broader workday?” (journeys + optional browser extension).

It is not yet trying to decide which model should run, how work should be routed, or how to infer business outcomes from downstream systems. Those are later layers, usually with workplace integrations.

## Relevant Files

- [agent/internal/signals/sessionizer.go](../agent/internal/signals/sessionizer.go)
- [agent/internal/signals/runner.go](../agent/internal/signals/runner.go)
- [agent/internal/workextract/](../agent/internal/workextract/)
- [apps/admin/app/api/ingest/signals-sessions/route.ts](../apps/admin/app/api/ingest/signals-sessions/route.ts)
- [apps/admin/app/api/ingest/work-sessions/route.ts](../apps/admin/app/api/ingest/work-sessions/route.ts)
