import Image from "next/image";
import { cn } from "@/lib/utils";

type Mark = "yes" | "partly" | "no" | "unknown";
type Cell = { mark: Mark; text?: string };

const MARK_LABEL: Record<Mark, string> = {
  yes: "Yes",
  partly: "Partly",
  no: "Not in their docs",
  unknown: "Not confirmed",
};

const VENDORS = [
  { name: "Claude", logo: "claude.svg" },
  { name: "Cursor", logo: "cursor.svg" },
  { name: "GitHub Copilot", logo: "copilot.svg" },
  { name: "Codex", logo: "chatgpt.svg" },
] as const;

/**
 * What each vendor's own admin shows per person, from their public team and enterprise docs
 * (November 2026). Sources: .claude/research/research_notes/Homepage value beyond cost savings/
 * vendor_admin_capabilities.md. OpenAI's help pages were unreachable, hence "unknown" for Codex.
 */
const ROWS: { feature: string; vendors: [Cell, Cell, Cell, Cell]; ours: Cell }[] = [
  {
    feature: "Spend per person",
    vendors: [{ mark: "partly", text: "CSV report" }, { mark: "partly", text: "This cycle" }, { mark: "partly", text: "Estimate" }, { mark: "unknown" }],
    ours: { mark: "yes", text: "Per tool" },
  },
  {
    feature: "Weekly and 5-hour limit use",
    vendors: [{ mark: "no" }, { mark: "partly", text: "Spend limit" }, { mark: "partly", text: "Budgets" }, { mark: "no" }],
    ours: { mark: "yes", text: "Over time" },
  },
  {
    feature: "Seats nobody uses",
    vendors: [{ mark: "partly", text: "Team total" }, { mark: "yes", text: "By API" }, { mark: "yes" }, { mark: "unknown" }],
    ours: { mark: "yes" },
  },
  {
    feature: "Spend by pull request and issue",
    vendors: [{ mark: "no" }, { mark: "no" }, { mark: "no" }, { mark: "no" }],
    ours: { mark: "yes", text: "Partly estimated" },
  },
  {
    feature: "Personal accounts on work machines",
    vendors: [{ mark: "no" }, { mark: "no" }, { mark: "no" }, { mark: "no" }],
    ours: { mark: "yes" },
  },
  {
    feature: "The other tools on the same page",
    vendors: [{ mark: "no" }, { mark: "no" }, { mark: "no" }, { mark: "no" }],
    ours: { mark: "yes" },
  },
];

function Dot({ mark }: { mark: Mark }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[18px] shrink-0 rounded-full",
        mark === "yes" && "bg-primary",
        mark === "partly" && "bg-[linear-gradient(90deg,#e59a18_50%,transparent_50%)] shadow-[inset_0_0_0_2px_#e59a18]",
        mark === "no" && "shadow-[inset_0_0_0_2px_#c9cbc3]",
        mark === "unknown" && "border-2 border-dashed !border-[#8a8c85]",
      )}
    />
  );
}

function MarkCell({ cell }: { cell: Cell }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Dot mark={cell.mark} />
      <span className="sr-only">{MARK_LABEL[cell.mark]}</span>
      {cell.text ? <span>{cell.text}</span> : null}
    </span>
  );
}

export function HomeVendorCompare() {
  return (
    <section aria-labelledby="home-compare-heading" className="bg-white pt-24 sm:pt-32 lg:pt-[9.5rem]">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <h2 id="home-compare-heading" className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.95rem]">
            What each tool’s own admin shows per person.
          </h2>
          <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-hidden>
            {(["yes", "partly", "no", "unknown"] as const).map((mark) => (
              <span key={mark} className="inline-flex items-center gap-2">
                <Dot mark={mark} />
                {MARK_LABEL[mark]}
              </span>
            ))}
          </p>
        </div>

        <div className="relative -mr-4 mt-8 overflow-x-auto sm:-mr-6 lg:mr-0 lg:mt-11 lg:overflow-visible">
          <table className="w-full min-w-[760px] border-collapse border-t-2 !border-foreground text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-4 pr-4">
                  <span className="sr-only">What you want to see</span>
                </th>
                {VENDORS.map((vendor) => (
                  <th key={vendor.name} scope="col" className="py-4 pr-4 align-bottom font-semibold">
                    <span className="flex flex-col gap-2 text-[0.9rem] text-foreground">
                      <Image src={`/tool-logos/${vendor.logo}`} alt="" width={22} height={22} aria-hidden />
                      {vendor.name}
                    </span>
                  </th>
                ))}
                <th scope="col" className="w-[236px] bg-primary p-2.5 align-middle">
                  <span className="flex h-[58px] items-center bg-white px-3.5">
                    <Image src="/usejunction.png" alt="UseJunction" width={124} height={30} className="h-[30px] w-auto" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.feature} className="border-b border-border">
                  <th scope="row" className="w-[290px] py-[17px] pr-4 font-semibold">
                    {row.feature}
                  </th>
                  {row.vendors.map((cell, index) => (
                    <td key={index} className="py-[17px] pr-4 text-[#3a3b37]">
                      <MarkCell cell={cell} />
                    </td>
                  ))}
                  <td className="bg-[#e6f3f5] py-[17px] pl-5 pr-4">
                    <MarkCell cell={row.ours} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 max-w-3xl text-[0.8125rem] leading-6 text-muted-foreground">
          From each vendor’s public admin docs for team and enterprise plans, read in November 2026. An empty circle
          means we didn’t find it there. Docs change, so tell us if a cell is out of date.
        </p>
      </div>
    </section>
  );
}
