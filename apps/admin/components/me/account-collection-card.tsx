"use client";

import { useEffect, useState, useTransition } from "react";
import { Panel } from "@/components/panel";
import { browserMutationInit } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors/user-facing";
import type { PublicCollectionAccount, PublicCollectionEvent } from "@/lib/privacy/account-collection-types";

function streamLabel(stream: string) {
  return stream === "logging" ? "Logging" : "Usage";
}

function accountLabel(account: PublicCollectionAccount) {
  const who = account.email || account.accountKey || "Account";
  const signedIn = account.authPresent ? " · signed in" : "";
  const plan = account.plan ? ` · ${account.plan}` : "";
  return `${who}${plan}${signedIn}`;
}

function groupProviders(accounts: PublicCollectionAccount[]) {
  const grouped = new Map<string, PublicCollectionAccount[]>();
  for (const account of accounts) {
    const rows = grouped.get(account.toolName) ?? [];
    rows.push(account);
    grouped.set(account.toolName, rows);
  }
  return [...grouped.entries()].map(([toolName, rows]) => ({
    toolName,
    displayName: rows[0]?.displayName ?? toolName,
    accounts: rows,
    on: rows.some((row) => row.usageAllowed || row.loggingAllowed),
  }));
}

function AccountList({
  accounts,
  pending,
  onUsage,
  onLogging,
  mode,
}: {
  accounts: PublicCollectionAccount[];
  pending: boolean;
  onUsage: (account: PublicCollectionAccount, enabled: boolean) => void;
  onLogging: (account: PublicCollectionAccount, enabled: boolean) => void;
  mode: "person" | "admin";
}) {
  if (!accounts.length) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        {mode === "admin"
          ? "No accounts in this workspace yet."
          : "No provider account has been seen on your devices yet."}
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-4">
      {accounts.map((account) => (
        <li key={account.id} className="border border-border p-4">
          <p className="font-medium">
            {account.displayName}
            {account.email ? ` · ${account.email}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {account.hostname || "Device"}
            {account.plan ? ` · ${account.plan}` : ""}
            {mode === "admin"
              ? ` · person ${account.usageEnabled ? "usage on" : "usage off"}, ${account.loggingEnabled ? "logging on" : "logging off"}`
              : account.authPresent
                ? " · signed in"
                : ""}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-6">
            {mode === "person" ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={account.usageEnabled}
                    disabled={pending || account.usageAdminLocked}
                    onChange={(event) => onUsage(account, event.target.checked)}
                  />
                  Usage
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={account.loggingEnabled}
                    disabled={pending || account.loggingAdminLocked}
                    onChange={(event) => onLogging(account, event.target.checked)}
                  />
                  Logging
                </label>
              </>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={account.usageAdminLocked}
                    disabled={pending}
                    onChange={(event) => onUsage(account, event.target.checked)}
                  />
                  Lock usage off
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={account.loggingAdminLocked}
                    disabled={pending}
                    onChange={(event) => onLogging(account, event.target.checked)}
                  />
                  Lock logging off
                </label>
              </>
            )}
          </div>
          {mode === "person" && (account.usageAdminLocked || account.loggingAdminLocked) ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {account.usageAdminLocked ? "Usage is locked off by an admin. " : ""}
              {account.loggingAdminLocked ? "Logging is locked off by an admin." : ""}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AccountCollectionCard() {
  const [accounts, setAccounts] = useState<PublicCollectionAccount[]>([]);
  const [events, setEvents] = useState<PublicCollectionEvent[]>([]);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void fetch("/api/app/me/accounts", { credentials: "same-origin" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          accounts?: PublicCollectionAccount[];
          events?: PublicCollectionEvent[];
          error?: string;
        };
        if (!response.ok) {
          setError(userFacingError(body.error, "Could not load collection switches."));
          return;
        }
        setAccounts(body.accounts ?? []);
        setEvents(body.events ?? []);
      })
      .catch(() => {
        setError("Could not load collection switches.");
      });
  }, []);

  const providers = groupProviders(accounts);
  const activeTool = providers.some((provider) => provider.toolName === selectedTool)
    ? selectedTool
    : providers[0]?.toolName ?? null;
  const provider = providers.find((row) => row.toolName === activeTool) ?? null;
  const selectedAccount = provider
    ? provider.accounts.find((account) => account.id === selectedAccountId)
      ?? provider.accounts.find((account) => account.authPresent)
      ?? provider.accounts[0]
    : null;

  function disableProvider(toolName: string) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/app/me/accounts", browserMutationInit("PATCH", {
        scope: "provider",
        toolName,
        enabled: false,
      }));
      const body = (await response.json().catch(() => ({}))) as {
        accounts?: PublicCollectionAccount[];
        error?: string;
      };
      if (!response.ok || !body.accounts) {
        setError(userFacingError(body.error, "Could not turn this provider off."));
        return;
      }
      setAccounts(body.accounts);
    });
  }

  function optInAccount(account: PublicCollectionAccount, enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/app/me/accounts", browserMutationInit("PATCH", {
        scope: "account",
        deviceId: account.deviceId,
        toolName: account.toolName,
        accountKey: account.accountKey,
        enabled,
      }));
      const body = (await response.json().catch(() => ({}))) as {
        account?: PublicCollectionAccount;
        error?: string;
      };
      if (!response.ok || !body.account) {
        setError(userFacingError(body.error, "Could not update this account."));
        return;
      }
      setAccounts((current) => current.map((row) => (row.id === body.account!.id ? body.account! : row)));
    });
  }

  return (
    <Panel as="section" className="sm:p-6" aria-labelledby="account-collection-heading">
      <h2 id="account-collection-heading" className="text-lg font-semibold tracking-tight">
        Collection
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Click a provider to turn it off. Collection stays off until you opt in the account that is signed in.
      </p>
      {providers.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {providers.map((row) => (
            <button
              key={row.toolName}
              type="button"
              aria-pressed={row.toolName === activeTool}
              disabled={pending}
              onClick={() => {
                setSelectedTool(row.toolName);
                setSelectedAccountId(null);
                if (row.on) disableProvider(row.toolName);
              }}
              className={`border px-3 py-2 text-left text-sm ${
                row.toolName === activeTool ? "border-foreground" : "border-border"
              }`}
            >
              <span className="font-medium">{row.displayName}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{row.on ? "On · click to disable" : "Off"}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No provider account has been seen on your devices yet.</p>
      )}
      {provider && selectedAccount ? (
        <div className="mt-4 border border-border p-4">
          <p className="font-medium">{provider.displayName}</p>
          {provider.accounts.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {provider.accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  aria-pressed={account.id === selectedAccount.id}
                  onClick={() => setSelectedAccountId(account.id)}
                  className={`border px-3 py-1.5 text-sm ${
                    account.id === selectedAccount.id ? "border-foreground" : "border-border text-muted-foreground"
                  }`}
                >
                  {accountLabel(account)}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{accountLabel(selectedAccount)}</p>
          )}
          <div className="mt-3">
            <button
              type="button"
              disabled={pending || (selectedAccount.usageAdminLocked && selectedAccount.loggingAdminLocked)}
              onClick={() => optInAccount(selectedAccount, !(selectedAccount.usageEnabled || selectedAccount.loggingEnabled))}
              className="border border-border px-3 py-1.5 text-sm"
            >
              {selectedAccount.usageEnabled || selectedAccount.loggingEnabled ? "Turn off this account" : "Opt in this account"}
            </button>
          </div>
          {selectedAccount.usageAdminLocked || selectedAccount.loggingAdminLocked ? (
            <p className="mt-2 text-sm text-muted-foreground">An admin lock is on for this account and cannot be cleared here.</p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {events.length ? (
        <div className="mt-6">
          <p className="text-sm font-medium">Collection history</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {events.slice(0, 12).map((event) => (
              <li key={event.id}>
                {event.createdAt.slice(0, 16).replace("T", " ")} · {event.toolName} · {streamLabel(event.stream)}{" "}
                {event.enabled ? "on" : "off"} · {event.actor}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

export function AccountCollectionLockCard() {
  const [accounts, setAccounts] = useState<PublicCollectionAccount[]>([]);
  const [events, setEvents] = useState<PublicCollectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void fetch("/api/app/settings/privacy/accounts", { credentials: "same-origin" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          accounts?: PublicCollectionAccount[];
          events?: PublicCollectionEvent[];
          error?: string;
        };
        if (!response.ok) {
          setError(userFacingError(body.error, "Could not load account collection locks."));
          return;
        }
        setAccounts(body.accounts ?? []);
        setEvents(body.events ?? []);
      })
      .catch(() => {
        setError("Could not load account collection locks.");
      });
  }, []);

  function save(account: PublicCollectionAccount, stream: "usage" | "logging", locked: boolean) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(
        "/api/app/settings/privacy/accounts",
        browserMutationInit("PATCH", {
          deviceId: account.deviceId,
          toolName: account.toolName,
          accountKey: account.accountKey,
          stream,
          locked,
        }),
      );
      const body = (await response.json().catch(() => ({}))) as {
        account?: PublicCollectionAccount;
        error?: string;
      };
      if (!response.ok || !body.account) {
        setError(userFacingError(body.error, "Could not update the admin lock."));
        return;
      }
      setAccounts((current) => current.map((row) => (row.id === body.account!.id ? body.account! : row)));
    });
  }

  return (
    <Panel as="section" className="sm:p-6" aria-labelledby="account-lock-heading">
      <h2 id="account-lock-heading" className="text-lg font-semibold tracking-tight">
        Account collection locks
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Locking usage or logging off stops collection for that account until an admin clears the lock.
        This does not turn collection on for the person.
      </p>
      <AccountList
        accounts={accounts}
        pending={pending}
        mode="admin"
        onUsage={(account, locked) => save(account, "usage", locked)}
        onLogging={(account, locked) => save(account, "logging", locked)}
      />
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {events.length ? (
        <div className="mt-6">
          <p className="text-sm font-medium">Lock history</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {events.slice(0, 12).map((event) => (
              <li key={event.id}>
                {event.createdAt.slice(0, 16).replace("T", " ")} · {event.toolName} · {streamLabel(event.stream)}{" "}
                {event.enabled ? "on" : "off"} · {event.actor}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
