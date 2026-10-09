"use client";

import { useState } from "react";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError } from "@/components/app-data-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { HubTabList } from "@/components/hub-nav";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SignalsKpi } from "@/components/signals/signals-ui";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { useAppPageQuery } from "@/lib/api/client";
import type { ToolAccountsPayload } from "@/lib/app-pages/tool-accounts";
import { OWNERSHIP_LABEL, ToolAccountsTable } from "@/components/security/tool-accounts-table";
import { ToolAccountsGhostRows } from "@/components/security/tool-accounts-ghost-rows";
import { toolDisplayName } from "@/lib/tools/catalog";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "personal", label: "Personal" },
  { id: "company", label: "Company" },
  { id: "unknown", label: "Unknown" },
] as const;


export default function ToolAccountsClientScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const query = useAppPageQuery<ToolAccountsPayload>(["app", "accounts"], "/api/app/accounts");

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  if (!query.data) return <AppPageSkeleton />;

  const { totals, accounts, domains } = query.data;
  const rows = filter === "all" ? accounts : accounts.filter((row) => row.ownership === filter);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Tool accounts."
        description="Which logins people use for AI tools on connected machines: company accounts, or personal ones the company can't manage."
        actions={
          <ExportCsvButton
            name="tool-accounts"
            header={["Person", "Tool", "Login", "Account", "Plan", "Company seat", "Login method", "Signed in", "Usage shared", "Machine", "Updated (UTC)"]}
            rows={() => accounts.map((row) => [row.person.name, toolDisplayName(row.toolKey), row.email ?? "", OWNERSHIP_LABEL[row.ownership], row.plan ?? "", row.companySeat ? "yes" : "no", row.loginMethod, row.signedIn ? "yes" : "no", row.usageShared ? "yes" : "no", row.machine, row.updatedAt])}
          />
        }
      >
        <HubTabList
          items={FILTERS.map((item) => ({ id: item.id, label: item.id === "all" ? `All · ${totals.logins}` : `${item.label} · ${totals[item.id]}` }))}
          value={filter}
          onChange={(id) => setFilter(id as typeof filter)}
          className="border-b border-border"
          aria-label="Account type"
        />
      </PageHeader>

      <section aria-label="Summary" className="mb-10 grid gap-y-8 py-2 sm:grid-cols-3">
        <SignalsKpi
          label="Personal logins"
          hero
          className="pl-5"
          value={<span className={totals.personal ? "text-warning" : undefined}>{totals.personal}<span className="text-muted-foreground"> of {totals.logins}</span></span>}
          sub="on work machines"
        />
        <SignalsKpi
          label="Paid twice"
          className="sm:border-l sm:border-border sm:pl-8"
          value={totals.personalWithSeat}
          sub="personal login, but the company pays a seat too"
        />
        <SignalsKpi
          label="Outside company plans"
          className="sm:border-l sm:border-border sm:pl-8"
          value={totals.personalWithoutSeat}
          sub="personal login and no company seat"
        />
      </section>

      <Panel as="section" padded={false}>
        {!rows.length ? (
          <Empty className="min-h-0 gap-1 border-0 px-5 py-8 md:px-5 md:py-8">
            <EmptyDescription>
              {totals.logins ? "No logins of this type." : "No tool logins reported yet. They appear once people sign in to an AI tool on a connected machine."}
            </EmptyDescription>
          </Empty>
        ) : (
          <ToolAccountsTable rows={rows} />
        )}
        {!totals.logins ? <ToolAccountsGhostRows /> : null}
      </Panel>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Company domains: {domains.length ? domains.join(", ") : "none yet"}. These are verified workspace domains plus the work domains members sign in with.
        Personal addresses are masked; people see their own logins in full on My data.
      </p>
    </div>
  );
}
