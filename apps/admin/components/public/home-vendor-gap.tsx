import Link from "next/link";
import { Check } from "lucide-react";
import { HOME_H2, HOME_SECTION, Muted } from "@/components/public/home-bits";
import { cn } from "@/lib/utils";

/** Same rows as the table in /blog/check-claude-team-usage; keep the two in step. */
const ROWS = [
  ["Tokens and spend per person", "Spend report CSV, only with extra usage on", "Yes, CSV and API", "Estimated, per tool and model"],
  ["Seat type per person", "Members list", "Members list", "Next to limit usage"],
  ["5-hour and weekly limit usage", null, null, "Yes, over time"],
  ["API or raw data access", null, "Yes", "Yes, your own database if self-hosted"],
  ["Personal accounts outside the org", null, null, "Yes"],
] as const;

function Cell({ value }: { value: string | null }) {
  return value === null ? <span className="text-[#a3a59d]">No</span> : <>{value}</>;
}

export function HomeVendorGap() {
  return (
    <section aria-labelledby="home-gap-heading" className={HOME_SECTION}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end lg:gap-20">
          <h2 id="home-gap-heading" className={cn(HOME_H2, "lg:text-[2.85rem] lg:leading-[1.06]")}>
            Every vendor shows its own slice. <Muted>Nobody shows the whole team.</Muted>
          </h2>
          <p className="max-w-md text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Claude, Cursor and Copilot each have an admin page for their own seats. To see who uses what across all of
            them, you end up in exports and spreadsheets.
          </p>
        </div>

        <figure className="mt-12 border border-border lg:mt-16">
          <figcaption className="flex flex-col gap-1 border-b border-border px-4 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:px-7 sm:py-5">
            <span className="text-base font-semibold">Take Claude. What can you see about each person?</span>
            <span className="text-sm text-muted-foreground">From our Claude Team guide</span>
          </figcaption>
          <table className="w-full border-collapse text-left text-[0.8125rem] leading-snug sm:text-sm">
            <thead>
              <tr className="bg-[var(--public-bg)] text-muted-foreground">
                <th scope="col" className="px-3 py-3.5 sm:px-7 sm:py-4">
                  <span className="sr-only">What you want to see</span>
                </th>
                <th scope="col" className="px-3 py-3.5 font-semibold sm:px-7 sm:py-4">Claude Team admin</th>
                <th scope="col" className="hidden px-7 py-4 font-semibold md:table-cell">Claude Enterprise admin</th>
                <th scope="col" className="bg-[#f3fafb] px-3 py-3.5 font-semibold text-primary-dark sm:px-7 sm:py-4">UseJunction</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([feature, team, enterprise, ours]) => (
                <tr key={feature} className="border-t border-border align-top">
                  <th scope="row" className="px-3 py-4 font-semibold sm:w-[30%] sm:px-7 sm:py-[18px]">{feature}</th>
                  <td className="px-3 py-4 text-[#5c5e56] sm:px-7 sm:py-[18px]"><Cell value={team} /></td>
                  <td className="hidden px-7 py-[18px] text-[#5c5e56] md:table-cell"><Cell value={enterprise} /></td>
                  <td className="bg-[#f3fafb] px-3 py-4 text-foreground sm:w-[28%] sm:px-7 sm:py-[18px]">
                    <span className="inline-flex items-start gap-2">
                      <Check className="mt-0.5 size-[15px] shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
                      {ours}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border bg-[var(--public-bg)] px-4 py-4 sm:px-7">
            <Link
              href="/blog/check-claude-team-usage"
              className="border-b border-current pb-px text-sm font-semibold transition-colors hover:text-primary"
            >
              Read the guide: how to check your team’s usage in Claude
            </Link>
          </div>
        </figure>
      </div>
    </section>
  );
}
