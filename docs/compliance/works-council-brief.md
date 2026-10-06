# Works-council / employee-representative brief

Short brief customers can give a works council, CHSCT-equivalent, or employee representative before deploying the UseJunction agent. Local employment law still governs. This is not legal advice.

## What the tool does

A desktop agent on the developer machine reads AI-tool local storage (not the screen, not the network) and sends usage and device-health facts to a hosted control plane chosen by the employer (United States or European Union). Managers see spend, plan pace, idle seats, and coverage. It is not keystroke logging, email monitoring, or always-on screenshots.

## What it does not do

No keystrokes, no webcam, no clipboard, no full prompts or source files, no browsing history. Classic app/domain “Signals journeys” and the browser extension are off in this release. **On the EU hosted region, work-extraction Signals is forced off** so only usage / cost / seats / device health are stored.

## Employment-law points to flag

- Employer is **controller** of employee telemetry; UseJunction is **processor** on hosted plans.
- Lawful basis is typically the employment relationship or legitimate interests, **not** employee consent. The in-product collection notice is transparency, not consent for monitoring.
- Data is stored in the region picked at signup. Invite links already point at that host.
- Retention is configurable (90–730 days for usage). Erasure runs 30 days after someone leaves unless an admin cancels.
- Developers can inspect **My data**, export, and request erasure.
- Subprocessors (hosting, email, payments, optional analytics) are listed at `/subprocessors`.

## Suggested consultation questions

1. Is EU hosting required for this workforce?
2. Will Signals work extraction stay off (required on EU hosted; optional on US)?
3. Who inside the company may open team views (owners/admins/managers)?
4. What retention period matches existing IT monitoring policies?
5. How will new hires receive the employee notice before first enroll?
