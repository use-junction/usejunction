"use client";

import { ActivitySettingsCard } from "@/components/activity/activity-settings-card";
import { PageHeader } from "@/components/page-header";
import { BillingSettingsCard } from "@/components/settings/billing-settings-card";
import { EmailReportsSettingsCard, type EmailReportsPrefs } from "@/components/settings/email-reports-settings-card";
import { SignalsSettingsCard } from "@/components/settings/signals-settings-card";
import { MachineConnectionSettingsCard } from "@/components/settings/machine-connection-settings-card";
import { AccountCollectionCard, AccountCollectionLockCard } from "@/components/me/account-collection-card";
import { WorkspaceSettingsCard } from "@/components/settings/workspace-settings-card";
import type { getOrgActivitySettings } from "@/lib/activity/service";
import type { getOrgSignalsPolicy } from "@/lib/signals/service";
import type { getOrgBillingStatus } from "@/lib/saas-billing/status";
import { useAppPageQuery } from "@/lib/api/client";
import { notificationPreferencesKey, settingsKey } from "@/lib/app-pages/query-keys";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";

type SettingsPayload = {
  orgId: string;
  orgName: string;
  orgColor: string | null;
  settings: Awaited<ReturnType<typeof getOrgActivitySettings>>;
  signalsPolicy: Awaited<ReturnType<typeof getOrgSignalsPolicy>>;
  billing: Awaited<ReturnType<typeof getOrgBillingStatus>>;
  billingMembers: Array<{ id: string; name: string; email: string }>;
};

export default function SettingsClientScreen() {
  const prefsQuery = useAppPageQuery<EmailReportsPrefs>(
    notificationPreferencesKey,
    "/api/app/me/notification-preferences",
  );
  const canManageOrg =
    prefsQuery.data?.role === "owner" || prefsQuery.data?.role === "admin";
  const orgQuery = useAppPageQuery<SettingsPayload>(
    settingsKey,
    "/api/app/settings",
    { enabled: canManageOrg },
  );

  useAppQueryErrorToast(orgQuery.error, {
    enabled: canManageOrg && Boolean(prefsQuery.data),
    retry: () => void orgQuery.refetch(),
  });

  if ((prefsQuery.isPending && !prefsQuery.data) || (canManageOrg && orgQuery.isPending && !orgQuery.data)) {
    return <AppPageSkeleton />;
  }
  if (isBlockingAppQueryError(prefsQuery.error, Boolean(prefsQuery.data))) {
    return <AppPageError error={prefsQuery.error} retry={() => void prefsQuery.refetch()} />;
  }
  if (canManageOrg && isBlockingAppQueryError(orgQuery.error, Boolean(orgQuery.data))) {
    return <AppPageError error={orgQuery.error} retry={() => void orgQuery.refetch()} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Settings."
        description="Email reports, workspace identity, billing, and what your team can open."
        className="mb-8"
      />

      <div className="space-y-6">
        <MachineConnectionSettingsCard />
        <AccountCollectionCard />
        {canManageOrg ? <AccountCollectionLockCard /> : null}

        {canManageOrg && orgQuery.data ? (
          <>
            <WorkspaceSettingsCard
              orgId={orgQuery.data.orgId}
              initialName={orgQuery.data.orgName}
              initialColor={orgQuery.data.orgColor}
            />
            <BillingSettingsCard billing={orgQuery.data.billing} members={orgQuery.data.billingMembers} />
            {prefsQuery.data ? <EmailReportsSettingsCard initial={prefsQuery.data} /> : null}
            <SignalsSettingsCard initialPolicy={orgQuery.data.signalsPolicy} />
            <ActivitySettingsCard initialSettings={orgQuery.data.settings} />
          </>
        ) : prefsQuery.data ? (
          <EmailReportsSettingsCard initial={prefsQuery.data} />
        ) : null}
      </div>
    </div>
  );
}
