# UseJunction

## Track every change

Follow `docs/testing.md` → "Track every change" for any task that ends in a PR:

- Open or pick a GitHub issue on the UseJunction project board before writing code, and name the branch `<issue>-short-slug`.
- Start the PR description with `Closes #<issue>`; the `Work item` check fails without it.
- Add a test that fails without the change. Numbers shown on more than one page also get a `cross-page` check in `apps/admin/scripts/lib/run-calculation-verification.ts`.
