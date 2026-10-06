# Personal-data breach runbook

Engineering and on-call procedure. Counsel must confirm notice wording before first use.

## Roles

| Role | Who | Duty |
|------|-----|------|
| Incident lead | On-call engineer | Contain, timeline, evidence |
| Privacy lead | Founder / designated privacy contact | Classify controller vs processor, decide notices |
| Counsel | External privacy lawyer | 72h Art. 33 wording, customer notice as processor |

## Detect and contain (hour 0–4)

1. Rotate compromised secrets (`AUTH_SECRET`, `INGEST_SECRET`, `CRON_SECRET`, device tokens, Postgres, Ably, Resend, Lemon, PostHog).
2. Disable ingest or freeze the affected deployment if the agent path is involved.
3. Snapshot logs. Do not delete audit rows (`privacy.*` are retained even when other audit is pruned).
4. Identify region: US (`usejunction.dev`) vs EU (`eu.usejunction.dev`). Databases are not shared.

## Classify

- **UseJunction as controller:** account, billing, PostHog, our own employee/contractor data.
- **UseJunction as processor:** customer workspace telemetry. Customer is controller.

A single incident can be both (for example a production database dump).

## Notices

### As controller (Art. 33 / 34)

Notify the competent authority **within 72 hours** of becoming aware if the incident is likely to result in a risk to persons. Notify affected account holders without undue delay when the risk is high.

Template (internal):

> On [ISO time] we became aware of [short description]. Categories: [account emails / …]. Approximate number of records: [n]. Measures: [rotation, containment]. Contact: privacy@usejunction.dev.

### As processor (Art. 28)

Notify affected customers **without undue delay** (do not wait for the 72h controller clock). Include what happened, categories, likely consequences, and measures. Customers notify their own authorities and employees.

Template:

> We process employee telemetry for your workspace as processor. On [ISO time] [description]. Data region: [us/eu]. Categories affected: [usage / devices / …]. We have [containment]. We will follow up with a written report.

## After-action

- File the incident in the internal log (date, region, systems, notices sent).
- Open a vendor ticket if a subprocessor caused it.
- Update [vendor-dpas.md](./vendor-dpas.md) if a DPA/SCC gap appeared.
