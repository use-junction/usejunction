"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import { browserMutationInit } from "@/lib/api/client";
import type { PendingCollectionAccount } from "@/lib/privacy/account-collection";
import { cn } from "@/lib/utils";

type Decision = "include" | "skip";

/** A couple of logins stay listed. More than that collapses into one stacked row. */
const STACK_AT = 3;
const STACK_ICONS = 6;

function accountLabel(account: PendingCollectionAccount) {
  return account.email?.trim() || "";
}

function namedAccounts(accounts: PendingCollectionAccount[]) {
  return accounts.filter((account) => account.email?.trim());
}

function AccountRow({
  account,
  busy,
  onDecide,
}: {
  account: PendingCollectionAccount;
  busy: string | null;
  onDecide: (accounts: PendingCollectionAccount[], decision: Decision, key: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <ToolBrandIcon tool={account.toolName} size={18} />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {account.displayName}
            {account.newProvider ? <span className="ml-2 text-[10px] font-normal uppercase tracking-[0.08em] text-primary">New tool</span> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {accountLabel(account)}
            {account.plan ? ` · ${account.plan}` : ""}
            {account.hostname ? ` · ${account.hostname.replace(/\.local$/, "")}` : ""}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-none bg-background"
          disabled={busy !== null}
          onClick={() => onDecide([account], "include", account.id)}
        >
          Include
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="rounded-none"
          disabled={busy !== null}
          onClick={() => onDecide([account], "skip", account.id)}
        >
          Not now
        </Button>
      </span>
    </li>
  );
}

/**
 * Asks the signed-in developer about AI tools and accounts the agent found
 * after onboarding. Nothing is collected from them until the developer says yes;
 * "Not now" is recorded so the same login is not asked about again.
 * A long list stays as one stacked row until it is expanded.
 */
export function NewCollectionBanner({ refreshKey }: { refreshKey?: string | null }) {
  const [pending, setPending] = useState<PendingCollectionAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/app/me/accounts", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "x-requested-with": "usejunction-web" },
      });
      if (!response.ok) return;
      const body = (await response.json().catch(() => null)) as { pending?: PendingCollectionAccount[] } | null;
      setPending(body?.pending ?? []);
    } catch {
      /* the banner is optional; never block the page */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function decide(accounts: PendingCollectionAccount[], decision: Decision, key: string) {
    setBusy(key);
    try {
      for (const account of accounts) {
        const response = await fetch(
          "/api/app/me/accounts",
          browserMutationInit("PATCH", {
            scope: "account",
            deviceId: account.deviceId,
            toolName: account.toolName,
            accountKey: account.accountKey,
            enabled: decision === "include",
            decision: true,
          }),
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Couldn't update ${account.displayName}.`);
        }
      }
      toast.success(
        decision === "include"
          ? `Collecting from ${accounts.length === 1 ? `${accounts[0]!.displayName}` : `${accounts.length} accounts`} from the next sync.`
          : "Got it. You can turn these on any time in My data.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save that choice.");
    } finally {
      setBusy(null);
      await load();
    }
  }

  const accounts = namedAccounts(pending);
  if (!accounts.length) return null;

  const newTools = [...new Set(accounts.filter((account) => account.newProvider).map((account) => account.displayName))];
  const title = newTools.length
    ? `New on your machine: ${newTools.join(", ")}`
    : `${accounts.length} new ${accounts.length === 1 ? "account" : "accounts"} signed in`;
  const stacked = accounts.length >= STACK_AT;
  const visibleIcons = accounts.slice(0, STACK_ICONS);
  const hiddenIconCount = accounts.length - visibleIcons.length;

  return (
    <section
      aria-label="New AI tools and accounts"
      className="mb-6 w-full border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              UseJunction found {accounts.length === 1 ? "a login" : "these logins"} after setup. Nothing is collected until you include {accounts.length === 1 ? "it" : "them"}.
            </p>
          </div>
        </div>
        {accounts.length > 1 ? (
          <Button
            type="button"
            size="sm"
            className="shrink-0 rounded-none"
            disabled={busy !== null}
            onClick={() => void decide(accounts, "include", "all")}
          >
            Include all
          </Button>
        ) : null}
      </div>

      {stacked ? (
        <div className="mt-3 border-t border-border/60">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex items-center -space-x-1.5" aria-hidden>
                {visibleIcons.map((account, index) => (
                  <span
                    key={account.id}
                    className="relative inline-flex size-6 items-center justify-center border border-background bg-background"
                    style={{ zIndex: index + 1 }}
                  >
                    <ToolBrandIcon tool={account.toolName} size={14} />
                  </span>
                ))}
                {hiddenIconCount > 0 ? (
                  <span
                    className="relative inline-flex h-6 items-center border border-background bg-background px-1.5 text-[10px] font-medium text-muted-foreground"
                    style={{ zIndex: visibleIcons.length + 1 }}
                  >
                    +{hiddenIconCount}
                  </span>
                ) : null}
              </span>
              <span className="text-sm">{accounts.length} logins</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {expanded ? "Show less" : "Expand"}
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
            </span>
          </button>
          {expanded ? (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} busy={busy} onDecide={(rows, decision, key) => void decide(rows, decision, key)} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} busy={busy} onDecide={(rows, decision, key) => void decide(rows, decision, key)} />
          ))}
        </ul>
      )}
    </section>
  );
}
