"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronRight, Loader2 } from "lucide-react";
import { Panel } from "@/components/panel";
import { useBillingNavigation } from "@/components/saas-billing/use-billing-navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TEAM_PRICE_PER_DEV_USD } from "@/lib/saas-billing/entitlements";
import type { OrgBillingStatus } from "@/lib/saas-billing/status";
import { cn } from "@/lib/utils";

export type BillingSettingsMember = {
  id: string;
  name: string;
  email: string;
};

type BillingSettingsCardProps = {
  billing: OrgBillingStatus;
  members: BillingSettingsMember[];
};

function pluralizeUsers(count: number) {
  return `${count} active user${count === 1 ? "" : "s"}`;
}

function memberInitials(name: string, email: string) {
  const source = name.trim() || email.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function subscriptionLabel(billing: OrgBillingStatus) {
  if (billing.effectivePlan === "community") return "Free tier";
  if (billing.subscriptionStatus === "cancelled") return "Cancels at period end";
  if (billing.subscriptionStatus === "paused") return "Subscription paused";
  if (billing.subscriptionStatus === "on_trial") return "Subscription trial";
  if (billing.subscriptionStatus === "active") return "Active subscription";
  return billing.effectivePlan === "enterprise" ? "Enterprise subscription" : "Team subscription";
}

function priceSummary(billing: OrgBillingStatus) {
  const total = billing.usersUsed * TEAM_PRICE_PER_DEV_USD;

  switch (billing.effectivePlan) {
    case "community":
      return {
        total: "$0 / month",
        detail: `Community is free. Team costs $${TEAM_PRICE_PER_DEV_USD} per active user per month.`,
        rosterTitle: "Active users",
        memberRate: "Free",
      };
    case "team":
      return {
        total: `$${total} / month`,
        detail: `${pluralizeUsers(billing.usersUsed)} billed at $${TEAM_PRICE_PER_DEV_USD} per user per month.`,
        rosterTitle: "Billed users",
        memberRate: `$${TEAM_PRICE_PER_DEV_USD} / month`,
      };
    case "enterprise":
      return {
        total: "Custom pricing",
        detail: `${pluralizeUsers(billing.usersUsed)} covered by your contract.`,
        rosterTitle: "Covered users",
        memberRate: "Covered",
      };
  }
}

function statusTone(billing: OrgBillingStatus) {
  if (billing.subscriptionStatus === "active") {
    return "text-success";
  }
  if (billing.subscriptionStatus === "paused" || billing.subscriptionStatus === "cancelled") {
    return "text-brand-orange-dark";
  }
  return "text-muted-foreground";
}

export function BillingSettingsCard({ billing, members }: BillingSettingsCardProps) {
  const { error, loading, pendingDestination, openCheckout, openPortal } = useBillingNavigation();
  const pricing = priceSummary(billing);
  const paid = billing.effectivePlan === "team" || billing.effectivePlan === "enterprise";

  return (
    <Panel
      as="section"
      id="settings-billing"
      padded={false}
      className="overflow-hidden scroll-mt-20"
      aria-labelledby="billing-settings-heading"
    >
      <div className="flex flex-col gap-4 border-b border-border/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 id="billing-settings-heading" className="text-lg font-semibold tracking-tight">
            Billing
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your plan, monthly price, and the people included on your bill.
          </p>
        </div>
        {billing.canUpgrade ? (
          <Button
            type="button"
            className="w-full rounded-none [&::before]:hidden sm:w-auto"
            disabled={loading}
            aria-busy={pendingDestination === "checkout"}
            onClick={openCheckout}
          >
            {pendingDestination === "checkout" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {pendingDestination === "checkout" ? "Opening checkout…" : "Upgrade to Team"}
            {pendingDestination !== "checkout" ? (
              <ArrowRight className="size-4" aria-hidden="true" />
            ) : null}
          </Button>
        ) : billing.canManage ? (
          <Button
            type="button"
            className="w-full rounded-none [&::before]:hidden sm:w-auto"
            disabled={loading}
            aria-busy={pendingDestination === "portal"}
            onClick={openPortal}
          >
            {pendingDestination === "portal" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {pendingDestination === "portal" ? "Opening billing…" : "Manage billing"}
            {pendingDestination !== "portal" ? (
              <ArrowUpRight className="size-4" aria-hidden="true" />
            ) : null}
          </Button>
        ) : null}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xl font-semibold tracking-tight">{billing.planLabel}</p>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium",
                  statusTone(billing),
                )}
              >
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                {subscriptionLabel(billing)}
              </span>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-sm text-muted-foreground">Monthly total</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{pricing.total}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{pricing.detail}</p>

        {!billing.canUpgrade && !billing.canManage && paid ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Billing management is unavailable for this workspace.
          </p>
        ) : null}

        {error ? (
          <Alert variant="destructive" className="mt-4 rounded-none bg-card">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold">
              {pricing.rosterTitle}{" "}
              <span className="font-normal text-muted-foreground">({billing.usersUsed})</span>
            </h3>
            <Link
              href="/team"
              className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Manage users
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </div>

          {members.length ? (
            <div
              className="uj-scrollbar mt-3 max-h-72 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              role="region"
              aria-label="Scrollable member list"
              tabIndex={0}
            >
              <ul className="divide-y divide-border/70">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{memberInitials(member.name, member.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{member.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {pricing.memberRate}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 py-2 text-sm text-muted-foreground">
              No active users in this workspace.
            </p>
          )}
        </div>
      </div>

      {billing.seatSyncPending && billing.billingSeatQuantity !== null ? (
        <div
          role="status"
          className="border-t border-brand-yellow-dark/20 bg-brand-yellow-pale px-5 py-4 text-sm leading-6 text-foreground sm:px-6"
        >
          Updating your subscription: it lists {billing.billingSeatQuantity} seat
          {billing.billingSeatQuantity === 1 ? "" : "s"} and this workspace now has{" "}
          {pluralizeUsers(billing.usersUsed)}. This usually settles within a few minutes.
        </div>
      ) : null}
    </Panel>
  );
}
