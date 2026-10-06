# DPIA — desktop usage-collection agent

Data protection impact assessment for the UseJunction Go agent that enrolls a developer machine and uploads AI coding telemetry to the control plane.

This is an engineering pack for counsel and customers. It is not a signed Article 35 assessment.

## Processing

The agent scans tool-local storage (JSONL sessions, sqlite DBs, extension task JSON) and heartbeats usage, inventory, and device health to the customer's chosen control plane (`--url`). It does not intercept the network, capture the screen, or read the clipboard.

Optional **Signals work extraction** (US hosted region only) uploads structured asks, clipped change summaries, models, modes, tools, and file basenames. Raw prompts, full transcripts, and file contents stay on the device.

## Necessity and proportionality

- Collection is limited to AI coding tools the customer already deploys.
- Enrollment requires a web or CLI collection notice acknowledgment.
- Org admins set usage retention (90–730 days) and can disable Signals where it is available.
- EU hosted region disables Signals entirely so the residual content risk of clipped asks does not arise there.

## Risks

| Risk | Mitigation | Residual |
|------|------------|----------|
| Employee monitoring without notice | Collection notice gates token minting; customer employee-notice and works-council templates | Customer must still consult locally |
| Over-collection of prompts / source | Ingest rejects forbidden fields; Signals off in EU | Agent bugs could theoretically attempt upload and be rejected |
| Cross-border transfer of EU employee data | Separate EU deployment + EU Postgres; signup region picker | Customer must pick the EU host |
| Excessive retention | Daily `retention-enforce` cron deletes usage facts and rematerializes snapshots | Misconfigured retention days |
| Unauthorized admin access | RBAC (`privacy_manage` for DSAR); audit log | Compromised admin account |
| Subprocessor incident | DPA + breach runbook; named subprocessors | Vendor residual risk |

## Consultation

Customers that are EU employers should complete works-council / employee-representative consultation using [works-council-brief.md](./works-council-brief.md) before rolling the agent out.

## Decision

Ship hosted EU with Signals off, consent-gated PostHog, enforced retention, and DSAR. Revisit this DPIA before enabling work extraction in the EU region.
