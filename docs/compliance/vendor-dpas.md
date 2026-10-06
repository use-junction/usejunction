# Vendor DPA / transfer checklist

Track whether each subprocessor has a signed DPA (or equivalent), SCC/DPF coverage, and an EU-region option. Signing is out of scope for engineering; this is the punch list.

| Vendor | Purpose | Typical location | Transfer mechanism to verify | DPA signed? | Notes |
|--------|---------|------------------|------------------------------|-------------|-------|
| Vercel | App hosting / functions | US (`iad1`) or EU (`fra1`) | DPF and/or SCCs; pin function region to DB region | [ ] | Separate `admin` and `admin-eu` projects |
| Postgres host | Primary database | Match deployment | DPF/SCCs if vendor is US; EU project must use EU Postgres | [ ] | Never share `DATABASE_URL` across regions |
| Lemon Squeezy | Team billing | Check vendor | DPF/SCCs | [ ] | Customer/billing data |
| Resend | Auth and invite email | Prefer EU if offered | DPF/SCCs | [ ] | |
| Ably | Fleet sync push | Prefer EU if offered | DPF/SCCs | [ ] | |
| PostHog | Product analytics after cookie consent | `us.i.posthog.com` or `eu.i.posthog.com` | EU host **required** when `DEPLOYMENT_REGION=eu` | [ ] | Loads only after `uj_consent` |
| GitHub / Google / Microsoft | OAuth sign-in | Vendor regions | DPF/SCCs | [ ] | |
| GitHub App | Optional repo integration | US | DPF/SCCs | [ ] | |
| GitHub Releases | Agent binary OTA | US | Public binaries; no customer telemetry | [ ] | |

Public list for customers: `/subprocessors` (region-aware). DPA terms: `/dpa`.

Appointing an EU representative (Art. 27) and completing DPF self-certification checks are human/legal steps.
