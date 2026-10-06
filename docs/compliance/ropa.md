# Records of processing (ROPA)

Internal working record for UseJunction hosted processing. Counsel must review before treating this as an Article 30 record.

Generated from the GDPR foundations shipped in 2026-09: region flag, retention clocks, DSAR, and EU Signals gate.

## Roles

| Activity | UseJunction role | Customer role |
|----------|------------------|---------------|
| Hosted employee telemetry (usage, cost, seats, device health, optional Signals) | Processor | Controller |
| Account, billing, and product analytics (PostHog after consent) | Controller | — |
| Self-hosted deployments | Not a processor; customer runs the stack | Controller of all processing |

## Processing activities

### 1. Workspace telemetry (processor)

- **Purpose:** Show the customer AI coding usage, cost, plan/seat utilization, and device coverage.
- **Subjects:** Customer employees / contractors who enroll a device or are invited.
- **Categories:** Name, work email, role, device hostname/OS/architecture/agent version, IP used for rate limiting, tool/model usage facts, quotas, seat assignments, optional structured work sessions (non-EU only).
- **Never collected:** Keystrokes, screenshots, clipboard, raw prompts, full chat transcripts, file contents, unrestricted window titles, full URLs.
- **Lawful basis (customer):** Typically legitimate interests or employment necessity. UseJunction does not rely on employee consent for telemetry.
- **Recipients:** Customer admins/managers in the workspace; subprocessors listed in [vendor-dpas.md](./vendor-dpas.md) and `/subprocessors`.
- **Location:** US deployment (`usejunction.dev`) or EU deployment (`eu.usejunction.dev`). No cross-region mixing.
- **Retention:** Usage facts default 365 days (org-configurable 90 / 180 / 365 / 730). Device activity 30 days. Signals/work sessions follow org Signals retention (default 90 days). Audit logs 2 years except `privacy.*`. Rate-limit buckets and provider source records follow their TTL fields.
- **System table:** `users` (developers), `auth_users`, `devices`, `usage_daily`, `quota_observations`, `request_metadata`, `local_work_sessions`, `signals_sessions`, `device_activity_events`, `seat_assignments`, `external_identities`, `audit_logs`, `privacy_requests`.

### 2. Account and hosted product (controller)

- **Purpose:** Authenticate users, bill Team plans, send transactional email, improve the product.
- **Subjects:** Account holders (often the same people as developers).
- **Categories:** Name, email, password hash or OAuth identity, terms/privacy version, timezone, notification prefs, Lemon Squeezy customer ids, optional PostHog events after cookie consent.
- **Lawful basis:** Contract (account), legitimate interests (security, product analytics after ePrivacy consent), legal obligation (invoices).
- **Retention:** Account until erasure or inactivity after memberships end. Analytics consent cookie 12 months.

### 3. Security and abuse prevention (controller / processor)

- **Purpose:** Rate limiting, audit, breach detection.
- **Categories:** IP, user/device identifiers, audit actions.
- **Retention:** Rate-limit window; audit 2 years.

## EU-specific restrictions

On `DEPLOYMENT_REGION=eu`, Signals work extraction and classic journey ingest are forced off. Hosted EU workspaces store usage/cost/seat/device health only.

## DSAR

Developers export or request erasure from **My data**. Owners/admins export or erase any member. Removal from the team schedules erasure after 30 days unless cancelled. Exports are JSON plus a usage CSV string.
