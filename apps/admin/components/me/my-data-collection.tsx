"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/panel";
import { ToolLogoTile } from "@/components/tools/tool-brand-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { browserMutationInit } from "@/lib/api/client";
import { myDataKey } from "@/lib/app-pages/query-keys";
import { userFacingError } from "@/lib/errors/user-facing";
import { MY_DATA_ACCOUNT_SEARCH_THRESHOLD } from "@/lib/privacy/my-data-constants";
import { preferenceEventCopy, usageStorageCopy } from "@/lib/privacy/my-data-recency";
import type { MyDataAccountRow, MyDataPreferenceEvent } from "@/lib/privacy/my-data-types";
import type { CollectionNoticeCopy } from "@/lib/privacy/collection-notice";
import { cn } from "@/lib/utils";

function sortAccounts(accounts: MyDataAccountRow[]) {
  return [...accounts].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) ||
      (a.email || a.accountKey).localeCompare(b.email || b.accountKey),
  );
}

function providerOptions(accounts: MyDataAccountRow[]) {
  const seen = new Map<string, string>();
  for (const account of accounts) seen.set(account.toolName, account.displayName);
  return [...seen.entries()].map(([toolName, displayName]) => ({ toolName, displayName }));
}

function matchesSearch(account: MyDataAccountRow, query: string) {
  if (!query) return true;
  return [account.displayName, account.email, account.hostname, account.accountKey, account.toolName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function accountLabel(account: MyDataAccountRow) {
  return account.email || account.accountKey || "Login on this device";
}

export function MyDataCollection({
  accounts,
  preferenceEvents,
  notice,
  hasUnattributedUsage = false,
}: {
  accounts: MyDataAccountRow[];
  preferenceEvents: MyDataPreferenceEvent[];
  notice: CollectionNoticeCopy;
  hasUnattributedUsage?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedTool, setSelectedTool] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const showFilters = accounts.length > MY_DATA_ACCOUNT_SEARCH_THRESHOLD;
  const providers = providerOptions(accounts);
  const query = search.trim().toLowerCase();
  const collecting = accounts.filter((row) => row.usageAllowed).length;

  const visible = useMemo(
    () =>
      sortAccounts(accounts).filter(
        (account) =>
          (selectedTool === "all" || account.toolName === selectedTool) && matchesSearch(account, query),
      ),
    [accounts, selectedTool, query],
  );
  const selectedProvider = providers.find((provider) => provider.toolName === selectedTool) ?? null;
  const selectedCollecting = selectedProvider
    ? accounts.some((row) => row.toolName === selectedProvider.toolName && row.usageAllowed)
    : false;

  function patchAccounts(body: Record<string, unknown>, fallback: string) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/app/me/accounts", browserMutationInit("PATCH", body));
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(userFacingError(payload.error, fallback));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: myDataKey });
    });
  }

  const usageEvents = preferenceEvents.filter((event) => event.stream !== "logging");

  function toggle(account: MyDataAccountRow, enabled: boolean) {
    patchAccounts(
      { deviceId: account.deviceId, toolName: account.toolName, accountKey: account.accountKey, stream: "usage", enabled },
      "Could not update this login.",
    );
  }

  return (
    <Panel as="section" padded={false} aria-labelledby="account-collection-heading">
      <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <h2 id="account-collection-heading" className="text-lg font-semibold tracking-tight">
            Tool logins
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Choose which logins share usage. Turning one off stops new uploads; days already stored stay until retention removes them.
          </p>
        </div>
        {accounts.length ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            {`${collecting} of ${accounts.length} on`}
          </p>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {pending ? "Saving collection settings." : error ?? ""}
      </p>

      {showFilters ? (
        <div className="space-y-3 border-t px-4 py-3 sm:px-5">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search email, tool, or device"
            aria-label="Filter by email or device name"
            className="min-h-11"
          />
          <div className="flex items-center gap-2 overflow-x-auto" role="group" aria-label="Filter by provider">
            {[{ toolName: "all", displayName: "All" }, ...providers].map((provider) => (
              <button
                key={provider.toolName}
                type="button"
                aria-pressed={selectedTool === provider.toolName}
                onClick={() => setSelectedTool(provider.toolName)}
                className={cn(
                  "min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm transition-colors",
                  selectedTool === provider.toolName
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {provider.displayName}
              </button>
            ))}
            {selectedProvider && selectedCollecting ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0"
                disabled={pending}
                onClick={() =>
                  patchAccounts(
                    { scope: "provider", toolName: selectedProvider.toolName, enabled: false },
                    "Could not turn this tool off.",
                  )
                }
              >
                Turn off all {selectedProvider.displayName}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {accounts.length ? (
        <ul className="divide-y border-t">
          {visible.map((account) => {
            const label = `${account.displayName} ${accountLabel(account)} on ${account.hostname || "device"}`;
            const meta = [account.displayName, account.hostname, account.plan, account.authPresent ? "signed in" : null]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={account.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <ToolLogoTile tool={account.toolName} size="sm" light />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{accountLabel(account)}</p>
                  <p className="truncate text-xs text-muted-foreground">{meta}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {account.usageAdminLocked ? "Locked off by a workspace admin" : usageStorageCopy(account)}
                  </p>
                </div>
                <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <span>Usage</span>
                  <Switch
                    checked={account.usageEnabled && !account.usageAdminLocked}
                    disabled={pending || account.usageAdminLocked}
                    aria-label={`${label} — Usage`}
                    onChange={(event) => toggle(account, event.target.checked)}
                  />
                </label>
              </li>
            );
          })}
          {!visible.length ? (
            <li className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No logins match this filter.</li>
          ) : null}
        </ul>
      ) : (
        <p className="border-t px-4 py-6 text-sm text-muted-foreground sm:px-5">
          No AI tool logins found yet. Sign in to a tool on an enrolled device and it will appear here.
        </p>
      )}

      {error ? (
        <p role="alert" className="border-t px-4 py-3 text-sm text-destructive sm:px-5">
          {error}
        </p>
      ) : null}

      <Accordion type="multiple" className="border-t px-4 sm:px-5">
        <AccordionItem value="collected" className={preferenceEvents.length ? undefined : "border-b-0"}>
          <AccordionTrigger className="min-h-11 py-3 text-sm">What is collected?</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm">
            <p><span className="font-medium text-foreground">Usage:</span> {notice.usageDefinition}</p>
            <p>Never collected: {notice.neverCollects.join("; ")}.</p>
            {hasUnattributedUsage ? (
              <p>Some older usage is not linked to a login. The export includes that unlinked history.</p>
            ) : null}
          </AccordionContent>
        </AccordionItem>
        {usageEvents.length ? (
          <AccordionItem value="history" className="border-b-0">
            <AccordionTrigger className="min-h-11 py-3 text-sm">Recent changes to collection settings</AccordionTrigger>
            <AccordionContent>
              <p className="text-sm">When you or an admin turned a setting on or off — not upload activity.</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {usageEvents.map((event) => (
                  <li key={event.id}>{preferenceEventCopy(event)}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm">The full history is in your data export.</p>
            </AccordionContent>
          </AccordionItem>
        ) : null}
      </Accordion>
    </Panel>
  );
}
