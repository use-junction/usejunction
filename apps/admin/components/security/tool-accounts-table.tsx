import Link from "next/link";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import type { ToolAccountRow } from "@/lib/app-pages/tool-accounts";
import { formatRelativeTime } from "@/lib/format";
import { toolDisplayName } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";

export const OWNERSHIP_LABEL: Record<ToolAccountRow["ownership"], string> = {
  company: "Company",
  personal: "Personal",
  unknown: "Unknown",
};

function finding(row: ToolAccountRow) {
  if (row.ownership !== "personal") return null;
  return row.companySeat
    ? "Company also pays for a seat. Move this person to the company login, or cancel the seat."
    : "Work runs on a plan the company doesn't control or see on its invoice.";
}

/** The logins table; also rendered with sample rows under the empty state. */
export function ToolAccountsTable({ rows }: { rows: ToolAccountRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border/70 bg-muted/25 text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2.5 font-medium">Person</th>
            <th className="px-3 py-2.5 font-medium">Tool</th>
            <th className="px-3 py-2.5 font-medium">Login</th>
            <th className="px-3 py-2.5 font-medium">Account</th>
            <th className="px-5 py-2.5 font-medium">What it means</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60 align-top last:border-b-0">
              <td className="px-5 py-3">
                <Link href={`/team/${row.person.id}`} className="font-medium hover:underline">{row.person.name}</Link>
                <span className="block text-xs text-muted-foreground">{row.machine} · {formatRelativeTime(row.updatedAt)}</span>
              </td>
              <td className="px-3 py-3">
                <span className="inline-flex items-center gap-1.5">
                  <ToolBrandIcon tool={row.toolKey} size={14} />
                  {toolDisplayName(row.toolKey)}
                </span>
                {row.plan ? <span className="block text-xs text-muted-foreground">{row.plan}</span> : null}
              </td>
              <td className="px-3 py-3 font-mono text-xs">{row.email ?? <span className="font-sans text-muted-foreground">No email · {row.loginMethod}</span>}</td>
              <td className="px-3 py-3">
                <span className={cn("inline-block border px-1.5 py-px text-[11px] uppercase tracking-[0.08em]", row.ownership === "personal" ? "border-warning/50 text-warning" : "border-border text-muted-foreground")}>
                  {OWNERSHIP_LABEL[row.ownership]}
                </span>
                {row.companySeat ? <span className="mt-1 block text-xs text-muted-foreground">Company seat</span> : null}
              </td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{finding(row) ?? (row.ownership === "company" ? "Managed by the company." : "No email reported, so ownership can't be told.")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
